import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from './guarda'
import {
  cabecalhosLalamove, lerCidades, lerCotacao, lerMotorista, lerPedido, mensagemErroLalamove, montarCotacao, montarPedido,
  type AmbienteLalamove, type ChavesLalamove, type CidadeLalamove, type MotoristaLalamove, type ParadaLalamove, type PedidoLalamove,
  type PedidoParaLalamove, type RespostaCotacao,
} from '@/lib/entregas/lalamove-regras'

/**
 * Lalamove API v3 — a ÚNICA requisição à Lalamove do sistema (Regra nº 1, docs/REGRAS-DE-CUSTO.md). Toda chamada passa por
 * `chamarApiPaga` (api 'lalamove'): trava de disparo (mesma chave > 20/min), limite diário e alerta. Sem SDK (só fetch).
 * Sem nova tentativa: falhou, o lojista vê a mensagem e decide.
 *
 * A conta (chaves) é DA LOJA: quem chama já leu e decifrou as chaves (lib/entregas/queries.ts). Nada aqui loga chave,
 * corpo com telefone ou endereço — só o código HTTP e o tipo do erro.
 */
export class LalamoveError extends Error {
  readonly status: number
  readonly bruto: unknown
  constructor(mensagem: string, status: number, bruto: unknown) { super(mensagem); this.name = 'LalamoveError'; this.status = status; this.bruto = bruto }
}

const TIMEOUT_MS = 15_000
const LALAMOVE_URLS: Record<AmbienteLalamove, string> = { sandbox: 'https://rest.sandbox.lalamove.com', producao: 'https://rest.lalamove.com' }

/** Base: sandbox/produção oficiais; outra só se for servidor de teste local (e2e com API simulada). */
export function baseLalamove(ambiente: AmbienteLalamove): string {
  const b = process.env.LALAMOVE_BASE_URL?.trim()
  if (b && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b)) return b
  return LALAMOVE_URLS[ambiente]
}

export interface ContaLalamove { chaves: ChavesLalamove; ambiente: AmbienteLalamove }

type Opcoes = { fetch?: typeof fetch; agora?: () => number; requestId?: () => string }

async function chamar(
  admin: SupabaseClient, loja: string | null, conta: ContaLalamove, metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE', caminho: string,
  corpo: unknown, chaveGuarda: string, opcoes: Opcoes = {},
): Promise<unknown> {
  const texto = corpo === undefined ? '' : JSON.stringify(corpo)
  const buscar = opcoes.fetch ?? fetch
  const r = await chamarApiPaga(admin, { api: 'lalamove', chave: chaveGuarda, loja }, async () => {
    const ts = (opcoes.agora ?? Date.now)()
    const res = await buscar(`${baseLalamove(conta.ambiente)}${caminho}`, {
      method: metodo,
      headers: cabecalhosLalamove(conta.chaves, metodo, caminho, texto, ts, (opcoes.requestId ?? (() => crypto.randomUUID()))()),
      body: texto || undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const t = await res.text()
    let j: unknown = null
    try { j = t ? JSON.parse(t) : null } catch { j = t }
    if (!res.ok) {
      console.error(`[lalamove] ${metodo} ${caminho} → ${res.status}`)
      throw new LalamoveError(mensagemErroLalamove(res.status, j), res.status, j)
    }
    return j
  })
  if (r.ok) return r.valor
  if (r.motivo === 'erro') {
    // O erro original (LalamoveError) foi reduzido a texto pela guarda; reconstrói com a mensagem legível.
    const m = r.erro ?? ''
    throw new LalamoveError(m.startsWith('Lalamove') || /Lalamove|Chaves|saldo|cotação|cancelar/.test(m) ? m : 'Não foi possível falar com a Lalamove. Verifique a conexão.', 0, null)
  }
  if (r.motivo === 'disparo') throw new LalamoveError('Muitas chamadas iguais à Lalamove em 1 minuto — bloqueadas por segurança. Aguarde.', 429, null)
  if (r.motivo === 'limite') throw new LalamoveError('Limite diário de chamadas à Lalamove atingido. O suporte da Menuzia foi avisado.', 429, null)
  throw new LalamoveError('Sem contagem de uso no banco — chamada não feita.', 503, null)
}

/** GET /v3/cities (mercado BR): cidades atendidas e serviços. É o "Testar conexão". */
export async function cidadesLalamove(admin: SupabaseClient, loja: string, conta: ContaLalamove, opcoes?: Opcoes): Promise<CidadeLalamove[]> {
  return lerCidades(await chamar(admin, loja, conta, 'GET', '/v3/cities', undefined, `cidades:${loja}`, opcoes))
}

/** POST /v3/quotations: preço e distância. Não cria nada. Vale 5 minutos. */
export async function cotarLalamove(admin: SupabaseClient, loja: string, conta: ContaLalamove, servico: string, origem: ParadaLalamove, destino: ParadaLalamove, pedidoId: string, opcoes?: Opcoes): Promise<RespostaCotacao> {
  const bruto = await chamar(admin, loja, conta, 'POST', '/v3/quotations', montarCotacao(servico, origem, destino), `cotacao:${pedidoId}`, opcoes)
  const c = lerCotacao(bruto)
  if (!c) throw new LalamoveError('A Lalamove não devolveu um preço para esta entrega.', 200, bruto)
  return c
}

/** POST /v3/orders: cria a corrida a partir da cotação. ÚNICA chamada que gera cobrança para a loja. */
export async function criarCorridaLalamove(admin: SupabaseClient, loja: string, conta: ContaLalamove, cotacao: RespostaCotacao, lojaDados: { nome: string; telefone: string }, pedido: PedidoParaLalamove, pedidoId: string, opcoes?: Opcoes): Promise<PedidoLalamove> {
  const bruto = await chamar(admin, loja, conta, 'POST', '/v3/orders', montarPedido(cotacao, lojaDados, pedido, pedidoId), `corrida:${pedidoId}`, opcoes)
  const p = lerPedido(bruto)
  if (!p) throw new LalamoveError('A Lalamove aceitou mas não devolveu o número da corrida.', 200, bruto)
  return p
}

/** GET /v3/orders/{id}: a verdade sobre a corrida (o webhook só avisa; o status vem daqui). */
export async function consultarCorridaLalamove(admin: SupabaseClient, loja: string, conta: ContaLalamove, orderId: string, opcoes?: Opcoes): Promise<PedidoLalamove> {
  const p = lerPedido(await chamar(admin, loja, conta, 'GET', `/v3/orders/${encodeURIComponent(orderId)}`, undefined, `corrida-consulta:${orderId}`, opcoes))
  if (!p) throw new LalamoveError('A Lalamove não devolveu a corrida.', 200, null)
  return p
}

/** GET /v3/orders/{id}/drivers/{driverId}: nome, telefone e placa (mascarada). 403 fora da janela = null. */
export async function motoristaLalamove(admin: SupabaseClient, loja: string, conta: ContaLalamove, orderId: string, driverId: string, opcoes?: Opcoes): Promise<MotoristaLalamove | null> {
  try {
    return lerMotorista(await chamar(admin, loja, conta, 'GET', `/v3/orders/${encodeURIComponent(orderId)}/drivers/${encodeURIComponent(driverId)}`, undefined, `motorista:${orderId}`, opcoes))
  } catch (e) {
    if (e instanceof LalamoveError && (e.status === 403 || e.status === 404)) return null
    throw e
  }
}

/** DELETE /v3/orders/{id}: só em ASSIGNING_DRIVER ou até 5 min após o aceite; depois a Lalamove devolve 409. */
export async function cancelarCorridaLalamove(admin: SupabaseClient, loja: string, conta: ContaLalamove, orderId: string, opcoes?: Opcoes): Promise<void> {
  await chamar(admin, loja, conta, 'DELETE', `/v3/orders/${encodeURIComponent(orderId)}`, undefined, `cancelar:${orderId}`, opcoes)
}

/** PATCH /v3/webhook: registra a URL que recebe os eventos (uma por conta/ambiente). */
export async function registrarWebhookLalamove(admin: SupabaseClient, loja: string, conta: ContaLalamove, url: string, opcoes?: Opcoes): Promise<void> {
  await chamar(admin, loja, conta, 'PATCH', '/v3/webhook', { data: { url } }, `webhook:${loja}`, opcoes)
}
