import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { contextoAtendimento, ehId, semCache } from '../../../contexto'
import { listarMensagens } from '@/lib/mensageria/atendimento'
import { concluirSaida, registrarSaida } from '@/lib/mensageria/historico'
import { provedorAtual } from '@/lib/mensageria/provedor'
import { registrarAuditoria } from '@/lib/auditoria'
import { mensagemFalhaAtendente } from '@/lib/mensageria/atendente-envio'

/**
 * Mensagens de uma conversa da central.
 *   GET ?antes=<cursor>                 → página (40), da mais antiga para a mais nova
 *   POST { texto }                      → atendente responde (Enter no painel)
 *   POST multipart { imagem, legenda }  → atendente manda foto (JPG/PNG/WebP até 5 MB)
 * Responder assume a conversa: o robô para nela (whatsapp_registrar_saida).
 */
const TIPOS_IMAGEM: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
const IMAGEM_MAX = 5 * 1024 * 1024

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  if (!ehId(id)) return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })
  const { data: c } = await ctx.admin.from('whatsapp_conversas').select('id').eq('restaurante_id', ctx.loja).eq('id', id).maybeSingle()
  if (!c) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
  try {
    return NextResponse.json(await listarMensagens(ctx.admin, ctx.loja, id, new URL(request.url).searchParams.get('antes')), { headers: semCache })
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar as mensagens.' }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  if (!ehId(id)) return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })

  const [{ data: conversa }, { data: loja }] = await Promise.all([
    ctx.admin.from('whatsapp_conversas').select('id, telefone').eq('restaurante_id', ctx.loja).eq('id', id).maybeSingle(),
    ctx.admin.from('restaurantes').select('evolution_instance').eq('id', ctx.loja).maybeSingle(),
  ])
  if (!conversa) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
  const instancia = (loja?.evolution_instance as string | null) ?? null
  if (!instancia) return NextResponse.json({ error: 'O WhatsApp da loja não está conectado.', codigo: 'sem_whatsapp' }, { status: 409 })

  let texto = ''
  let imagem: File | null = null
  if ((request.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
    const form = await request.formData().catch(() => null)
    const arq = form?.get('imagem')
    if (!(arq instanceof File)) return NextResponse.json({ error: 'Envie a imagem.' }, { status: 400 })
    if (!TIPOS_IMAGEM[arq.type]) return NextResponse.json({ error: 'Use JPG, PNG ou WebP.' }, { status: 400 })
    if (arq.size > IMAGEM_MAX) return NextResponse.json({ error: 'A imagem pode ter até 5 MB.' }, { status: 400 })
    imagem = arq
    texto = String(form?.get('legenda') ?? '').trim()
  } else {
    const corpo = (await request.json().catch(() => null)) as { texto?: unknown } | null
    texto = typeof corpo?.texto === 'string' ? corpo.texto.trim() : ''
    if (!texto) return NextResponse.json({ error: 'Escreva a mensagem.' }, { status: 400 })
  }
  if (texto.length > 4000) return NextResponse.json({ error: 'A mensagem pode ter até 4000 caracteres.' }, { status: 400 })

  let midiaUrl: string | null = null
  if (imagem) {
    // Foto do atendente: Storage da loja (caminho gerado aqui; nome imprevisível).
    const caminho = `${ctx.loja}/whatsapp/${randomUUID()}.${TIPOS_IMAGEM[imagem.type]}`
    const { error: up } = await ctx.admin.storage.from('cardapio').upload(caminho, Buffer.from(await imagem.arrayBuffer()), { contentType: imagem.type, upsert: false })
    if (up) return NextResponse.json({ error: 'Não foi possível enviar a imagem.' }, { status: 500 })
    midiaUrl = ctx.admin.storage.from('cardapio').getPublicUrl(caminho).data.publicUrl
  }

  const saida = await registrarSaida(ctx.admin, {
    restauranteId: ctx.loja, telefone: conversa.telefone as string, texto: texto || (imagem ? '📷 Foto' : ''), origem: 'atendente',
    tipo: imagem ? 'imagem' : 'texto', midiaUrl, autorId: ctx.sessao.userId, autorNome: ctx.sessao.nome,
  })
  if (!saida) return NextResponse.json({ error: 'Não foi possível registrar a mensagem.' }, { status: 500 })
  const provedor = provedorAtual()
  const r = imagem && midiaUrl
    ? await provedor.enviarImagem(instancia, conversa.telefone as string, midiaUrl, texto)
    : await provedor.enviarTexto(instancia, conversa.telefone as string, texto)
  await concluirSaida(ctx.admin, saida.mensagemId, r.ok, r.ok ? r.idExterno : null, r.ok ? null : r.erro)
  await registrarAuditoria(ctx.admin, {
    restauranteId: ctx.loja, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome,
    acao: 'whatsapp.atendente_respondeu', entidade: 'whatsapp_conversa', entidadeId: id, dados: { tipo: imagem ? 'imagem' : 'texto', ok: r.ok },
  }).catch(() => {})
  if (!r.ok) return NextResponse.json({ error: mensagemFalhaAtendente(r.tipo), codigo: r.tipo, mensagemId: saida.mensagemId }, { status: 502 })
  return NextResponse.json({ ok: true, mensagemId: saida.mensagemId }, { headers: semCache })
}
