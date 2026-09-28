import { NextResponse } from 'next/server'
import { contextoAtendimento, ehId } from '../contexto'
import { evolutionConfigurado } from '@/lib/evolution'

/**
 * Foto que o CLIENTE mandou, sob demanda (só quando o balão aparece na tela).
 * GET ?mensagem=<id> → a imagem, pedida à Evolution (chat/getBase64FromMediaMessage).
 * Depende do provedor: sem a Evolution (ou versão sem esse endpoint) → 404 e o balão fica
 * só com o tipo ("📷 Foto").
 */
export async function GET(request: Request) {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const id = new URL(request.url).searchParams.get('mensagem')
  if (!ehId(id)) return NextResponse.json({ error: 'Mensagem inválida.' }, { status: 400 })
  const [{ data: m }, { data: loja }] = await Promise.all([
    ctx.admin.from('whatsapp_mensagens').select('wa_id, tipo, direcao, criado_em').eq('restaurante_id', ctx.loja).eq('id', id).maybeSingle(),
    ctx.admin.from('restaurantes').select('evolution_instance').eq('id', ctx.loja).maybeSingle(),
  ])
  if (!m || m.tipo !== 'imagem' || m.direcao !== 'entrada' || !loja?.evolution_instance || !evolutionConfigurado()) {
    return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 404 })
  }
  try {
    const base = process.env.EVOLUTION_API_URL!.replace(/\/$/, '')
    const res = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(loja.evolution_instance as string)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.EVOLUTION_API_KEY! },
      body: JSON.stringify({ message: { key: { id: m.wa_id } }, convertToMp4: false }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 404 })
    const j = (await res.json().catch(() => null)) as { base64?: string; mimetype?: string } | null
    const tipo = j?.mimetype && /^image\/(jpeg|png|webp|gif)$/.test(j.mimetype) ? j.mimetype : 'image/jpeg'
    if (!j?.base64) return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 404 })
    return new NextResponse(Buffer.from(j.base64, 'base64'), { headers: { 'Content-Type': tipo, 'Cache-Control': 'private, max-age=3600' } })
  } catch {
    return NextResponse.json({ error: 'Imagem indisponível.' }, { status: 404 })
  }
}
