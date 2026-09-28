import { NextResponse } from 'next/server'
import { contextoAtendimento, ehId } from '../../../contexto'

/** POST { tagId, aplicar: boolean } — coloca ou tira uma tag da loja num cliente da loja. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { tagId?: unknown; aplicar?: unknown } | null
  if (!ehId(id) || !ehId(corpo?.tagId) || typeof corpo?.aplicar !== 'boolean') return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  // Conversa e tag precisam ser DESTA loja (a sessão manda).
  const [{ data: c }, { data: t }] = await Promise.all([
    ctx.admin.from('whatsapp_conversas').select('id').eq('restaurante_id', ctx.loja).eq('id', id).maybeSingle(),
    ctx.admin.from('whatsapp_tags').select('id').eq('restaurante_id', ctx.loja).eq('id', corpo.tagId).maybeSingle(),
  ])
  if (!c || !t) return NextResponse.json({ error: 'Não encontrado.' }, { status: 404 })
  const r = corpo.aplicar
    ? await ctx.admin.from('whatsapp_conversa_tags').upsert({ restaurante_id: ctx.loja, conversa_id: id, tag_id: corpo.tagId }, { onConflict: 'conversa_id,tag_id', ignoreDuplicates: true })
    : await ctx.admin.from('whatsapp_conversa_tags').delete().eq('restaurante_id', ctx.loja).eq('conversa_id', id).eq('tag_id', corpo.tagId)
  if (r.error) return NextResponse.json({ error: 'Não foi possível salvar a tag.' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
