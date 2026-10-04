import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { ativarInsumo, historicoInsumo, lerEntradaInsumo, salvarInsumo } from '@/lib/financeiro/cmv'

/**
 * Um insumo. Insumo de outra loja → 404. Não existe DELETE: insumo em uso só se desativa (o histórico
 * de custos é append-only no banco).
 *   GET   → histórico de custos (custos_ver)
 *   PATCH → { acao: 'editar', ...campos, motivo? } | { acao: 'ativar', ativo } (custos_editar)
 */
const UUID = /^[0-9a-f-]{36}$/i

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await contextoFinanceiro('custos_ver')
  if ('erro' in c) return c.erro
  const { id } = await params
  const h = UUID.test(id) ? await historicoInsumo(c.admin, c.sessao.restauranteId, id) : null
  if (!h) return NextResponse.json({ error: 'Insumo não encontrado.' }, { status: 404 })
  return NextResponse.json(h, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await contextoFinanceiro('custos_editar')
  if ('erro' in c) return c.erro
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Insumo não encontrado.' }, { status: 404 })
  const corpo = await request.json().catch(() => null)
  const r = corpo?.acao === 'ativar' ? await ativarInsumo(c, id, corpo.ativo === true) : await salvarInsumo(c, id, lerEntradaInsumo(corpo))
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true })
}
