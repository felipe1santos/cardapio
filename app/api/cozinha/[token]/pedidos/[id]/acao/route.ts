// app/api/cozinha/[token]/pedidos/[id]/acao/route.ts
import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { podeExecutar, ORIGEM_ESPERADA, type AcaoCozinha } from '@/lib/cozinha/modo'
import {
  pegarPedidoCozinha,
  devolverPedidoCozinha,
  concluirPedidoCozinha,
  marcarPedidoEntregue,
  marcarPreparandoNotificado,
} from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/whatsapp'

const ACOES_VALIDAS: AcaoCozinha[] = ['pegar', 'devolver', 'concluir', 'entregue']

export async function POST(request: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  const { token, id } = await params
  const admin = getAdminSupabase()

  const body = await request.json().catch(() => ({}))
  const acao = body.acao as AcaoCozinha
  const cozinheiro = typeof body.cozinheiro === 'string' ? body.cozinheiro.trim() : ''
  if (!ACOES_VALIDAS.includes(acao)) return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  if ((acao === 'pegar' || acao === 'concluir' || acao === 'devolver') && !cozinheiro) {
    return NextResponse.json({ error: 'Informe o nome do cozinheiro' }, { status: 400 })
  }

  try {
    const estacao = await buscarEstacaoPorToken(admin, token)
    if (!estacao) return NextResponse.json({ error: 'Link inválido ou estação desativada' }, { status: 404 })
    if (!podeExecutar(estacao.modo, acao)) return NextResponse.json({ error: 'Esta estação não pode executar essa ação' }, { status: 403 })

    const { data: pedido } = await admin.from('pedidos').select('id, restaurante_id, tipo, status, preparando_por').eq('id', id).maybeSingle()
    if (!pedido || pedido.restaurante_id !== estacao.restauranteId) {
      return NextResponse.json({ error: 'Pedido não encontrado nesta loja' }, { status: 409 })
    }
    if (pedido.status !== ORIGEM_ESPERADA[acao]) {
      return NextResponse.json({ error: 'O pedido já mudou de etapa' }, { status: 409 })
    }
    // Trava de dono: só quem pegou pode devolver/concluir. Pedidos sem dono
    // (ex.: aceitos pelo Kanban, preparando_por null) ficam livres para qualquer um.
    if ((acao === 'devolver' || acao === 'concluir') && pedido.preparando_por && pedido.preparando_por !== cozinheiro) {
      return NextResponse.json({ error: 'Outro cozinheiro está preparando este pedido' }, { status: 409 })
    }
    if (acao === 'entregue' && pedido.tipo !== 'retirada') {
      return NextResponse.json({ error: 'Pedido de entrega é despachado pela Logística' }, { status: 409 })
    }

    if (acao === 'pegar') {
      const pego = await pegarPedidoCozinha(admin, id, cozinheiro)
      if (!pego) return NextResponse.json({ error: 'Outro cozinheiro já pegou esse pedido' }, { status: 409 })
      // Notifica "em preparo" só na primeira vez — devolver + pegar de novo não reenvia.
      if (await marcarPreparandoNotificado(admin, id)) notificarPedido(admin, id, 'preparando').catch(() => {})
    } else if (acao === 'devolver') {
      const ok = await devolverPedidoCozinha(admin, id)
      if (!ok) return NextResponse.json({ error: 'O pedido já mudou de etapa' }, { status: 409 })
    } else if (acao === 'concluir') {
      const ok = await concluirPedidoCozinha(admin, id, cozinheiro)
      if (!ok) return NextResponse.json({ error: 'O pedido já mudou de etapa' }, { status: 409 })
      notificarPedido(admin, id, 'pronto').catch(() => {})
    } else {
      await marcarPedidoEntregue(admin, id)
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar o pedido' }, { status: 500 })
  }
}
