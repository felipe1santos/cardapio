import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Criptografia dos tokens de pagamento (Pix online, 2026-10-04): AES-256-GCM com a chave
 * `PAGAMENTOS_CHAVE` (32 bytes em base64, só no ambiente do servidor — nunca no repositório).
 * Formato guardado: `v1.<iv base64url>.<tag base64url>.<cifra base64url>`.
 * Trocar a chave invalida todas as conexões (as lojas teriam de conectar de novo): não trocar.
 */
function chave(): Buffer {
  const b64 = process.env.PAGAMENTOS_CHAVE?.trim()
  if (!b64) throw new Error('PAGAMENTOS_CHAVE ausente')
  const k = Buffer.from(b64, 'base64')
  if (k.length !== 32) throw new Error('PAGAMENTOS_CHAVE deve ter 32 bytes (openssl rand -base64 32)')
  return k
}

export function criptografiaPronta(): boolean {
  try { chave(); return true } catch { return false }
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', chave(), iv)
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), dados.toString('base64url')].join('.')
}

export function decifrar(guardado: string): string {
  const [v, iv, tag, dados] = guardado.split('.')
  if (v !== 'v1' || !iv || !tag || !dados) throw new Error('formato de segredo desconhecido')
  const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(dados, 'base64url')), d.final()]).toString('utf8')
}
