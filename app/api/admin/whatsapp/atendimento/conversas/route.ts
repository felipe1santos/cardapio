import { NextResponse } from 'next/server'
import { contextoAtendimento, semCache } from '../contexto'
import { listarConversas, type FiltroConversas } from '@/lib/mensageria/atendimento'

/** GET ?filtro=aguardando|humano|todas&tag=&q=&cursor= → uma página de conversas. */
export async function GET(request: Request) {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const u = new URL(request.url).searchParams
  const f = u.get('filtro')
  const filtro: FiltroConversas = f === 'aguardando' || f === 'humano' ? f : 'todas'
  try {
    return NextResponse.json(await listarConversas(ctx.admin, ctx.loja, { filtro, tagId: u.get('tag'), busca: u.get('q'), cursor: u.get('cursor') }), { headers: semCache })
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar as conversas.' }, { status: 500, headers: semCache })
  }
}
