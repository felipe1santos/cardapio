import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdPorSlug, enviarCodigoVerificacao } from '@/lib/queries/clientes'

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let body: { telefone?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (!body.telefone) return NextResponse.json({ error: 'Informe seu telefone.' }, { status: 400 })

  const admin = getAdminSupabase()
  const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
  if (!restauranteId) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  const result = await enviarCodigoVerificacao(admin, restauranteId, body.telefone)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
