import { NextResponse } from 'next/server'
import { contextoAtendimento, ehId, semCache } from '../contexto'

/**
 * Tags da loja (nome + cor) para marcar clientes na central.
 *   GET                       → lista
 *   POST { nome, cor }        → cria
 *   DELETE ?id=               → apaga (sai de todos os clientes)
 */
const COR = /^#[0-9A-Fa-f]{6}$/

export async function GET() {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const { data, error } = await ctx.admin.from('whatsapp_tags').select('id, nome, cor').eq('restaurante_id', ctx.loja).order('nome')
  if (error) return NextResponse.json({ error: 'Não foi possível carregar as tags.' }, { status: 500 })
  return NextResponse.json({ tags: data ?? [] }, { headers: semCache })
}

export async function POST(request: Request) {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { nome?: unknown; cor?: unknown } | null
  const nome = typeof corpo?.nome === 'string' ? corpo.nome.trim().replace(/\s+/g, ' ') : ''
  const cor = typeof corpo?.cor === 'string' && COR.test(corpo.cor) ? corpo.cor.toUpperCase() : '#0688D4'
  if (!nome || nome.length > 30) return NextResponse.json({ error: 'Dê um nome de até 30 letras.' }, { status: 400 })
  const { data, error } = await ctx.admin.from('whatsapp_tags').insert({ restaurante_id: ctx.loja, nome, cor }).select('id, nome, cor').single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'Já existe uma tag com esse nome.' }, { status: 409 })
    return NextResponse.json({ error: 'Não foi possível criar a tag.' }, { status: 500 })
  }
  return NextResponse.json({ tag: data }, { status: 201 })
}

export async function DELETE(request: Request) {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const id = new URL(request.url).searchParams.get('id')
  if (!ehId(id)) return NextResponse.json({ error: 'Tag inválida.' }, { status: 400 })
  const { error, count } = await ctx.admin.from('whatsapp_tags').delete({ count: 'exact' }).eq('restaurante_id', ctx.loja).eq('id', id)
  if (error) return NextResponse.json({ error: 'Não foi possível apagar a tag.' }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'Tag não encontrada.' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
