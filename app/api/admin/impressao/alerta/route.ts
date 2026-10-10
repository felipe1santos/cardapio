import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { lojaEstaAberta, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { alertaImprimirSozinhoDesligado, alertaSemAssistente, PEDIDOS_RECENTES_MIN } from '@/lib/impressao/alertas-painel'

/**
 * Alertas de impressão do painel (Alfa 1): Imprimir sozinho desligado com pedido chegando, e nenhum
 * computador buscando pedidos há mais de 2 min com a loja aberta. Só leitura, qualquer usuário da loja.
 */
export async function GET() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const admin = getAdminSupabase()
  const loja = sessao.restauranteId
  const desde = new Date(Date.now() - PEDIDOS_RECENTES_MIN * 60_000).toISOString()
  const [{ data: r }, { count }, { data: ags }] = await Promise.all([
    admin.from('restaurantes').select('impressao_automatica, status_loja, horario_funcionamento, impressao_agente_token, impressao_agente_visto_em').eq('id', loja).maybeSingle(),
    admin.from('pedidos').select('id', { count: 'exact', head: true }).eq('restaurante_id', loja).gte('criado_em', desde).not('status', 'in', '(cancelado,aguardando_pagamento)'),
    admin.from('impressao_agentes').select('visto_em').eq('restaurante_id', loja).is('revogado_em', null),
  ])
  const semCache = { 'Cache-Control': 'no-store' }
  if (!r) return NextResponse.json({ imprimirSozinhoDesligado: false, semAssistente: false }, { headers: semCache })
  const lojaAberta = lojaEstaAberta({ statusLoja: (r.status_loja as StatusLoja) ?? 'automatico', horarioFuncionamento: (r.horario_funcionamento as HorarioFuncionamento | null) ?? null })
  const automatica = r.impressao_automatica === true
  const sinais = ((ags ?? []) as { visto_em: string | null }[]).map((a) => a.visto_em)
  // Assistente antigo (token da loja) também conta como "instalado".
  if (r.impressao_agente_token) sinais.push((r.impressao_agente_visto_em as string | null) ?? null)
  return NextResponse.json({
    imprimirSozinhoDesligado: alertaImprimirSozinhoDesligado({ impressaoAutomatica: automatica, lojaAberta, pedidosRecentes: count ?? 0 }),
    semAssistente: alertaSemAssistente({ impressaoAutomatica: automatica, lojaAberta, sinais, agora: Date.now() }),
  }, { headers: semCache })
}
