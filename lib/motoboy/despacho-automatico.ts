import type { SupabaseClient } from '@supabase/supabase-js'
import { atribuirEntregadorEmLoteSeguro } from '@/lib/queries/pedidos'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Item 61 (2026-10-08) — DESPACHO AUTOMÁTICO e ENTREGUE AUTOMÁTICO.
 *
 * Despacho automático (chave da loja, restaurantes.despacho_automatico): todo pedido de ENTREGA
 * pronto e sem motoboy vai sozinho para um motoboy DISPONÍVEL — logado no app (sinal nos últimos
 * 2 min), não pausado (status ≠ offline) e não desativado. Escolha: quem tem MENOS entregas em
 * rota; empate → quem está esperando há mais tempo (a última saída mais antiga). Mesmo caminho do
 * despacho manual: em_rota + entregador, aviso ao cliente ("saiu para entrega") e auditoria.
 * Roda quando o pedido fica pronto (Kanban, cozinha, PDV), no sinal do app do motoboy (quem acabou
 * de ficar livre pega o que estava esperando) e no cron de entregas (a cada minuto).
 *
 * Entregue automático: pedido em rota com motoboy há 1h30 sem confirmação vira "Entregue
 * (automático)" (pedidos.entregue_automatico). O dinheiro com o motoboy continua pendente no
 * acerto: o gatilho caixa_turno_abre_na_entrega lança a pendência como em qualquer entrega sem
 * registro de pagamento.
 */

export const ONLINE_MS = 2 * 60_000
export const ENTREGUE_AUTOMATICO_MS = 90 * 60_000

export interface CandidatoMotoboy {
  id: string
  nome: string
  emRota: number
  /** Último sinal do app (ISO). */
  ultimoAcessoEm: string | null
  status: string
  desativado: boolean
  /** Última vez que saiu com uma entrega (ISO) — quem saiu há mais tempo está esperando há mais tempo. */
  ultimaSaidaEm: string | null
}

/** Quem leva o próximo pedido (ou null se ninguém está disponível). Pura — testada. */
export function escolherMotoboy(candidatos: CandidatoMotoboy[], agora = Date.now()): CandidatoMotoboy | null {
  const livres = candidatos.filter((c) => !c.desativado && c.status !== 'offline' && !!c.ultimoAcessoEm && agora - new Date(c.ultimoAcessoEm).getTime() < ONLINE_MS)
  if (!livres.length) return null
  const espera = (c: CandidatoMotoboy) => (c.ultimaSaidaEm ? new Date(c.ultimaSaidaEm).getTime() : 0)
  return [...livres].sort((a, b) => a.emRota - b.emRota || espera(a) - espera(b) || a.nome.localeCompare(b.nome))[0]
}

export async function despachoAutomaticoLigado(admin: SupabaseClient, restauranteId: string): Promise<boolean> {
  const { data } = await admin.from('restaurantes').select('despacho_automatico').eq('id', restauranteId).maybeSingle()
  return (data as { despacho_automatico?: boolean } | null)?.despacho_automatico === true
}

async function candidatos(admin: SupabaseClient, restauranteId: string): Promise<CandidatoMotoboy[]> {
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString()
  const [{ data: ents }, { data: rotas }, { data: saidas }] = await Promise.all([
    admin.from('entregadores').select('id, nome, status, ultimo_acesso_em, desativado_em, usuario_id').eq('restaurante_id', restauranteId),
    admin.from('pedidos').select('entregador_id').eq('restaurante_id', restauranteId).eq('status', 'em_rota'),
    admin.from('pedidos').select('entregador_id, em_rota_em').eq('restaurante_id', restauranteId).not('entregador_id', 'is', null).gte('em_rota_em', desde),
  ])
  const emRota = new Map<string, number>()
  for (const r of (rotas ?? []) as { entregador_id: string | null }[]) if (r.entregador_id) emRota.set(r.entregador_id, (emRota.get(r.entregador_id) ?? 0) + 1)
  const ultima = new Map<string, string>()
  for (const s of (saidas ?? []) as { entregador_id: string; em_rota_em: string | null }[]) {
    if (s.em_rota_em && (!ultima.get(s.entregador_id) || s.em_rota_em > ultima.get(s.entregador_id)!)) ultima.set(s.entregador_id, s.em_rota_em)
  }
  return ((ents ?? []) as { id: string; nome: string; status: string; ultimo_acesso_em: string | null; desativado_em: string | null }[]).map((e) => ({
    id: e.id, nome: e.nome, status: e.status, ultimoAcessoEm: e.ultimo_acesso_em, desativado: !!e.desativado_em,
    emRota: emRota.get(e.id) ?? 0, ultimaSaidaEm: ultima.get(e.id) ?? null,
  }))
}

export interface ResultadoDespacho { ligado: boolean; despachados: { pedidoId: string; numero: number; entregador: string }[]; semMotoboy: number }

/** Despacha os pedidos de entrega prontos da loja (se a chave estiver ligada). Seguro para rodar em paralelo. */
export async function despacharAutomaticamente(admin: SupabaseClient, restauranteId: string): Promise<ResultadoDespacho> {
  if (!(await despachoAutomaticoLigado(admin, restauranteId))) return { ligado: false, despachados: [], semMotoboy: 0 }
  const { data: prontos } = await admin.from('pedidos').select('id, numero')
    .eq('restaurante_id', restauranteId).eq('status', 'pronto').eq('tipo', 'entrega').is('entregador_id', null)
    .order('pronto_em', { ascending: true, nullsFirst: false }).limit(50)
  const lista = (prontos ?? []) as { id: string; numero: number }[]
  const r: ResultadoDespacho = { ligado: true, despachados: [], semMotoboy: 0 }
  if (!lista.length) return r
  const cands = await candidatos(admin, restauranteId)
  for (let i = 0; i < lista.length; i++) {
    const p = lista[i]
    const m = escolherMotoboy(cands)
    if (!m) { r.semMotoboy = lista.length - i; break }
    let ok: string[] = []
    try { ok = await atribuirEntregadorEmLoteSeguro(admin, restauranteId, [p.id], m.id) } catch { ok = [] }
    if (!ok.length) continue // outro despacho levou antes
    m.emRota += 1
    m.ultimaSaidaEm = new Date().toISOString()
    r.despachados.push({ pedidoId: p.id, numero: p.numero, entregador: m.nome })
    aplicarEfeitosStatusPedidoComTrava(admin, p.id, 'em_rota').catch((e) => console.error('[despacho automático] aviso', (e as Error).message))
    await registrarAuditoria(admin, {
      restauranteId, usuarioNome: 'Sistema (despacho automático)', acao: 'pedido.despacho_automatico',
      entidade: 'pedido', entidadeId: p.id, dados: { numero: p.numero, entregador_id: m.id, entregador: m.nome, em_rota_antes: m.emRota - 1 },
    }).catch(() => {})
  }
  return r
}

/** Pedidos em rota com motoboy há 1h30 sem confirmação → "Entregue (automático)". Todas as lojas. */
export async function marcarEntreguesAutomaticos(admin: SupabaseClient, agora = Date.now()): Promise<number> {
  const limite = new Date(agora - ENTREGUE_AUTOMATICO_MS).toISOString()
  const { data } = await admin.from('pedidos').select('id, numero, restaurante_id, entregador_id, em_rota_em')
    .eq('status', 'em_rota').not('entregador_id', 'is', null).lt('em_rota_em', limite).limit(200)
  let n = 0
  for (const p of (data ?? []) as { id: string; numero: number; restaurante_id: string; entregador_id: string; em_rota_em: string }[]) {
    const { data: feito } = await admin.from('pedidos').update({ status: 'entregue', entregue_automatico: true })
      .eq('id', p.id).eq('status', 'em_rota').select('id')
    if (!feito?.length) continue
    n++
    aplicarEfeitosStatusPedidoComTrava(admin, p.id, 'entregue').catch((e) => console.error('[entregue automático] efeitos', (e as Error).message))
    await registrarAuditoria(admin, {
      restauranteId: p.restaurante_id, usuarioNome: 'Sistema (entregue automático)', acao: 'pedido.entregue_automatico',
      entidade: 'pedido', entidadeId: p.id, dados: { numero: p.numero, entregador_id: p.entregador_id, em_rota_desde: p.em_rota_em },
    }).catch(() => {})
  }
  return n
}
