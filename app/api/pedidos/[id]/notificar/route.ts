import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'
import type { StatusPedido } from '@/lib/queries/pedidos'

const STATUS_NOTIFICAVEIS: StatusPedido[] = ['recebido', 'preparando', 'pronto', 'em_rota', 'entregue', 'cancelado']

/**
 * Envia a notificação de WhatsApp correspondente à nova etapa do pedido. Fogo-e-esquece:
 * chamada pelo painel depois de avançar o status.
 *
 * **Exige sessão.** Antes não exigia, e quem tivesse o UUID de um pedido mandava
 * mensagem no WhatsApp do cliente da loja quantas vezes quisesse — de fora, sem login.
 *
 * Os consumidores legítimos (inventariados antes da mudança) são todos telas do painel
 * já autenticadas, que chamam via `lib/notificar.ts` com o cookie da sessão:
 * `/admin/pedidos` (Kanban), `/admin/logistica` e `components/pedidos/rota-panel.tsx`.
 * Cozinha, entregador, vitrine e o webhook do Nexta NÃO passam por aqui — eles chamam
 * `notificarPedido` de `lib/whatsapp` direto no servidor, com autenticação própria de
 * token, e continuam intocados.
 *
 * Três camadas: sessão válida, pedido da MESMA loja da sessão, e permissão pelo canal do
 * pedido (`podeNotificarCanal`). O garçom, que não vê delivery, também não avisa o
 * cliente de delivery.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let body: { status?: StatusPedido }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  if (!body.status || !STATUS_NOTIFICAVEIS.includes(body.status)) {
    return NextResponse.json({ error: 'Status não notificável' }, { status: 400 })
  }

  const admin = getAdminSupabase()

  // O canal e a loja vêm do BANCO, nunca do corpo: pedido de outra loja não é notificável
  // nem enumerável (404 igual para inexistente e para alheio).
  const { data: pedido } = await admin
    .from('pedidos')
    .select('id, canal')
    .eq('id', id)
    .eq('restaurante_id', sessao.restauranteId)
    .maybeSingle()
  if (!pedido) return NextResponse.json({ error: 'Pedido não encontrado' }, { status: 404 })

  if (!podeNotificarCanal(sessao.papel, (pedido.canal as string | null) ?? 'delivery')) {
    return NextResponse.json({ error: 'Sem permissão para notificar este pedido' }, { status: 403 })
  }

  try {
    // WhatsApp + motor de fidelidade moram em lib/pedido-eventos.ts: o webhook do Nexta
    // também move o status do pedido (coleta/entrega) e precisa dos mesmos efeitos.
    // A trava por status no banco continua sendo o que impede mensagem repetida — esta
    // rota chamada duas vezes com o mesmo status manda uma mensagem só.
    const notificou = await aplicarEfeitosStatusPedidoComTrava(admin, id, body.status)
    return NextResponse.json(notificou ? { ok: true } : { ok: true, jaNotificado: true })
  } catch (err) {
    console.error('[whatsapp] erro ao notificar pedido', err)
    return NextResponse.json({ error: 'Erro ao notificar' }, { status: 500 })
  }
}
