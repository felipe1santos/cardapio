import { NextResponse } from 'next/server'
import { contextoImpressao, semCache } from '@/lib/impressao/contexto'
import {
  BUCKET, LOGO_IMPRESSAO_MAX_BYTES, LOGO_IMPRESSAO_MAX_LADO, caminhoLogoDaLoja, caminhoLogoImpressao, chaveLogo, dimensoesPng,
} from '@/lib/impressao/logo-loja'

/**
 * Logo de impressão da loja (Recibo/Extrato do Assistente Beta).
 * GET: a loja tem logo? a versão de impressão da logo ATUAL já existe?
 * POST (image/png): o navegador do dono/gerente manda a logo atual achatada sobre fundo
 * branco. O servidor confere que é PNG, tamanho e dimensões, e grava num caminho FIXO da
 * própria loja derivado da logo atual — o navegador não escolhe onde grava.
 */
type Contexto = Exclude<Awaited<ReturnType<typeof contextoImpressao>>, { erro: NextResponse }>

async function situacao(ctx: Contexto) {
  const { data: loja } = await ctx.admin.from('restaurantes').select('logo_url').eq('id', ctx.op.restauranteId).maybeSingle()
  const logoUrl = (loja?.logo_url as string | null) ?? null
  const valida = !!caminhoLogoDaLoja(logoUrl, process.env.NEXT_PUBLIC_SUPABASE_URL, ctx.op.restauranteId)
  if (!logoUrl || !valida) return { temLogo: !!logoUrl, pronta: false, caminho: null as string | null }
  const caminho = caminhoLogoImpressao(ctx.op.restauranteId, chaveLogo(logoUrl))
  const pasta = caminho.slice(0, caminho.lastIndexOf('/'))
  const { data } = await ctx.admin.storage.from(BUCKET).list(pasta, { limit: 20 })
  return { temLogo: true, pronta: (data ?? []).some((f) => `${pasta}/${f.name}` === caminho), caminho }
}

export async function GET() {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const s = await situacao(ctx)
  return NextResponse.json({ temLogo: s.temLogo, pronta: s.pronta }, { headers: semCache })
}

export async function POST(request: Request) {
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  const s = await situacao(ctx)
  if (!s.caminho) return NextResponse.json({ error: 'A loja não tem logo no Menuzia.', codigo: 'sem_logo' }, { status: 409, headers: semCache })
  const bytes = new Uint8Array(await request.arrayBuffer())
  const dim = dimensoesPng(bytes)
  if (!dim || bytes.length > LOGO_IMPRESSAO_MAX_BYTES || dim.largura < 8 || dim.altura < 8 || dim.largura > LOGO_IMPRESSAO_MAX_LADO || dim.altura > LOGO_IMPRESSAO_MAX_LADO) {
    return NextResponse.json({ error: 'Imagem inválida para impressão.', codigo: 'imagem_invalida' }, { status: 400, headers: semCache })
  }
  const { error } = await ctx.admin.storage.from(BUCKET).upload(s.caminho, bytes, { contentType: 'image/png', upsert: true, cacheControl: '3600' })
  if (error) return NextResponse.json({ error: 'Não foi possível guardar a logo de impressão.', codigo: 'erro' }, { status: 500, headers: semCache })
  // Só a versão da logo atual fica.
  const pasta = s.caminho.slice(0, s.caminho.lastIndexOf('/'))
  const { data } = await ctx.admin.storage.from(BUCKET).list(pasta, { limit: 50 })
  const velhas = (data ?? []).map((f) => `${pasta}/${f.name}`).filter((c) => c !== s.caminho && /\/logo-[0-9a-f]{16}\.png$/.test(c))
  if (velhas.length) await ctx.admin.storage.from(BUCKET).remove(velhas)
  return NextResponse.json({ ok: true }, { status: 201, headers: semCache })
}
