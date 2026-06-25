// app/api/cozinha/[token]/pedidos/[id]/acao/route.ts
import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { podeExecutar, transicaoDe, type AcaoCozinha } from '@/lib/cozinha/modo'
import { avancarStatusPedido, marcarPedidoEntregue, type StatusPedido } from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/whatsapp'

const ACOES_VALIDAS: AcaoCozinha[] = ['aceitar', 'pronto', 'entregue']

const ORIGEM_ESPERADA: Record<AcaoCozinha, StatusPedido> = {
  aceitar: 'recebido',
  pronto: 'preparando',
  entregue: 'pronto',
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  const body = await request.json().catch(() => ({}))
  const acao = body.acao as AcaoCozinha
  if (!ACOES_VALIDAS.includes(acao)) return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })

    // Gate por modo.
    if (!podeExecutar(estacao.modo, acao)) {
      return NextResponse.json({ error: 'Esta estação não pode executar essa ação' }, { status: 403 })
    }

    // Segurança: confirma que o pedido é da loja da estação (admin client ignora RLS).
    const { data: pedido } = await admin.from('pedidos').select('id, restaurante_id, tipo, status').eq('id', id).maybeSingle()
    if (!pedido || pedido.restaurante_id !== estacao.restauranteId) {
      return NextResponse.json({ error: 'Pedido não encontrado nesta loja' }, { status: 409 })
    }

    // 'entregue' só faz sentido para retirada (entrega vira responsabilidade da logística).
    if (acao === 'entregue' && pedido.tipo !== 'retirada') {
      return NextResponse.json({ error: 'Pedido de entrega é despachado pela Logística' }, { status: 409 })
    }

    // Guarda de status: evita regressão por cliques obsoletos/concorrentes.
    if (pedido.status !== ORIGEM_ESPERADA[acao]) {
      return NextResponse.json({ error: 'O pedido já mudou de etapa' }, { status: 409 })
    }

    const { status, viaEntregue } = transicaoDe(acao)
    if (viaEntregue) await marcarPedidoEntregue(admin, id)
    else {
      await avancarStatusPedido(admin, id, status)
      if (status === 'preparando' || status === 'pronto') notificarPedido(admin, id, status).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar o pedido' }, { status: 500 })
  }
}
