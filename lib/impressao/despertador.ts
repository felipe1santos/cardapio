/**
 * Despertador da impressão (Assistente Beta 0.2.0-beta.7): o Assistente pergunta "tem
 * trabalho?" e o servidor SEGURA a resposta até aparecer algo da loja (ou dar o prazo).
 * Quem acorda é UM canal Realtime do servidor (chave de serviço), compartilhado por todas
 * as esperas deste processo:
 *   • impressao_trabalhos INSERT → pré-conta, teste, teste de largura;
 *   • pedidos INSERT/UPDATE     → comanda da cozinha (novo pedido, reimprimir).
 * O pedido entra no banco antes dos itens: a espera confere de novo logo depois do aviso.
 * Sem Realtime (caiu, reconectando), a espera vira uma checagem no banco a cada 2 s.
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'

type Ouvinte = () => void
interface Estado {
  ouvintes: Map<string, Set<Ouvinte>>
  canal: RealtimeChannel | null
  /** Um cliente por processo, reaproveitado nas reconexões (antes: um createClient novo por queda). */
  cliente: SupabaseClient | null
  conectado: boolean
  tentandoDesde: number
}

const G = globalThis as unknown as { __menuziaDespertador?: Estado }

function estado(): Estado {
  if (G.__menuziaDespertador) return G.__menuziaDespertador
  const e: Estado = { ouvintes: new Map(), canal: null, cliente: null, conectado: false, tentandoDesde: 0 }
  G.__menuziaDespertador = e
  return e
}

/**
 * Esta mudança de pedido pode gerar ficha ou mexer no alarme? (egress, 26/10). Em rota e entregue nunca entram na fila
 * de impressão (novo, preparo/pronto não impresso, reimpressão) nem na contagem do alarme ("recebido"); acordar a
 * espera por eles custava ~15 consultas por mudança. Na dúvida (sem dados), acorda. Um aviso a menos atrasa no máximo
 * a volta da espera (20 s): o Assistente pergunta de novo.
 */
export function acordaAEspera(p: { eventType?: string; new?: unknown }): boolean {
  const linha = p.new as { status?: unknown; reimprimir?: unknown } | null | undefined
  if (p.eventType !== 'UPDATE' || !linha || typeof linha.status !== 'string') return true
  if (linha.reimprimir === true) return true
  return linha.status !== 'em_rota' && linha.status !== 'entregue'
}

function avisar(restauranteId: unknown) {
  if (typeof restauranteId !== 'string') return
  const lista = estado().ouvintes.get(restauranteId)
  if (lista) for (const f of [...lista]) f()
}

/** Liga o canal (uma vez por processo; reconecta sozinho se cair). */
function garantirCanal() {
  const e = estado()
  if (e.canal) return
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !chave) return
  e.tentandoDesde = Date.now()
  const cliente = (e.cliente ??= createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } }))
  const canal: RealtimeChannel = cliente
    .channel('menuzia-impressao-despertador')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'impressao_trabalhos' }, (p) => avisar((p.new as { restaurante_id?: unknown }).restaurante_id))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos' }, (p) => { if (acordaAEspera(p)) avisar(((p.new ?? p.old) as { restaurante_id?: unknown }).restaurante_id) })
  e.canal = canal
  canal.subscribe((status) => {
    // Aviso de um canal que já foi trocado (ex.: o CLOSED que a própria saída dele dispara): não mexe no atual.
    // Antes (26/10), esse CLOSED derrubava o canal NOVO e a reconexão virava um ciclo a cada 3 s até o deploy.
    if (e.canal !== canal) return
    e.conectado = status === 'SUBSCRIBED'
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
      // Recomeça daqui a pouco, no mesmo cliente (o supabase-js também tenta sozinho).
      e.canal = null
      e.conectado = false
      setTimeout(() => { void cliente.removeChannel(canal); garantirCanal() }, 3000)
    }
  })
}

export function despertadorConectado(): boolean {
  garantirCanal()
  return estado().conectado
}

/**
 * Espera um aviso da loja (ou `ms`, ou o cliente desistir). Sem Realtime conectado, no
 * máximo 2 s por vez — quem chama confere o banco e espera de novo.
 */
export function esperarNovidade(restauranteId: string, ms: number, sinal?: AbortSignal): Promise<'aviso' | 'prazo'> {
  garantirCanal()
  const e = estado()
  const limite = e.conectado ? ms : Math.min(ms, 2000)
  return new Promise((resolve) => {
    let feito = false
    const fim = (r: 'aviso' | 'prazo') => {
      if (feito) return
      feito = true
      clearTimeout(t)
      lista.delete(ouvir)
      if (lista.size === 0) e.ouvintes.delete(restauranteId)
      sinal?.removeEventListener('abort', desistiu)
      resolve(r)
    }
    const ouvir = () => fim('aviso')
    const desistiu = () => fim('prazo')
    const lista = e.ouvintes.get(restauranteId) ?? new Set<Ouvinte>()
    lista.add(ouvir)
    e.ouvintes.set(restauranteId, lista)
    const t = setTimeout(() => fim('prazo'), Math.max(0, limite))
    sinal?.addEventListener('abort', desistiu)
  })
}

/**
 * Laço da espera longa: roda `buscar` até ele trazer algo, o prazo acabar ou o Assistente
 * desistir. Depois de um aviso sem novidade (pedido antes dos itens), confere de novo em
 * 0,4 s e 1,2 s.
 */
export async function esperarComBusca<T>(
  restauranteId: string,
  segundos: number,
  sinal: AbortSignal | undefined,
  buscar: () => Promise<T[]>,
  /**
   * Conferido antes de cada nova busca durante a espera: a situação que valia no começo
   * (ex.: loja em "Cozinha e Caixa" com este computador na Cozinha) ainda vale? Se não,
   * para e devolve vazio — nada é reservado para quem deixou de ser o destino.
   */
  aindaVale: () => Promise<boolean> = async () => true,
  /**
   * Alarme do Assistente (12/10): depois de um aviso sem nada para imprimir, a contagem de pedidos esperando aceite
   * mudou (aceitaram/recusaram)? Então devolve já (vazio) para o Assistente parar o som na hora.
   */
  devolverJa?: () => Promise<boolean>,
): Promise<T[]> {
  const fim = Date.now() + Math.max(0, Math.min(segundos, 20)) * 1000
  const buscarSeVale = async () => ((await aindaVale()) ? buscar() : null)
  let lista = await buscar()
  // Aceitaram enquanto o Assistente imprimia: a contagem já chega diferente (teste real #292, o som parou 21 s depois).
  if (!lista.length && devolverJa && (await devolverJa())) return lista
  while (lista.length === 0 && Date.now() < fim && !sinal?.aborted) {
    const r = await esperarNovidade(restauranteId, fim - Date.now(), sinal)
    if (sinal?.aborted) break
    const nova = await buscarSeVale()
    if (nova === null) return []
    lista = nova
    if (r === 'aviso') {
      for (const pausa of [400, 800]) {
        if (lista.length || sinal?.aborted) break
        await new Promise((ok) => setTimeout(ok, pausa))
        const outra = await buscarSeVale()
        if (outra === null) return []
        lista = outra
      }
      if (!lista.length && devolverJa && (await devolverJa())) break
    }
  }
  return lista
}

/** Só para testes. */
export function _avisarParaTeste(restauranteId: string) {
  avisar(restauranteId)
}
