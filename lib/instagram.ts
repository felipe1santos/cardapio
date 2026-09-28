/**
 * Instagram da loja (0106) — o link que vira o QR no fim da comanda da cozinha do Beta.
 *
 * O dono digita do jeito que sabe: `@villalanches`, `villalanches`, `instagram.com/x`,
 * `https://www.instagram.com/x/?igsh=...`. Tudo vira UMA forma só,
 * `https://instagram.com/<usuario>`, que é o que o banco aceita (CHECK da 0106).
 *
 * Usuário do Instagram: letras, números, ponto e sublinhado, até 30. Link de post, reel
 * ou story (`/p/...`, `/reel/...`) não é perfil: recusa, em vez de imprimir um QR que
 * abre outra coisa.
 */

const USUARIO = /^[A-Za-z0-9._]{1,30}$/
const RESERVADOS = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv', 'direct'])

export type ResultadoInstagram = { ok: true; url: string | null } | { ok: false; erro: string }

export function normalizarInstagram(bruto: string | null | undefined): ResultadoInstagram {
  const t = (bruto ?? '').trim()
  if (!t) return { ok: true, url: null }

  let usuario: string | null = null
  if (t.startsWith('@')) {
    usuario = t.slice(1)
  } else if (/instagram\.com/i.test(t) || /^https?:\/\//i.test(t)) {
    let u: URL
    try {
      u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`)
    } catch {
      return { ok: false, erro: 'Link inválido. Use o formato https://instagram.com/sualoja ou @sualoja.' }
    }
    const host = u.hostname.toLowerCase()
    if (host !== 'instagram.com' && host !== 'www.instagram.com') {
      return { ok: false, erro: 'O link precisa ser do instagram.com.' }
    }
    const partes = u.pathname.split('/').filter(Boolean)
    if (partes.length !== 1) return { ok: false, erro: 'Use o link do perfil da loja (instagram.com/sualoja), não de uma publicação.' }
    usuario = partes[0]!
  } else {
    usuario = t
  }

  if (!usuario || !USUARIO.test(usuario)) {
    return { ok: false, erro: 'Usuário do Instagram inválido: só letras, números, ponto e sublinhado (até 30).' }
  }
  if (RESERVADOS.has(usuario.toLowerCase())) {
    return { ok: false, erro: 'Use o link do perfil da loja (instagram.com/sualoja), não de uma publicação.' }
  }
  return { ok: true, url: `https://instagram.com/${usuario}` }
}

/** "@usuario" para mostrar ao lado do QR / na tela. */
export function arrobaDoInstagram(url: string | null | undefined): string | null {
  const m = /^https:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{1,30})\/?$/.exec(url ?? '')
  return m ? `@${m[1]}` : null
}
