import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { carregarLoja, type LojaPush } from './motor'

/**
 * Painel das notificações push (Campanhas › Notificações do app). A área "Campanhas" e a ação
 * sensível "disparar campanhas" são conferidas no middleware (lib/acessos.ts); aqui só se descobre
 * a loja do usuário logado. As tabelas do push são só do servidor (0127): leitura/escrita pelo
 * cliente service role, SEMPRE filtrando a loja do usuário.
 */
export async function lojaDoPainel(): Promise<{ admin: SupabaseClient; loja: LojaPush; usuario: { id: string; nome: string | null } } | { erro: NextResponse }> {
  const cookieStore = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  })
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return { erro: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) }
  const { data: u } = await supabase.auth.getUser()
  const admin = getAdminSupabase()
  const loja = await carregarLoja(admin, restauranteId)
  if (!loja) return { erro: NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 }) }
  const nome = (u.user?.user_metadata?.nome as string | undefined) ?? u.user?.email ?? null
  return { admin, loja, usuario: { id: u.user?.id ?? '', nome } }
}

export function exigirPushLiberado(loja: LojaPush): NextResponse | null {
  return loja.pushLiberado ? null : NextResponse.json({ error: 'As notificações do app ainda não estão liberadas para esta loja.' }, { status: 403 })
}
