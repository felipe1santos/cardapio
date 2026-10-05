import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import QRCode from 'qrcode'

/**
 * Cliente do Mercado Pago (Pix online, 2026-10-04). Só o servidor usa: tokens nunca saem daqui.
 *
 * `MP_PROVEDOR=simulado` (só local/testes): nada sai pela rede; o "MP" é um arquivo JSON em
 * `MP_SIMULADO_ARQUIVO` (cobranças, contas, reembolsos). O teste aprova/expira mexendo no arquivo
 * e manda o webhook assinado — o servidor conferindo pela "API" simulada, igual ao real.
 */
export const MP_API = 'https://api.mercadopago.com'
export const MP_AUTH = 'https://auth.mercadopago.com.br/authorization'

export interface TokensMp { accessToken: string; refreshToken: string; userId: string; expiraEm: string; publicKey?: string | null; liveMode?: boolean }
export interface CobrancaPix {
  id: string; status: string; qrCode: string; qrCodeBase64: string; ticketUrl: string | null; expiraEm: string
}
export interface PagamentoMp {
  id: string; status: string; statusDetail: string | null; externalReference: string | null
  valor: number; moeda: string; coletorId: string | null; taxa: number; liquido: number | null
  aprovadoEm: string | null; metodo: string | null
}
export interface ReembolsoMp { id: string; status: string; valor: number }

export interface ProvedorMp {
  trocarCodigo(p: { codigo: string; verificador: string; redirectUri: string }): Promise<TokensMp>
  renovar(refreshToken: string): Promise<TokensMp>
  conta(accessToken: string): Promise<{ id: string; apelido: string | null; email: string | null }>
  criarPix(accessToken: string, p: { valor: number; descricao: string; referencia: string; expiraEm: string; email: string; notificacaoUrl: string | null; idempotencia: string }): Promise<CobrancaPix>
  consultar(accessToken: string, pagamentoId: string): Promise<PagamentoMp>
  cancelar(accessToken: string, pagamentoId: string): Promise<void>
  reembolsar(accessToken: string, pagamentoId: string, idempotencia: string): Promise<ReembolsoMp>
}

export class ErroMp extends Error {
  constructor(public status: number, mensagem: string) { super(mensagem) }
}

// ── PKCE e state ──────────────────────────────────────────────────────────────────────────────
export function novoPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(48).toString('base64url')
  return { verificador, desafio: createHash('sha256').update(verificador).digest('base64url') }
}

export function urlAutorizacao(p: { clientId: string; redirectUri: string; state: string; desafio: string }): string {
  const u = new URL(MP_AUTH)
  u.searchParams.set('client_id', p.clientId)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('platform_id', 'mp')
  u.searchParams.set('state', p.state)
  u.searchParams.set('redirect_uri', p.redirectUri)
  u.searchParams.set('code_challenge', p.desafio)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

// ── Real ─────────────────────────────────────────────────────────────────────────────────────
function lerTokens(j: Record<string, unknown>): TokensMp {
  const expiraSeg = Number(j.expires_in ?? 15552000)
  return {
    accessToken: String(j.access_token ?? ''), refreshToken: String(j.refresh_token ?? ''), userId: String(j.user_id ?? ''),
    expiraEm: new Date(Date.now() + expiraSeg * 1000).toISOString(), publicKey: (j.public_key as string) ?? null, liveMode: Boolean(j.live_mode),
  }
}

export function lerPagamento(j: Record<string, unknown>): PagamentoMp {
  const taxas = Array.isArray(j.fee_details) ? (j.fee_details as { amount?: number }[]).reduce((s, f) => s + Number(f.amount ?? 0), 0) : 0
  const det = (j.transaction_details ?? {}) as { net_received_amount?: number }
  const coletor = (j.collector_id ?? (j.collector as { id?: unknown } | undefined)?.id) as unknown
  return {
    id: String(j.id), status: String(j.status ?? ''), statusDetail: (j.status_detail as string) ?? null,
    externalReference: (j.external_reference as string) ?? null, valor: Number(j.transaction_amount ?? 0), moeda: String(j.currency_id ?? ''),
    coletorId: coletor == null ? null : String(coletor), taxa: Math.round(taxas * 100) / 100,
    liquido: det.net_received_amount == null ? null : Number(det.net_received_amount), aprovadoEm: (j.date_approved as string) ?? null,
    metodo: (j.payment_method_id as string) ?? null,
  }
}

async function chamar(caminho: string, opcoes: { metodo?: string; token?: string; corpo?: unknown; idempotencia?: string; form?: boolean } = {}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opcoes.token) headers.Authorization = `Bearer ${opcoes.token}`
  if (opcoes.idempotencia) headers['X-Idempotency-Key'] = opcoes.idempotencia
  if (opcoes.corpo !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(`${MP_API}${caminho}`, { method: opcoes.metodo ?? 'GET', headers, body: opcoes.corpo === undefined ? undefined : JSON.stringify(opcoes.corpo), signal: AbortSignal.timeout(20_000) })
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
  // Mensagem curta, sem eco do corpo (pode conter dado do cliente): nunca token.
  if (!r.ok) throw new ErroMp(r.status, `MP ${r.status}: ${String(j.message ?? j.error ?? 'erro').slice(0, 140)}`)
  return j
}

const provedorReal: ProvedorMp = {
  async trocarCodigo({ codigo, verificador, redirectUri }) {
    return lerTokens(await chamar('/oauth/token', { metodo: 'POST', corpo: {
      client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, grant_type: 'authorization_code',
      code: codigo, redirect_uri: redirectUri, code_verifier: verificador,
    } }))
  },
  async renovar(refreshToken) {
    return lerTokens(await chamar('/oauth/token', { metodo: 'POST', corpo: {
      client_id: process.env.MP_CLIENT_ID, client_secret: process.env.MP_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: refreshToken,
    } }))
  },
  async conta(token) {
    const j = await chamar('/users/me', { token })
    return { id: String(j.id), apelido: (j.nickname as string) ?? null, email: (j.email as string) ?? null }
  },
  async criarPix(token, p) {
    const j = await chamar('/v1/payments', { metodo: 'POST', token, idempotencia: p.idempotencia, corpo: {
      transaction_amount: p.valor, description: p.descricao, payment_method_id: 'pix', external_reference: p.referencia,
      date_of_expiration: p.expiraEm, payer: { email: p.email }, ...(p.notificacaoUrl ? { notification_url: p.notificacaoUrl } : {}),
    } })
    const td = ((j.point_of_interaction as { transaction_data?: Record<string, unknown> } | undefined)?.transaction_data ?? {}) as Record<string, unknown>
    return { id: String(j.id), status: String(j.status), qrCode: String(td.qr_code ?? ''), qrCodeBase64: String(td.qr_code_base64 ?? ''), ticketUrl: (td.ticket_url as string) ?? null, expiraEm: String(j.date_of_expiration ?? p.expiraEm) }
  },
  async consultar(token, id) { return lerPagamento(await chamar(`/v1/payments/${encodeURIComponent(id)}`, { token })) },
  async cancelar(token, id) { await chamar(`/v1/payments/${encodeURIComponent(id)}`, { metodo: 'PUT', token, corpo: { status: 'cancelled' } }) },
  async reembolsar(token, id, idem) {
    const j = await chamar(`/v1/payments/${encodeURIComponent(id)}/refunds`, { metodo: 'POST', token, idempotencia: idem, corpo: {} })
    return { id: String(j.id), status: String(j.status ?? 'approved'), valor: Number(j.amount ?? 0) }
  },
}

// ── Simulado (arquivo) ───────────────────────────────────────────────────────────────────────
interface EstadoSim {
  contas: Record<string, { userId: string; refresh: string; expiraEm: string; apelido: string }> // por access token
  codigos: Record<string, { userId: string; desafio?: string }>
  pagamentos: Record<string, { id: string; token: string; userId: string; status: string; valor: number; referencia: string; expiraEm: string; idem: string; taxa: number; reembolsos: string[] }>
  falhas?: { renovar?: boolean; consultar?: boolean }
}
const arquivoSim = () => process.env.MP_SIMULADO_ARQUIVO || ''
export function lerSim(): EstadoSim {
  const a = arquivoSim()
  if (!a || !existsSync(a)) return { contas: {}, codigos: {}, pagamentos: {} }
  try { return JSON.parse(readFileSync(a, 'utf8')) as EstadoSim } catch { return { contas: {}, codigos: {}, pagamentos: {} } }
}
export function gravarSim(e: EstadoSim) { const a = arquivoSim(); if (a) writeFileSync(a, JSON.stringify(e, null, 1)) }
function contaSim(token: string) {
  const c = lerSim().contas[token]
  if (!c) throw new ErroMp(401, 'MP 401: invalid access token (simulado)')
  if (new Date(c.expiraEm).getTime() < Date.now()) throw new ErroMp(401, 'MP 401: expired access token (simulado)')
  return c
}
function novosTokensSim(userId: string, validadeSeg = 15552000): TokensMp {
  const e = lerSim()
  const accessToken = `SIM-ACCESS-${randomUUID()}`, refreshToken = `SIM-REFRESH-${randomUUID()}`
  const expiraEm = new Date(Date.now() + validadeSeg * 1000).toISOString()
  e.contas[accessToken] = { userId, refresh: refreshToken, expiraEm, apelido: `LOJA${userId}` }
  gravarSim(e)
  return { accessToken, refreshToken, userId, expiraEm, publicKey: 'SIM-PUBLIC', liveMode: false }
}

const provedorSimulado: ProvedorMp = {
  async trocarCodigo({ codigo }) {
    const e = lerSim(); const c = e.codigos[codigo]
    if (!c) throw new ErroMp(400, 'MP 400: invalid_grant (simulado)')
    delete e.codigos[codigo]; gravarSim(e)
    return novosTokensSim(c.userId)
  },
  async renovar(refresh) {
    const e = lerSim()
    if (e.falhas?.renovar) throw new ErroMp(400, 'MP 400: invalid_grant (simulado)')
    const antigo = Object.entries(e.contas).find(([, c]) => c.refresh === refresh)
    if (!antigo) throw new ErroMp(400, 'MP 400: invalid_grant (simulado)')
    delete e.contas[antigo[0]]; gravarSim(e)
    return novosTokensSim(antigo[1].userId)
  },
  async conta(token) { const c = contaSim(token); return { id: c.userId, apelido: c.apelido, email: `vendedor${c.userId}@teste.local` } },
  async criarPix(token, p) {
    const c = contaSim(token); const e = lerSim()
    const igual = Object.values(e.pagamentos).find((x) => x.idem === p.idempotencia && x.token === token)
    const pg = igual ?? { id: String(1_000_000_000 + Math.floor(Math.random() * 1e9)), token, userId: c.userId, status: 'pending', valor: p.valor, referencia: p.referencia, expiraEm: p.expiraEm, idem: p.idempotencia, taxa: Math.round(p.valor * 0.99) / 100, reembolsos: [] }
    e.pagamentos[pg.id] = pg; gravarSim(e)
    const qr = `00020126SIMULADO${pg.id}5204000053039865406${p.valor.toFixed(2)}6304ABCD`
    // QR de verdade (PNG) do código simulado — a tela mostra igual ao do MP.
    const png = await QRCode.toDataURL(qr, { margin: 1, width: 320 })
    return { id: pg.id, status: pg.status, qrCode: qr, qrCodeBase64: png.slice(png.indexOf(',') + 1), ticketUrl: null, expiraEm: pg.expiraEm }
  },
  async consultar(token, id) {
    contaSim(token); const e = lerSim()
    if (e.falhas?.consultar) throw new ErroMp(503, 'MP 503 (simulado)')
    const pg = e.pagamentos[id]
    if (!pg) throw new ErroMp(404, 'MP 404: payment not found (simulado)')
    const aprovado = pg.status === 'approved' || pg.status === 'refunded'
    return { id: pg.id, status: pg.status, statusDetail: null, externalReference: pg.referencia, valor: pg.valor, moeda: 'BRL', coletorId: pg.userId, taxa: aprovado ? pg.taxa : 0, liquido: aprovado ? Math.round((pg.valor - pg.taxa) * 100) / 100 : null, aprovadoEm: aprovado ? new Date().toISOString() : null, metodo: 'pix' }
  },
  async cancelar(token, id) {
    contaSim(token); const e = lerSim(); const pg = e.pagamentos[id]
    if (pg && pg.status === 'pending') { pg.status = 'cancelled'; gravarSim(e) }
  },
  async reembolsar(token, id, idem) {
    contaSim(token); const e = lerSim(); const pg = e.pagamentos[id]
    if (!pg || pg.status !== 'approved') throw new ErroMp(400, 'MP 400: payment not refundable (simulado)')
    const rid = `R${pg.id}-${createHash('sha1').update(idem).digest('hex').slice(0, 6)}`
    if (!pg.reembolsos.includes(rid)) pg.reembolsos.push(rid)
    pg.status = 'refunded'; gravarSim(e)
    return { id: rid, status: 'approved', valor: pg.valor }
  },
}

export function provedorMp(): ProvedorMp {
  return process.env.MP_PROVEDOR === 'simulado' ? provedorSimulado : provedorReal
}

/** O servidor tem o que precisa para o Pix online (aplicação do MP + chave dos tokens)? */
export function mpConfigurado(): boolean {
  if (process.env.MP_PROVEDOR === 'simulado') return Boolean(process.env.PAGAMENTOS_CHAVE)
  return Boolean(process.env.MP_CLIENT_ID && process.env.MP_CLIENT_SECRET && process.env.MP_WEBHOOK_SECRET && process.env.PAGAMENTOS_CHAVE)
}
