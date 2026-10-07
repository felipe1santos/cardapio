import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { urlPublica } from '@/lib/url-publica'

/**
 * QR da ROTA (item 59): o link impresso na comanda de entrega — `/r/<código>`.
 *
 * O código carrega só o id do pedido (16 bytes) e uma assinatura HMAC-SHA256 truncada (10 bytes),
 * em base64url: 35 caracteres, sem nome, telefone ou endereço. Link adulterado (id trocado, letra
 * mudada) não confere a assinatura e é recusado. A chave é derivada do segredo do servidor
 * (QR_ROTA_CHAVE, ou a service role do Supabase): ninguém de fora consegue gerar um código válido.
 *
 * Quem lê o QR no app do motoboy pega a entrega (POST /api/motoboy/qr); qualquer outra câmera
 * cai no cardápio da loja (/r/<código> redireciona) — nunca vê dado do pedido.
 */

const BYTES_ASSINATURA = 10

function chave(): Buffer {
  const segredo = process.env.QR_ROTA_CHAVE ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  if (!segredo) throw new Error('sem segredo para assinar o QR da rota')
  return createHash('sha256').update(`menuzia:qr-rota:${segredo}`).digest()
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assinar(id: Buffer): Buffer {
  return createHmac('sha256', chave()).update(id).digest().subarray(0, BYTES_ASSINATURA)
}

export function codigoDaRota(pedidoId: string): string {
  if (!UUID.test(pedidoId)) throw new Error('pedido inválido')
  const id = Buffer.from(pedidoId.replace(/-/g, ''), 'hex')
  return Buffer.concat([id, assinar(id)]).toString('base64url')
}

/** Código → id do pedido, ou null se o código não é nosso (formato errado ou assinatura falsa). */
export function pedidoDoCodigo(codigo: unknown): string | null {
  if (typeof codigo !== 'string' || !/^[A-Za-z0-9_-]{30,40}$/.test(codigo)) return null
  let bruto: Buffer
  try { bruto = Buffer.from(codigo, 'base64url') } catch { return null }
  if (bruto.length !== 16 + BYTES_ASSINATURA) return null
  const id = bruto.subarray(0, 16)
  const veio = bruto.subarray(16)
  const certo = assinar(id)
  if (!timingSafeEqual(veio, certo)) return null
  const h = id.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function urlDaRota(pedidoId: string): string {
  return `${urlPublica()}/r/${codigoDaRota(pedidoId)}`
}

/**
 * O que o app leu: o link inteiro (https://…/r/<código>), só o código, ou o número do pedido
 * digitado. Devolve o tipo para a API decidir.
 */
export function lerEntradaDoQr(texto: unknown): { tipo: 'codigo'; pedidoId: string } | { tipo: 'numero'; numero: number } | null {
  if (typeof texto !== 'string') return null
  const t = texto.trim()
  const numero = t.replace(/^#/, '')
  if (/^\d{1,9}$/.test(numero)) return { tipo: 'numero', numero: Number(numero) }
  const m = /\/r\/([A-Za-z0-9_-]{30,40})(?:[/?#].*)?$/.exec(t)
  const pedidoId = pedidoDoCodigo(m ? m[1] : t)
  return pedidoId ? { tipo: 'codigo', pedidoId } : null
}
