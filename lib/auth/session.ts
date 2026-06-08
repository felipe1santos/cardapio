import type { SupabaseClient } from '@supabase/supabase-js'

export interface AppSession {
  userId: string
  restauranteId: string
  papel: string
  nome: string
}

export async function getCurrentSession(
  supabase: SupabaseClient
): Promise<AppSession | null> {
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
  }
}
