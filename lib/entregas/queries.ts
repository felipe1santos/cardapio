import type { SupabaseClient } from '@supabase/supabase-js'
import { cifrar, criptografiaPronta, decifrar } from '@/lib/pagamentos/cripto'
import type { AmbienteLalamove, ChavesLalamove } from './lalamove-regras'
import { ENTREGA_PROVEDOR_SELECT, mapEntregaProvedor, type EntregaProvedorLinha } from './lalamove-status'

/**
 * Acesso a `entregas_provedor_config` (chaves cifradas — só service_role) e `entregas_provedor` (0199).
 * SERVER-ONLY: decifra as chaves da loja. O navegador recebe só `ConfigPublica`.
 */
export const PROVEDOR = 'lalamove'
/** Provedores de entrega (0208): a Lalamove e, pela MESMA tabela/vocabulário de status, iFood Sob Demanda e Foody. */
export type ProvedorEntrega = 'lalamove' | 'ifood' | 'foody' | 'machine' | 'uber'
/**
 * 20/10: provedor liberado para conectar. iFood Sob Demanda depende do aplicativo iFood homologado → "Em breve".
 * Machine (Gaudium, 20/10): logística Open Delivery como a Foody, mas as credenciais vêm da central Machine da cidade
 * (não é autoatendimento) → "Em breve" até a primeira loja receber URL base + client id/secret e o teste passar.
 */
// Uber Direct (21/10): liberada para todas as lojas pelo servidor (ENTREGAS_UBER_LIBERADO=1 no Coolify).
export const PROVEDOR_DISPONIVEL: Record<ProvedorEntrega, boolean> = { lalamove: true, ifood: false, foody: true, machine: false, uber: process.env.ENTREGAS_UBER_LIBERADO === '1' }

export interface ConfigProvedor {
  restauranteId: string
  ativo: boolean
  ambiente: AmbienteLalamove
  /** Null quando a loja ainda não colou as chaves (ou a chave do cofre não está no servidor). */
  chaves: ChavesLalamove | null
  apiKeyFinal: string
  cidadeLocode: string
  cidadeNome: string
  servico: string
  webhookToken: string
  webhookRegistradoEm: string | null
  /** Foody (Open Delivery): URL base da API do provedor. */
  baseUrl: string
  provedor: ProvedorEntrega
  /** Uber Direct (0215): customer_id da conta (não é segredo). */
  contaId: string
  /** Uber Direct (0215): signing key do webhook, decifrada. Null = não salva. */
  webhookSegredo: string | null
}

export interface ConfigPublica {
  ativo: boolean
  ambiente: AmbienteLalamove
  temChaves: boolean
  apiKeyFinal: string
  cidadeLocode: string
  cidadeNome: string
  servico: string
  webhookToken: string
  webhookRegistradoEm: string | null
  baseUrl: string
  provedor: ProvedorEntrega
  contaId: string
  temWebhookSegredo: boolean
}

const SELECT = 'restaurante_id, ativo, ambiente, api_key_cifrada, api_secret_cifrada, api_key_final, cidade_locode, cidade_nome, servico, webhook_token, webhook_registrado_em, base_url, conta_id, webhook_segredo_cifrado'

function segredoDecifrado(v: unknown): string | null {
  if (!v || !criptografiaPronta()) return null
  try { return decifrar(String(v)) } catch { return null }
}

function mapConfig(r: Record<string, unknown>): ConfigProvedor {
  let chaves: ChavesLalamove | null = null
  if (r.api_key_cifrada && r.api_secret_cifrada && criptografiaPronta()) {
    try { chaves = { apiKey: decifrar(String(r.api_key_cifrada)), apiSecret: decifrar(String(r.api_secret_cifrada)) } } catch { chaves = null }
  }
  return {
    restauranteId: String(r.restaurante_id), ativo: r.ativo === true, ambiente: r.ambiente === 'producao' ? 'producao' : 'sandbox', chaves,
    apiKeyFinal: String(r.api_key_final ?? ''), cidadeLocode: String(r.cidade_locode ?? ''), cidadeNome: String(r.cidade_nome ?? ''),
    servico: String(r.servico ?? 'MOTORCYCLE'), webhookToken: String(r.webhook_token), webhookRegistradoEm: (r.webhook_registrado_em as string | null) ?? null,
    baseUrl: String(r.base_url ?? ''), provedor: (r.provedor as ProvedorEntrega) ?? 'lalamove',
    contaId: String(r.conta_id ?? ''), webhookSegredo: segredoDecifrado(r.webhook_segredo_cifrado),
  }
}

export function paraPublica(c: ConfigProvedor): ConfigPublica {
  return { ativo: c.ativo, ambiente: c.ambiente, temChaves: !!c.chaves, apiKeyFinal: c.apiKeyFinal, cidadeLocode: c.cidadeLocode, cidadeNome: c.cidadeNome, servico: c.servico, webhookToken: c.webhookToken, webhookRegistradoEm: c.webhookRegistradoEm, baseUrl: c.baseUrl, provedor: c.provedor, contaId: c.contaId, temWebhookSegredo: !!c.webhookSegredo }
}

export async function buscarConfig(admin: SupabaseClient, restauranteId: string, provedor: ProvedorEntrega = PROVEDOR): Promise<ConfigProvedor | null> {
  const { data, error } = await admin.from('entregas_provedor_config').select(SELECT).eq('restaurante_id', restauranteId).eq('provedor', provedor).maybeSingle()
  if (error) throw error
  return data ? mapConfig(data as Record<string, unknown>) : null
}

export async function buscarConfigPorToken(admin: SupabaseClient, token: string, provedor: ProvedorEntrega = PROVEDOR): Promise<ConfigProvedor | null> {
  if (!/^[\w-]{10,80}$/.test(token)) return null
  const { data, error } = await admin.from('entregas_provedor_config').select(SELECT).eq('webhook_token', token).eq('provedor', provedor).maybeSingle()
  if (error) throw error
  return data ? mapConfig(data as Record<string, unknown>) : null
}

export interface ConfigPatch {
  ativo?: boolean
  ambiente?: AmbienteLalamove
  /** As duas juntas; ausentes preservam as atuais; null apaga. */
  chaves?: ChavesLalamove | null
  cidadeLocode?: string
  cidadeNome?: string
  servico?: string
  webhookRegistradoEm?: string | null
  porNome?: string
  baseUrl?: string
  /** Uber Direct (0215). */
  contaId?: string
  /** Uber Direct: signing key do webhook; null apaga. */
  webhookSegredo?: string | null
}

export async function salvarConfig(admin: SupabaseClient, restauranteId: string, p: ConfigPatch, provedor: ProvedorEntrega = PROVEDOR): Promise<ConfigProvedor> {
  const linha: Record<string, unknown> = { restaurante_id: restauranteId, provedor }
  if (p.baseUrl !== undefined) linha.base_url = p.baseUrl.trim().replace(/\/+$/, '').slice(0, 300)
  if (p.ativo !== undefined) linha.ativo = p.ativo
  if (p.ambiente) linha.ambiente = p.ambiente
  if (p.chaves === null) { linha.api_key_cifrada = null; linha.api_secret_cifrada = null; linha.api_key_final = ''; linha.ativo = false }
  else if (p.chaves) {
    if (!criptografiaPronta()) throw new Error('PAGAMENTOS_CHAVE ausente no servidor: não dá para guardar as chaves com segurança.')
    linha.api_key_cifrada = cifrar(p.chaves.apiKey); linha.api_secret_cifrada = cifrar(p.chaves.apiSecret); linha.api_key_final = p.chaves.apiKey.slice(-4)
  }
  if (p.contaId !== undefined) linha.conta_id = p.contaId.trim().slice(0, 80)
  if (p.webhookSegredo === null) linha.webhook_segredo_cifrado = null
  else if (p.webhookSegredo) {
    if (!criptografiaPronta()) throw new Error('PAGAMENTOS_CHAVE ausente no servidor: não dá para guardar as chaves com segurança.')
    linha.webhook_segredo_cifrado = cifrar(p.webhookSegredo)
  }
  if (p.cidadeLocode !== undefined) linha.cidade_locode = p.cidadeLocode
  if (p.cidadeNome !== undefined) linha.cidade_nome = p.cidadeNome
  if (p.servico !== undefined) linha.servico = p.servico
  if (p.webhookRegistradoEm !== undefined) linha.webhook_registrado_em = p.webhookRegistradoEm
  if (p.porNome) linha.atualizado_por_nome = p.porNome
  const { data, error } = await admin.from('entregas_provedor_config').upsert(linha, { onConflict: 'restaurante_id,provedor' }).select(SELECT).single()
  if (error) throw error
  return mapConfig(data as Record<string, unknown>)
}

// ── Corridas ─────────────────────────────────────────────────────────────────

export async function corridaAtivaDoPedido(admin: SupabaseClient, pedidoId: string): Promise<EntregaProvedorLinha | null> {
  const { data, error } = await admin.from('entregas_provedor').select(ENTREGA_PROVEDOR_SELECT).eq('pedido_id', pedidoId).in('status', ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']).maybeSingle()
  if (error) throw error
  return data ? mapEntregaProvedor(data as Record<string, unknown>) : null
}

export async function buscarCorrida(admin: SupabaseClient, id: string): Promise<EntregaProvedorLinha | null> {
  const { data, error } = await admin.from('entregas_provedor').select(ENTREGA_PROVEDOR_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return data ? mapEntregaProvedor(data as Record<string, unknown>) : null
}

export async function buscarCorridaPorExterno(admin: SupabaseClient, externoId: string, provedor: ProvedorEntrega = PROVEDOR): Promise<EntregaProvedorLinha | null> {
  const { data, error } = await admin.from('entregas_provedor').select(ENTREGA_PROVEDOR_SELECT).eq('provedor', provedor).eq('externo_id', externoId).maybeSingle()
  if (error) throw error
  return data ? mapEntregaProvedor(data as Record<string, unknown>) : null
}

/** Reserva a linha ANTES de chamar a Lalamove: o índice único por pedido ativo barra o 2º clique. */
export async function criarCorrida(admin: SupabaseClient, p: { restauranteId: string; pedidoId: string; ambiente: AmbienteLalamove; cotacaoId: string; preco: number; distanciaM: number | null; porNome: string; provedor?: ProvedorEntrega }): Promise<EntregaProvedorLinha> {
  const { data, error } = await admin.from('entregas_provedor').insert({
    restaurante_id: p.restauranteId, pedido_id: p.pedidoId, provedor: p.provedor ?? PROVEDOR, ambiente: p.ambiente, cotacao_id: p.cotacaoId, preco: p.preco,
    distancia_m: p.distanciaM, status: 'ASSIGNING_DRIVER', criado_por_nome: p.porNome,
  }).select(ENTREGA_PROVEDOR_SELECT).single()
  if (error) {
    if (error.code === '23505') throw new Error('Este pedido já tem uma corrida de entregador em andamento.')
    throw error
  }
  return mapEntregaProvedor(data as Record<string, unknown>)
}

export async function apagarCorrida(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('entregas_provedor').delete().eq('id', id)
}

export interface CorridaPatch {
  externoId?: string | null
  status?: string
  preco?: number | null
  distanciaM?: number | null
  shareLink?: string | null
  motoristaId?: string | null
  motoristaNome?: string | null
  motoristaTelefone?: string | null
  motoristaPlaca?: string | null
  clienteAvisadoEm?: string | null
  custoLancadoEm?: string | null
  canceladoPorNome?: string | null
  erro?: string | null
}

export async function atualizarCorrida(admin: SupabaseClient, id: string, p: CorridaPatch): Promise<void> {
  const linha: Record<string, unknown> = {}
  if (p.externoId !== undefined) linha.externo_id = p.externoId
  if (p.status !== undefined) linha.status = p.status
  if (p.preco !== undefined) linha.preco = p.preco
  if (p.distanciaM !== undefined) linha.distancia_m = p.distanciaM
  if (p.shareLink !== undefined) linha.share_link = p.shareLink
  if (p.motoristaId !== undefined) linha.motorista_id = p.motoristaId
  if (p.motoristaNome !== undefined) linha.motorista_nome = p.motoristaNome
  if (p.motoristaTelefone !== undefined) linha.motorista_telefone = p.motoristaTelefone
  if (p.motoristaPlaca !== undefined) linha.motorista_placa = p.motoristaPlaca
  if (p.clienteAvisadoEm !== undefined) linha.cliente_avisado_em = p.clienteAvisadoEm
  if (p.custoLancadoEm !== undefined) linha.custo_lancado_em = p.custoLancadoEm
  if (p.canceladoPorNome !== undefined) linha.cancelado_por_nome = p.canceladoPorNome
  if (p.erro !== undefined) linha.erro = p.erro
  if (!Object.keys(linha).length) return
  const { error } = await admin.from('entregas_provedor').update(linha).eq('id', id)
  if (error) throw error
}

/** Histórico append-only dos eventos (webhook, consulta, cancelamento) — para o suporte reconstruir o que aconteceu. */
export async function registrarEventoCorrida(admin: SupabaseClient, id: string, evento: Record<string, unknown>): Promise<void> {
  const { data } = await admin.from('entregas_provedor').select('eventos').eq('id', id).maybeSingle()
  const lista = Array.isArray(data?.eventos) ? (data!.eventos as unknown[]) : []
  lista.push({ em: new Date().toISOString(), ...evento })
  await admin.from('entregas_provedor').update({ eventos: lista.slice(-60) }).eq('id', id).then(() => {}, () => {})
}

/** Marcos da corrida que já foram feitos (aviso ao cliente, custo lançado) — lidos só no servidor. */
export async function marcosDaCorrida(admin: SupabaseClient, id: string): Promise<{ clienteAvisadoEm: string | null; custoLancadoEm: string | null; motoristaId: string | null }> {
  const { data } = await admin.from('entregas_provedor').select('cliente_avisado_em, custo_lancado_em, motorista_id').eq('id', id).maybeSingle()
  return { clienteAvisadoEm: (data?.cliente_avisado_em as string | null) ?? null, custoLancadoEm: (data?.custo_lancado_em as string | null) ?? null, motoristaId: (data?.motorista_id as string | null) ?? null }
}
