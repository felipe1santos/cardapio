import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverFrete, type EnderecoFrete, type FreteDecisao } from '@/lib/frete'

export type FreteResposta = FreteDecisao

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/**
 * Calcula o frete para um endereço de cliente. Regra em lib/frete.ts (decidirFrete):
 * bairro cadastrado → faixa de raio → taxa padrão (esta só quando a loja não
 * restringiu área). Bairro fora da lista fechada ou endereço fora do raio
 * retornam entregavel: false.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let body: EnderecoFrete
  try {
    body = (await request.json()) as EnderecoFrete
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()
  const { data: loja, error: lojaErr } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (lojaErr) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  const resultado = await resolverFrete(admin, loja.id, body, MAPS_KEY)
  return NextResponse.json<FreteResposta>(resultado)
}
