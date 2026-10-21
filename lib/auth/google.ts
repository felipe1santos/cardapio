import type { User } from '@supabase/supabase-js'

/**
 * Login com o Google (20/10/2026). O botão só aparece com o provedor ligado no Supabase (Authentication › Providers ›
 * Google): lê o /auth/v1/settings público do próprio Supabase (grátis, sem chave de servidor), guardado 5 min.
 */
export async function googleLigado(): Promise<boolean> {
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
      next: { revalidate: 300 },
    })
    if (!r.ok) return false
    const j = (await r.json()) as { external?: { google?: boolean } }
    return j.external?.google === true
  } catch {
    return false
  }
}

/**
 * Usuário que o Supabase acabou de criar só porque alguém entrou com um Google sem conta Menuzia: só a identidade
 * `google` e criado agora há pouco. Esse é apagado na volta (nada de loja/usuário nascendo sozinho). Conta antiga com
 * o Google vinculado tem a identidade `email` também, e nunca entra aqui.
 */
export function criadoAgoraSoPeloGoogle(user: Pick<User, 'identities' | 'created_at'>, agora = Date.now()): boolean {
  const ids = user.identities ?? []
  if (ids.length === 0 || ids.some((i) => i.provider !== 'google')) return false
  const criado = Date.parse(user.created_at)
  return Number.isFinite(criado) && agora - criado < 10 * 60_000
}
