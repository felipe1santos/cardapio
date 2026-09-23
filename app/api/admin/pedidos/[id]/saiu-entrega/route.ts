import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { notificarPedido } from '@/lib/whatsapp'
import { processarFidelidadePedidoEntregue } from '@/lib/fidelidade'

/**
 * "Saiu para entrega" das lojas que entregam SEM entregador
 * (`restaurantes.entrega_sem_entregador`, migration 0079).
 *
 * Um toque no Kanban faz, no servidor e nesta ordem:
 *   1. pronto → em_rota (o gatilho carimba em_rota_em);
 *   2. manda o WhatsApp de "saiu para entrega";
 *   3. em_rota → entregue, SEM a segunda mensagem ("entregue" ninguém confirmou);
 *   4. roda a fidelidade, que só credita pedido entregue.
 *
 * Fechar como entregue, em vez de deixar em rota, é o que mantém o resto do
 * sistema inteiro: pedido em rota sem dono vira alerta de "pedido parado",
 * nunca credita fidelidade e fica eternamente na lista de trânsito.
 *
 * Cada UPDATE casa o status anterior: dois operadores clicando juntos não
 * mandam a mensagem duas vezes — o segundo recebe 409.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const admin = getAdminSupabase()

  const { data: loja } = await admin
    .from('restaurantes')
    .select('entrega_sem_entregador')
    .eq('id', sessao.restauranteId)
    .maybeSingle()
  if (!loja?.entrega_sem_entregador) {
    return NextResponse.json({ error: 'A loja está configurada para entregar com entregadores.' }, { status: 409 })
  }

  const { data: pedido } = await admin
    .from('pedidos')
    .select('id, tipo, status, canal')
    .eq('id', id)
    .eq('restaurante_id', sessao.restauranteId)
    .maybeSingle()
  if (!pedido) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })
  if (!podeNotificarCanal(sessao.papel, (pedido.canal as string | null) ?? 'delivery')) {
    return NextResponse.json({ error: 'Sem permissão para este pedido' }, { status: 403 })
  }
  if (pedido.tipo !== 'entrega') return NextResponse.json({ error: 'Só pedido de entrega sai para entrega.' }, { status: 409 })

  const { data: saiu, error: erroSaida } = await admin
    .from('pedidos')
    .update({ status: 'em_rota' })
    .eq('id', id)
    .eq('restaurante_id', sessao.restauranteId)
    .eq('status', 'pronto')
    .select('id')
  if (erroSaida) return NextResponse.json({ error: 'Não foi possível atualizar o pedido.' }, { status: 500 })
  if (!saiu?.length) return NextResponse.json({ error: 'O pedido não está mais pronto — atualize a tela.' }, { status: 409 })

  const mensagem = await notificarPedido(admin, id, 'em_rota').catch((err) => {
    console.error('[saiu-entrega] aviso ao cliente falhou', err)
    return 'falhou' as const
  })

  const { error: erroFim } = await admin
    .from('pedidos')
    .update({ status: 'entregue' })
    .eq('id', id)
    .eq('status', 'em_rota')
  if (erroFim) {
    // A saída já aconteceu e o cliente já foi avisado: não desfaz. Fica em rota e
    // o operador conclui pela coluna de trânsito.
    console.error('[saiu-entrega] não concluiu o pedido', erroFim.message)
    return NextResponse.json({ ok: true, concluido: false, mensagem })
  }

  processarFidelidadePedidoEntregue(admin, sessao.restauranteId, id).catch((err) => console.error('[fidelidade]', err))
  return NextResponse.json({ ok: true, concluido: true, mensagem })
}
