import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin, veValoresFin } from '@/lib/financeiro/permissoes'
import { extratoDoTurno, saldosDoTurno } from '@/lib/financeiro/caixa'

/** Relatório de um caixa FECHADO (ou aberto, para quem vê valores). Só da loja da sessão. */
export async function GET(_r: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  const loja = c.sessao.restauranteId
  const ve = veValoresFin(c.sessao.papel, c.acessos)
  if (!ve && !podeFin(c.sessao.papel, c.acessos, 'fechar_caixa')) return NextResponse.json({ error: 'Você não tem permissão para ver o relatório.' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Caixa inválido.' }, { status: 400 })
  const { data: turno } = await c.admin.from('caixa_turnos').select('*').eq('id', id).eq('restaurante_id', loja).maybeSingle()
  if (!turno) return NextResponse.json({ error: 'Caixa não encontrado.' }, { status: 404 })
  if (!turno.fechado_em && !ve) return NextResponse.json({ error: 'O relatório sai depois do fechamento.' }, { status: 409 })
  const [{ data: r }, saldos, extrato] = await Promise.all([
    c.admin.from('restaurantes').select('nome').eq('id', loja).maybeSingle(),
    saldosDoTurno(c.admin, loja, id),
    extratoDoTurno(c.admin, loja, id, 2000),
  ])
  const porForma: Record<string, number> = {}
  for (const l of extrato) if (l.tipo === 'recebimento' || l.tipo === 'estorno') porForma[l.forma ?? 'outro'] = (porForma[l.forma ?? 'outro'] ?? 0) + Number(l.valor_centavos)
  return NextResponse.json({ loja: r?.nome ?? '', turno, saldos, porForma, extrato }, { headers: { 'Cache-Control': 'no-store' } })
}
