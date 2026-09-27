import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Métricas das campanhas (0104). Tudo roda com a sessão do usuário: a função do banco
 * só responde a dono/gerente e só com a loja dele.
 *
 *   GET ?de=<iso>&ate=<iso>[&campanha=<uuid>]   → { campanhas, totais }
 *   GET ?detalhe=<uuid>                         → destinatários da campanha
 */
async function getAuthSupabase() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } },
  )
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DIA = 86_400_000

export async function GET(request: Request) {
  try {
    const supabase = await getAuthSupabase()
    const { data: sessao } = await supabase.auth.getUser()
    if (!sessao.user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const url = new URL(request.url)

    const detalhe = url.searchParams.get('detalhe')
    if (detalhe !== null) {
      if (!UUID.test(detalhe)) return NextResponse.json({ error: 'Campanha inválida.' }, { status: 400 })
      const { data, error } = await supabase.rpc('campanha_destinatarios', { p_campanha: detalhe })
      if (error) return erroBanco(error)
      if (data === null) return NextResponse.json({ error: 'Campanha não encontrada.' }, { status: 404 })
      return NextResponse.json({ destinatarios: data })
    }

    const ate = new Date(url.searchParams.get('ate') ?? Date.now())
    const de = new Date(url.searchParams.get('de') ?? ate.getTime() - 30 * DIA)
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate < de || ate.getTime() - de.getTime() > 400 * DIA) {
      return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
    }
    const campanha = url.searchParams.get('campanha')
    if (campanha && !UUID.test(campanha)) return NextResponse.json({ error: 'Campanha inválida.' }, { status: 400 })

    const { data, error } = await supabase.rpc('campanhas_metricas', { p_de: de.toISOString(), p_ate: ate.toISOString(), p_campanha: campanha || null })
    if (error) return erroBanco(error)
    return NextResponse.json({ de: de.toISOString(), ate: ate.toISOString(), ...(data as object) })
  } catch (err) {
    console.error('[campanhas/metricas] erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}

function erroBanco(error: { code?: string; message?: string }) {
  if (error.code === '42501') return NextResponse.json({ error: 'Sem permissão para ver as métricas.' }, { status: 403 })
  if (error.code === '22023') return NextResponse.json({ error: 'Período inválido.' }, { status: 400 })
  console.error('[campanhas/metricas] banco:', error.message?.slice(0, 200))
  return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
}
