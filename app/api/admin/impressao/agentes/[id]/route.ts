import { NextResponse } from 'next/server'
import { contextoImpressao } from '@/lib/impressao/contexto'
import { renomearAgente, revogarAgente } from '@/lib/impressao/servico'
import { ehUuid } from '@/lib/pdv-v2'
import { perguntaAoDesconectar } from '@/lib/impressao/protecao-computador'
import { registrarAuditoria } from '@/lib/auditoria'

/** Renomear (PATCH { nome }) ou revogar (POST { acao: "revogar" }) um computador. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Computador inválido' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await renomearAgente(ctx.admin, ctx.op, id, typeof corpo?.nome === 'string' ? corpo.nome : '')
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contextoImpressao()
  if ('erro' in ctx) return ctx.erro
  if (!ehUuid(id)) return NextResponse.json({ error: 'Computador inválido' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (corpo?.acao !== 'revogar') return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  // Único computador que imprime: só com confirmação explícita (09/10, Villa ficou sem impressão).
  const pergunta = await perguntaAoDesconectar(ctx.admin, ctx.op.restauranteId, id)
  if (pergunta && corpo?.confirmar !== true) return NextResponse.json({ error: pergunta, codigo: 'unico_computador' }, { status: 409 })
  const r = await revogarAgente(ctx.admin, ctx.op, id)
  if (r.ok && pergunta) {
    await registrarAuditoria(ctx.admin, { restauranteId: ctx.op.restauranteId, usuarioId: ctx.op.userId, usuarioNome: ctx.op.nome, acao: 'impressao.desconectou_unico', entidade: 'restaurante', entidadeId: ctx.op.restauranteId, dados: { agente: id, resumo: 'Desconectou o único computador que imprimia (confirmado)' } }).catch(() => {})
  }
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  // modoRecuou: o modo ligado perdeu a impressora de que precisava e voltou para a segurança.
  return NextResponse.json({ ok: true, modoRecuou: r.modoRecuou ?? null })
}
