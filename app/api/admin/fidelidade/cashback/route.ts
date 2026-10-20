import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { excluirRegraCashback, listarRegrasCashback, salvarRegraCashback, type RegraCashbackInput } from '@/lib/queries/cashback'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Cashback por item (Etapa 7, 20/10/2026, 0211). Mesmo padrão de /api/admin/fidelidade/campanhas: sessão do painel
 * identifica a loja; as tabelas são só de servidor (service_role). Uma regra por item: PUT cria ou atualiza.
 */
async function lojaDaSessao(): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} },
  })
  return buscarRestauranteIdDoUsuario(supabase)
}

function erro(prefixo: string, err: unknown) {
  console.error(`[fidelidade/cashback] ${prefixo}:`, err)
  if (err instanceof Error) return NextResponse.json({ error: err.message }, { status: 400 })
  return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
}

export async function GET() {
  try {
    const restauranteId = await lojaDaSessao()
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    return NextResponse.json(await listarRegrasCashback(getAdminSupabase(), restauranteId))
  } catch (err) {
    return erro('GET', err)
  }
}

export async function PUT(request: Request) {
  try {
    const restauranteId = await lojaDaSessao()
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const corpo = (await request.json()) as Partial<RegraCashbackInput>
    const regra = await salvarRegraCashback(getAdminSupabase(), restauranteId, {
      itemId: String(corpo.itemId ?? ''),
      tipo: corpo.tipo === 'percentual' ? 'percentual' : 'valor',
      valor: Number(corpo.valor),
      validadeDias: Number(corpo.validadeDias),
      ativo: corpo.ativo !== false,
    })
    return NextResponse.json(regra)
  } catch (err) {
    return erro('PUT', err)
  }
}

export async function DELETE(request: Request) {
  try {
    const restauranteId = await lojaDaSessao()
    if (!restauranteId) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    const id = new URL(request.url).searchParams.get('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Regra inválida' }, { status: 400 })
    await excluirRegraCashback(getAdminSupabase(), restauranteId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return erro('DELETE', err)
  }
}
