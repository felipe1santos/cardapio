import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { COLUNAS_AGENDAMENTO, configAgendamento, horariosAgendamento, podeAgendar, type DiaAgendamento } from '@/lib/agendamento'
import { lojaEstaAberta, type HorarioFuncionamento } from '@/lib/timezone'

export const dynamic = 'force-dynamic'

export interface AgendamentoResposta {
  podeAgendar: boolean
  entrega: boolean
  retirada: boolean
  dias: DiaAgendamento[]
}

/**
 * Horários que a vitrine pode oferecer agora (Fase 7, 0121): grade + antecedência +
 * intervalo, sem os horários que já lotaram. Só leitura; quem decide de verdade é
 * criarPedido, que confere tudo de novo.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const admin = getAdminSupabase()
  const { data: loja, error } = await admin
    .from('restaurantes')
    .select(`id, status_loja, horario_funcionamento, ${COLUNAS_AGENDAMENTO}`)
    .eq('slug', slug)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  const row = loja as unknown as Record<string, unknown> & { id: string; status_loja: string | null; horario_funcionamento: HorarioFuncionamento | null }
  const config = configAgendamento(row)
  const aberta = lojaEstaAberta({ statusLoja: (row.status_loja ?? 'automatico') as 'automatico', horarioFuncionamento: row.horario_funcionamento ?? null })
  const pode = podeAgendar(config, aberta)
  if (!pode) return NextResponse.json<AgendamentoResposta>({ podeAgendar: false, entrega: false, retirada: false, dias: [] })

  const ocupacao = new Map<string, number>()
  if (config.limite !== null) {
    const { data: peds } = await admin
      .from('pedidos')
      .select('agendado_para')
      .eq('restaurante_id', row.id)
      .gt('agendado_para', new Date().toISOString())
      .neq('status', 'cancelado')
      .limit(5000)
    for (const p of peds ?? []) {
      const iso = new Date(p.agendado_para as string).toISOString()
      ocupacao.set(iso, (ocupacao.get(iso) ?? 0) + 1)
    }
  }
  const dias = horariosAgendamento(config, row.horario_funcionamento ?? null, new Date(), ocupacao)
  return NextResponse.json<AgendamentoResposta>(
    { podeAgendar: true, entrega: config.entrega, retirada: config.retirada, dias },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
