import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { cifrar, decifrar } from './cripto'
import { ErroMp, novoPkce, provedorMp, urlAutorizacao, type TokensMp } from './mercadopago'

/**
 * Conta do Mercado Pago de cada loja (Pix online, 0148). Tokens só cifrados no banco
 * (`pagamentos_contas`, sem policy) e só aqui decifrados — nunca vão ao navegador nem ao log.
 */
export const RENOVAR_ANTES_DIAS = 30

export function redirectUriMp(): string {
  return process.env.MP_REDIRECT_URI?.trim() || `${(process.env.APP_URL?.trim() || 'https://app.menuzia.com.br').replace(/\/$/, '')}/api/integracoes/mercadopago/retorno`
}

export function webhookUrlMp(): string | null {
  if (process.env.MP_PROVEDOR === 'simulado') return null
  return `${(process.env.APP_URL?.trim() || 'https://app.menuzia.com.br').replace(/\/$/, '')}/api/webhooks/mercadopago`
}

/** Mascara o e-mail da conta para a tela: "lo•••@gmail.com". */
export function mascararEmail(email: string | null): string | null {
  if (!email || !email.includes('@')) return null
  const [u, d] = email.split('@')
  return `${u.slice(0, 2)}•••@${d}`
}

/** Início da conexão: guarda o state (com o verificador PKCE cifrado) e devolve a URL do MP. */
export async function iniciarConexao(admin: SupabaseClient, p: { restauranteId: string; usuarioId: string; usuarioNome: string | null }): Promise<string> {
  const state = randomBytes(24).toString('base64url')
  const { verificador, desafio } = novoPkce()
  await admin.from('pagamentos_oauth_estados').delete().lt('expira_em', new Date().toISOString())
  const { error } = await admin.from('pagamentos_oauth_estados').insert({
    state, restaurante_id: p.restauranteId, usuario_id: p.usuarioId, usuario_nome: p.usuarioNome, verificador_cifrado: cifrar(verificador),
  })
  if (error) throw error
  if (process.env.MP_PROVEDOR === 'simulado') {
    return `/api/integracoes/mercadopago/simulado?state=${encodeURIComponent(state)}&desafio=${encodeURIComponent(desafio)}`
  }
  return urlAutorizacao({ clientId: process.env.MP_CLIENT_ID ?? '', redirectUri: redirectUriMp(), state, desafio })
}

async function gravarTokens(admin: SupabaseClient, restauranteId: string, t: TokensMp, extra: Record<string, unknown>) {
  const { error } = await admin.from('pagamentos_contas').upsert({
    restaurante_id: restauranteId, mp_user_id: t.userId, access_token_cifrado: cifrar(t.accessToken), refresh_token_cifrado: cifrar(t.refreshToken),
    expira_em: t.expiraEm, status: 'conectada', erro: null, atualizado_em: new Date().toISOString(), ...extra,
  }, { onConflict: 'restaurante_id' })
  if (error) throw error
}

/**
 * Volta do MP: confere o state (existe, não venceu, é da loja/usuário da sessão), troca o código
 * pelos tokens e grava. O state é usado UMA vez.
 */
export async function concluirConexao(admin: SupabaseClient, p: { state: string; codigo: string; restauranteId: string; usuarioId: string }): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const { data: est } = await admin.from('pagamentos_oauth_estados').select('*').eq('state', p.state).maybeSingle()
  if (!est) return { ok: false, motivo: 'state_desconhecido' }
  await admin.from('pagamentos_oauth_estados').delete().eq('state', p.state)
  if (new Date(est.expira_em).getTime() < Date.now()) return { ok: false, motivo: 'state_vencido' }
  if (est.restaurante_id !== p.restauranteId || est.usuario_id !== p.usuarioId) return { ok: false, motivo: 'state_de_outra_sessao' }
  try {
    const mp = provedorMp()
    const tokens = await mp.trocarCodigo({ codigo: p.codigo, verificador: decifrar(est.verificador_cifrado), redirectUri: redirectUriMp() })
    const conta = await mp.conta(tokens.accessToken).catch(() => ({ id: tokens.userId, apelido: null, email: null }))
    await gravarTokens(admin, p.restauranteId, tokens, {
      apelido: conta.apelido, email_mascarado: mascararEmail(conta.email), ambiente: tokens.liveMode === false ? 'teste' : 'producao',
      conectado_por: est.usuario_id, conectado_por_nome: est.usuario_nome, conectado_em: new Date().toISOString(), renovado_em: null,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, motivo: e instanceof ErroMp ? `mp_${e.status}` : 'falha_troca' }
  }
}

export interface ContaPublica { conectada: boolean; status: string | null; apelido: string | null; email: string | null; desde: string | null; final: string | null; ambiente: string | null; erro: string | null }

/** O que a tela pode ver: nunca token. */
export async function contaPublica(admin: SupabaseClient, restauranteId: string): Promise<ContaPublica> {
  const { data } = await admin.from('pagamentos_contas').select('mp_user_id, apelido, email_mascarado, status, conectado_em, ambiente, erro').eq('restaurante_id', restauranteId).maybeSingle()
  if (!data) return { conectada: false, status: null, apelido: null, email: null, desde: null, final: null, ambiente: null, erro: null }
  return {
    conectada: data.status === 'conectada', status: data.status, apelido: data.apelido, email: data.email_mascarado, desde: data.conectado_em,
    final: data.mp_user_id ? String(data.mp_user_id).slice(-4) : null, ambiente: data.ambiente, erro: data.erro,
  }
}

export async function desconectar(admin: SupabaseClient, restauranteId: string) {
  await admin.from('pagamentos_contas').delete().eq('restaurante_id', restauranteId)
}

/**
 * Token válido da loja: renova sozinho quando falta menos de RENOVAR_ANTES_DIAS (ou com `forcar`,
 * depois de um 401). Falhou a renovação → conta "erro" (a vitrine para de oferecer o Pix online) e null.
 */
export async function tokenDaLoja(admin: SupabaseClient, restauranteId: string, opcoes: { forcar?: boolean } = {}): Promise<{ token: string; mpUserId: string } | null> {
  const { data: c } = await admin.from('pagamentos_contas').select('*').eq('restaurante_id', restauranteId).maybeSingle()
  if (!c || c.status === 'desconectada') return null
  const falta = new Date(c.expira_em).getTime() - Date.now()
  if (!opcoes.forcar && c.status === 'conectada' && falta > RENOVAR_ANTES_DIAS * 86_400_000) return { token: decifrar(c.access_token_cifrado), mpUserId: c.mp_user_id }
  try {
    const t = await provedorMp().renovar(decifrar(c.refresh_token_cifrado))
    await gravarTokens(admin, restauranteId, t, { renovado_em: new Date().toISOString() })
    return { token: t.accessToken, mpUserId: t.userId || c.mp_user_id }
  } catch (e) {
    // Token atual ainda vale (só faltam dias): segue com ele e tenta renovar de novo depois.
    if (!opcoes.forcar && falta > 0 && c.status === 'conectada') return { token: decifrar(c.access_token_cifrado), mpUserId: c.mp_user_id }
    await admin.from('pagamentos_contas').update({ status: 'erro', erro: e instanceof ErroMp ? `renovação recusada pelo MP (${e.status})` : 'renovação falhou', atualizado_em: new Date().toISOString() }).eq('restaurante_id', restauranteId)
    return null
  }
}

/** Chama o MP com o token da loja; num 401, renova uma vez e tenta de novo. */
export async function comTokenDaLoja<T>(admin: SupabaseClient, restauranteId: string, f: (token: string, mpUserId: string) => Promise<T>): Promise<T> {
  const a = await tokenDaLoja(admin, restauranteId)
  if (!a) throw new ErroMp(401, 'conta do Mercado Pago desconectada')
  try {
    return await f(a.token, a.mpUserId)
  } catch (e) {
    if (!(e instanceof ErroMp) || e.status !== 401) throw e
    const b = await tokenDaLoja(admin, restauranteId, { forcar: true })
    if (!b) throw new ErroMp(401, 'conta do Mercado Pago desconectada')
    return f(b.token, b.mpUserId)
  }
}
