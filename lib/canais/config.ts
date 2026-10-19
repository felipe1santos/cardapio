import type { SupabaseClient } from '@supabase/supabase-js'
import { cifrar, criptografiaPronta, decifrar } from '@/lib/pagamentos/cripto'
import { CANAIS, type Canal } from './tipos'

/**
 * Configuração de cada canal externo por loja (0207: canais_config). Segredos cifrados com a chave do cofre
 * (PAGAMENTOS_CHAVE, a mesma do Mercado Pago/Lalamove); nunca saem para o navegador (ConfigCanalPublica).
 */
export interface ConfigCanal {
  restauranteId: string
  canal: Canal
  ativo: boolean
  ambiente: 'sandbox' | 'producao'
  baseUrl: string
  credenciais: { clientId: string; clientSecret: string } | null
  clientIdFinal: string
  merchantIdExterno: string
  appIdExterno: string
  refreshToken: string | null
  accessToken: string | null
  tokenExpiraEm: string | null
  webhookToken: string
  pollingUltimoEm: string | null
  pollingUltimoErro: string | null
  ultimoPedidoEm: string | null
}

export interface ConfigCanalPublica {
  canal: Canal
  ativo: boolean
  ambiente: 'sandbox' | 'producao'
  baseUrl: string
  temCredenciais: boolean
  clientIdFinal: string
  merchantIdExterno: string
  appIdExterno: string
  autorizado: boolean
  webhookToken: string
  pollingUltimoEm: string | null
  pollingUltimoErro: string | null
  ultimoPedidoEm: string | null
  cofrePronto: boolean
}

const SELECT = 'restaurante_id, canal, ativo, ambiente, base_url, client_id_cifrado, client_secret_cifrado, client_id_final, merchant_id_externo, app_id_externo, refresh_token_cifrado, access_token_cifrado, token_expira_em, webhook_token, polling_ultimo_em, polling_ultimo_erro, ultimo_pedido_em'

const dec = (v: unknown): string | null => { if (!v || !criptografiaPronta()) return null; try { return decifrar(String(v)) } catch { return null } }

function mapear(r: Record<string, unknown>): ConfigCanal {
  const clientId = dec(r.client_id_cifrado)
  const clientSecret = dec(r.client_secret_cifrado)
  return {
    restauranteId: String(r.restaurante_id), canal: r.canal as Canal, ativo: r.ativo === true, ambiente: r.ambiente === 'producao' ? 'producao' : 'sandbox',
    baseUrl: String(r.base_url ?? ''), credenciais: clientId && clientSecret ? { clientId, clientSecret } : null, clientIdFinal: String(r.client_id_final ?? ''),
    merchantIdExterno: String(r.merchant_id_externo ?? ''), appIdExterno: String(r.app_id_externo ?? ''),
    refreshToken: dec(r.refresh_token_cifrado), accessToken: dec(r.access_token_cifrado), tokenExpiraEm: (r.token_expira_em as string | null) ?? null,
    webhookToken: String(r.webhook_token), pollingUltimoEm: (r.polling_ultimo_em as string | null) ?? null, pollingUltimoErro: (r.polling_ultimo_erro as string | null) ?? null,
    ultimoPedidoEm: (r.ultimo_pedido_em as string | null) ?? null,
  }
}

export function paraPublica(c: ConfigCanal): ConfigCanalPublica {
  return {
    canal: c.canal, ativo: c.ativo, ambiente: c.ambiente, baseUrl: c.baseUrl, temCredenciais: !!c.credenciais, clientIdFinal: c.clientIdFinal,
    merchantIdExterno: c.merchantIdExterno, appIdExterno: c.appIdExterno, autorizado: !!(c.refreshToken || c.accessToken), webhookToken: c.webhookToken,
    pollingUltimoEm: c.pollingUltimoEm, pollingUltimoErro: c.pollingUltimoErro, ultimoPedidoEm: c.ultimoPedidoEm, cofrePronto: criptografiaPronta(),
  }
}

export const canalValido = (v: unknown): v is Canal => typeof v === 'string' && (CANAIS as readonly string[]).includes(v)

export async function buscarConfigCanal(admin: SupabaseClient, restauranteId: string, canal: Canal): Promise<ConfigCanal | null> {
  const { data, error } = await admin.from('canais_config').select(SELECT).eq('restaurante_id', restauranteId).eq('canal', canal).maybeSingle()
  if (error) throw error
  return data ? mapear(data as Record<string, unknown>) : null
}

export async function buscarConfigPorWebhookToken(admin: SupabaseClient, token: string): Promise<ConfigCanal | null> {
  const { data, error } = await admin.from('canais_config').select(SELECT).eq('webhook_token', token).maybeSingle()
  if (error) throw error
  return data ? mapear(data as Record<string, unknown>) : null
}

/** Todas as lojas com o canal ligado (o cron de polling percorre esta lista). */
export async function listarCanaisAtivos(admin: SupabaseClient): Promise<ConfigCanal[]> {
  const { data, error } = await admin.from('canais_config').select(SELECT).eq('ativo', true)
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(mapear)
}

export interface PatchCanal {
  ativo?: boolean
  ambiente?: 'sandbox' | 'producao'
  baseUrl?: string
  credenciais?: { clientId: string; clientSecret: string } | null
  merchantIdExterno?: string
  appIdExterno?: string
  porNome?: string
}

export async function salvarConfigCanal(admin: SupabaseClient, restauranteId: string, canal: Canal, p: PatchCanal): Promise<ConfigCanal> {
  const linha: Record<string, unknown> = { restaurante_id: restauranteId, canal, atualizado_em: new Date().toISOString() }
  if (p.ativo !== undefined) linha.ativo = p.ativo
  if (p.ambiente !== undefined) linha.ambiente = p.ambiente
  if (p.baseUrl !== undefined) linha.base_url = p.baseUrl.trim().replace(/\/+$/, '').slice(0, 300)
  if (p.merchantIdExterno !== undefined) linha.merchant_id_externo = p.merchantIdExterno.trim().slice(0, 120)
  if (p.appIdExterno !== undefined) linha.app_id_externo = p.appIdExterno.trim().slice(0, 120)
  if (p.porNome !== undefined) linha.atualizado_por_nome = p.porNome.slice(0, 120)
  if (p.credenciais === null) { linha.client_id_cifrado = null; linha.client_secret_cifrado = null; linha.client_id_final = ''; linha.access_token_cifrado = null; linha.refresh_token_cifrado = null; linha.token_expira_em = null }
  else if (p.credenciais) {
    if (!criptografiaPronta()) throw new Error('cofre_indisponivel')
    linha.client_id_cifrado = cifrar(p.credenciais.clientId); linha.client_secret_cifrado = cifrar(p.credenciais.clientSecret); linha.client_id_final = p.credenciais.clientId.slice(-4)
    linha.access_token_cifrado = null; linha.token_expira_em = null
  }
  const { data, error } = await admin.from('canais_config').upsert(linha, { onConflict: 'restaurante_id,canal' }).select(SELECT).single()
  if (error) throw error
  return mapear(data as Record<string, unknown>)
}

/** Guarda o token de acesso (e o refresh, quando houver) cifrados, para não pedir um novo a cada chamada. */
export async function guardarToken(admin: SupabaseClient, c: ConfigCanal, t: { accessToken: string; expiraEmSeg: number; refreshToken?: string | null }): Promise<void> {
  if (!criptografiaPronta()) return
  const linha: Record<string, unknown> = { access_token_cifrado: cifrar(t.accessToken), token_expira_em: new Date(Date.now() + Math.max(60, t.expiraEmSeg - 60) * 1000).toISOString(), atualizado_em: new Date().toISOString() }
  if (t.refreshToken !== undefined) linha.refresh_token_cifrado = t.refreshToken ? cifrar(t.refreshToken) : null
  await admin.from('canais_config').update(linha).eq('restaurante_id', c.restauranteId).eq('canal', c.canal)
}

export async function registrarPolling(admin: SupabaseClient, c: ConfigCanal, erro: string | null, pedidoNovo = false): Promise<void> {
  const linha: Record<string, unknown> = { polling_ultimo_em: new Date().toISOString(), polling_ultimo_erro: erro ? erro.slice(0, 300) : null }
  if (pedidoNovo) linha.ultimo_pedido_em = new Date().toISOString()
  await admin.from('canais_config').update(linha).eq('restaurante_id', c.restauranteId).eq('canal', c.canal)
}
