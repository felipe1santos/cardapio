import type { SupabaseClient } from '@supabase/supabase-js'
import { CABECALHO_SESSAO, lerSessaoAssinada, segredoDaSessao } from './sessao-assinada'

export interface AppSession {
  userId: string
  restauranteId: string
  papel: string
  nome: string
  /** E-mail do login — usado para reconhecer o suporte da plataforma (SUPERADMIN_EMAILS). */
  email?: string | null
}

/**
 * Sessão já conferida pelo middleware nesta mesma requisição (egress, 26/10): cabeçalho interno assinado. Fora de
 * requisição (scripts, testes sem Next) ou sem assinatura válida, devolve null e quem chama confere como sempre.
 */
async function sessaoDoMiddleware(): Promise<AppSession | null> {
  try {
    const { headers } = await import('next/headers')
    return await lerSessaoAssinada((await headers()).get(CABECALHO_SESSAO), segredoDaSessao())
  } catch {
    return null
  }
}

export async function getCurrentSession(
  supabase: SupabaseClient
): Promise<AppSession | null> {
  const pronta = await sessaoDoMiddleware()
  if (pronta) return pronta

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('restaurante_id, papel, nome')
    .eq('id', user.id)
    .single()

  if (!usuario) return null

  return {
    userId: user.id,
    restauranteId: usuario.restaurante_id,
    papel: usuario.papel,
    nome: usuario.nome,
    email: user.email ?? null,
  }
}
