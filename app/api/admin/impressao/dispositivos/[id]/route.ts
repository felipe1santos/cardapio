import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { ajustarDispositivo, criarTeste } from '@/lib/impressao/servico'
import { ehUuid } from '@/lib/pdv-v2'

/**
 * Apelido/largura/fonte e perfil de calibração (PATCH — larguraPontos/deslocamentoPontos,
 * só desta impressora) e impressão de teste ou calibração (POST { acao: "teste" | "calibracao", chave }).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Impressora inválida' }, { status: 400 })
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const r = await ajustarDispositivo(ctx.admin, ctx.op, id, {
    apelido: corpo.apelido, larguraMm: corpo.larguraMm, tamanhoFonte: corpo.tamanhoFonte,
    larguraPontos: corpo.larguraPontos, deslocamentoPontos: corpo.deslocamentoPontos,
  })
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Impressora inválida' }, { status: 400 })
  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (corpo.acao !== 'teste' && corpo.acao !== 'calibracao') return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  if (!ehUuid(corpo.chave)) return NextResponse.json({ error: 'Chave ausente.' }, { status: 400 })
  const r = await criarTeste(ctx.admin, ctx.op, id, corpo.chave, corpo.acao === 'calibracao')
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, ...r.valor }, { status: r.valor.idempotente ? 200 : 201 })
}
