import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

/**
 * Visão geral das campanhas (0129). Roda com a sessão do usuário: a função do banco só
 * responde a dono/gerente e só com a loja dele. Atribuição: pedido do mesmo telefone até
 * 72 h depois do envio.
 *
 *   GET ?de=<iso>&ate=<iso>   → { janela_horas, totais, serie, envios }
 */
const DIA = 86_400_000

export async function GET(request: Request) {
  const supabase = await getServerSupabase()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const url = new URL(request.url)
  const ate = new Date(url.searchParams.get('ate') ?? Date.now())
  const de = new Date(url.searchParams.get('de') ?? ate.getTime() - 30 * DIA)
  if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate < de || ate.getTime() - de.getTime() > 400 * DIA) {
    return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
  }
  const { data, error } = await supabase.rpc('campanhas_visao_geral', { p_de: de.toISOString(), p_ate: ate.toISOString() })
  if (error) {
    if (error.code === '42501') return NextResponse.json({ error: 'Sem permissão para ver as campanhas.' }, { status: 403 })
    if (error.code === '22023') return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
    console.error('[campanhas/visao-geral]', error.message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
  return NextResponse.json({ de: de.toISOString(), ate: ate.toISOString(), ...(data as object) })
}
