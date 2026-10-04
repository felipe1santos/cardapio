import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { registrarAuditoria } from '@/lib/auditoria'
import { extratoDoTurnoFluxo } from '@/lib/financeiro/fluxo'

/**
 * Extrato de UM turno (Fluxo de Caixa). Turno de outra loja → 404 (nunca os dados).
 *   GET                              → { turno, lancamentos, reaberturas }
 *   POST { acao: 'reimprimir' }      → registra na auditoria e libera o relatório de fechamento para imprimir
 */
const UUID = /^[0-9a-f-]{36}$/i

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await contextoFinanceiro('financeiro')
  if ('erro' in c) return c.erro
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Turno não encontrado.' }, { status: 404 })
  const ex = await extratoDoTurnoFluxo(c, id)
  if (!ex) return NextResponse.json({ error: 'Turno não encontrado.' }, { status: 404 })
  return NextResponse.json(ex, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await contextoFinanceiro('financeiro')
  if ('erro' in c) return c.erro
  const { id } = await params
  const corpo = await request.json().catch(() => null)
  if (corpo?.acao !== 'reimprimir') return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  if (!UUID.test(id)) return NextResponse.json({ error: 'Turno não encontrado.' }, { status: 404 })
  const { data: t } = await c.admin.from('caixa_turnos').select('id, fechado_em').eq('id', id).eq('restaurante_id', c.sessao.restauranteId).maybeSingle()
  if (!t) return NextResponse.json({ error: 'Turno não encontrado.' }, { status: 404 })
  if (!t.fechado_em) return NextResponse.json({ error: 'O relatório de fechamento só existe depois de fechar o caixa.' }, { status: 409 })
  await registrarAuditoria(c.admin, {
    restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome,
    acao: 'fin.reimprimiu_relatorio', entidade: 'caixa', entidadeId: id, dados: { dispositivo: c.dispositivo },
  })
  return NextResponse.json({ ok: true, url: `/admin/financeiro/caixa/${id}` })
}
