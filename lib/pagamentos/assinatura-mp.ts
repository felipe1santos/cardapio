import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Assinatura do webhook do Mercado Pago (cabeçalho `x-signature: ts=<ms>,v1=<hex>`).
 * Manifesto: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — HMAC-SHA256 com o segredo do
 * webhook da aplicação (`MP_WEBHOOK_SECRET`). Partes ausentes saem do manifesto (regra do MP).
 * Também recusa `ts` velho (padrão 10 min) para não aceitar reenvio de uma notificação antiga.
 *
 * Mesmo com a assinatura certa, o pagamento SEMPRE é conferido na API antes de valer.
 */
export function manifestoMp(p: { dataId?: string | null; requestId?: string | null; ts: string }): string {
  let m = ''
  if (p.dataId) m += `id:${p.dataId.toLowerCase()};`
  if (p.requestId) m += `request-id:${p.requestId};`
  m += `ts:${p.ts};`
  return m
}

export function lerXSignature(cabecalho: string | null): { ts: string; v1: string } | null {
  if (!cabecalho) return null
  const partes = Object.fromEntries(cabecalho.split(',').map((x) => x.trim().split('=').map((s) => s.trim())).filter((kv) => kv.length === 2))
  return partes.ts && partes.v1 ? { ts: partes.ts, v1: partes.v1 } : null
}

export function assinaturaMpValida(p: {
  xSignature: string | null; requestId: string | null; dataId: string | null; segredo: string | undefined; agoraMs?: number; janelaMs?: number
}): boolean {
  if (!p.segredo) return false
  const s = lerXSignature(p.xSignature)
  if (!s || !/^[0-9a-f]{64}$/i.test(s.v1)) return false
  const tsNum = Number(s.ts)
  if (!Number.isFinite(tsNum)) return false
  const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum // o MP manda em ms; aceita segundos também
  if (Math.abs((p.agoraMs ?? Date.now()) - tsMs) > (p.janelaMs ?? 10 * 60_000)) return false
  const esperado = createHmac('sha256', p.segredo).update(manifestoMp({ dataId: p.dataId, requestId: p.requestId, ts: s.ts })).digest()
  const recebido = Buffer.from(s.v1, 'hex')
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado)
}

/** Assina como o MP (só para o provedor simulado e os testes). */
export function assinarComoMp(p: { dataId: string; requestId: string; ts: string; segredo: string }): string {
  const v1 = createHmac('sha256', p.segredo).update(manifestoMp(p)).digest('hex')
  return `ts=${p.ts},v1=${v1}`
}
