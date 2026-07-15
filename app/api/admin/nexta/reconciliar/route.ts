import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { consultarEntrega, NextaError } from '@/lib/nexta'
import { carregarConfigNexta, erroNexta } from '@/lib/nexta-servidor'
import { aplicarEventoNexta } from '@/lib/nexta-estados'
import { buscarNextaEntregaAtivaDoPedido } from '@/lib/queries/nexta'

/**
 * Ressincroniza uma entrega consultando o Nexta (botão "Atualizar" do painel).
 *
 * Rede de segurança para webhook perdido. **Uma consulta por clique, nunca em loop**: a
 * spec proíbe usar o GET details como tracking e ameaça bloquear quem faz polling.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
  if (!restauranteId) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  let pedidoId: string
  try {
    pedidoId = ((await request.json()) as { pedidoId?: string }).pedidoId ?? ''
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (!pedidoId) return NextResponse.json({ error: 'pedidoId é obrigatório' }, { status: 400 })

  const admin = getAdminSupabase()
  try {
    const cfg = await carregarConfigNexta(admin, restauranteId)
    const entrega = await buscarNextaEntregaAtivaDoPedido(admin, pedidoId)
    if (!entrega || entrega.restauranteId !== restauranteId) {
      throw new NextaError('Este pedido não tem uma entrega ativa no Nexta.', 404, null)
    }

    const detalhes = await consultarEntrega(cfg, entrega.id)
    if (!detalhes.evento) return NextResponse.json({ ok: true, status: entrega.status, mudou: false })

    // Reaproveita a máquina de estados do webhook pra não haver duas verdades sobre o
    // que cada evento significa. `registrarBruto: false`: isto não é um webhook e não
    // deve virar linha no histórico de eventos recebidos.
    const resultado = await aplicarEventoNexta(
      admin,
      entrega,
      {
        deliveryId: detalhes.deliveryId ?? undefined,
        event: { type: detalhes.evento },
        deliveryPrice: detalhes.preco === null ? undefined : { price: { value: detalhes.preco } },
        deliveryPerson: detalhes.entregador
          ? { name: detalhes.entregador.nome, phone: detalhes.entregador.telefone, pictureURL: detalhes.entregador.fotoUrl }
          : undefined,
        externalTrackingURL: detalhes.trackingUrl ?? undefined,
      },
      { registrarBruto: false }
    )

    return NextResponse.json({ ok: true, status: resultado.statusNovo, mudou: resultado.aplicado })
  } catch (err) {
    const { mensagem, status } = erroNexta(err)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
