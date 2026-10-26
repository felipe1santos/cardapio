/**
 * Sessão conferida pelo middleware, repassada à rota num cabeçalho interno assinado (egress, 26/10).
 *
 * Antes, cada chamada a /api/admin/* conferia o login duas vezes: no middleware e de novo em getCurrentSession
 * (getUser no Auth + leitura de `usuarios`). O middleware já fez as duas coisas na MESMA requisição; aqui ele assina
 * o resultado (HMAC-SHA256, 60 s) e a rota aceita sem repetir. Sem assinatura válida, a rota confere como sempre.
 *
 * Web Crypto puro: roda no middleware (Edge) e nas rotas (Node).
 */
export interface SessaoAssinada {
  userId: string
  restauranteId: string
  papel: string
  nome: string
  email: string | null
}

export const CABECALHO_SESSAO = 'x-menuzia-sessao'
const VALIDADE_MS = 60_000
const ROTULO = 'menuzia-sessao-v1'

const enc = new TextEncoder()

function paraBase64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deBase64Url(texto: string): Uint8Array<ArrayBuffer> {
  const b64 = texto.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((texto.length + 3) % 4)
  const s = atob(b64)
  const bytes = new Uint8Array(new ArrayBuffer(s.length))
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i)
  return bytes
}

/** Chave própria, derivada do segredo do servidor com um rótulo (não reaproveita o segredo cru). */
async function chave(segredo: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const derivada = await crypto.subtle.sign('HMAC', base, enc.encode(ROTULO))
  return crypto.subtle.importKey('raw', derivada, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function assinarSessao(s: SessaoAssinada, segredo: string, agora: number = Date.now()): Promise<string> {
  const corpo = paraBase64Url(enc.encode(JSON.stringify({ ...s, exp: agora + VALIDADE_MS })))
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', await chave(segredo), enc.encode(corpo)))
  return `${corpo}.${paraBase64Url(assinatura)}`
}

export async function lerSessaoAssinada(valor: string | null | undefined, segredo: string, agora: number = Date.now()): Promise<SessaoAssinada | null> {
  if (!valor || !segredo) return null
  const [corpo, assinatura, sobra] = valor.split('.')
  if (!corpo || !assinatura || sobra !== undefined) return null
  try {
    const ok = await crypto.subtle.verify('HMAC', await chave(segredo), deBase64Url(assinatura), enc.encode(corpo))
    if (!ok) return null
    const d = JSON.parse(new TextDecoder().decode(deBase64Url(corpo))) as SessaoAssinada & { exp?: number }
    if (typeof d.exp !== 'number' || d.exp < agora) return null
    if (typeof d.userId !== 'string' || typeof d.restauranteId !== 'string' || typeof d.papel !== 'string') return null
    return { userId: d.userId, restauranteId: d.restauranteId, papel: d.papel, nome: d.nome ?? '', email: d.email ?? null }
  } catch {
    return null
  }
}

/** Segredo do servidor usado para derivar a chave (nunca vai ao navegador). */
export function segredoDaSessao(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
}
