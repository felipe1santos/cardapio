import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { criarPedido, type NovoPedidoItemInput } from '@/lib/queries/pedidos'
import { abrirOuObterComanda } from '@/lib/queries/comandas'
import { abrirOuObterSessao } from '@/lib/queries/mesa-sessao'
import { registrarAuditoria } from '@/lib/auditoria'
import { validarOpcoes, type GrupoOpcoesRegra } from '@/lib/opcoes-item'

/**
 * **Enviar para a cozinha.** É a única porta que transforma itens em pedido oficial de
 * mesa — e ela exige sessão autenticada com `pedidos.mesa.enviar_cozinha`.
 *
 * O que o servidor decide sozinho, sem olhar o corpo: a loja (vem da sessão), a mesa
 * (vem da URL e é conferida contra a loja), a comanda (find-or-create), o canal, quem
 * lançou, e todos os preços (recalculados do catálogo por `criarPedido`).
 *
 * O que NÃO existe aqui: entrega, frete, endereço, entregador, logística. Pedido de
 * salão é `tipo: 'retirada'` porque ninguém leva nada a lugar nenhum — o garçom serve.
 */

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: mesaId } = await params

  const supabase = await getServerSupabase()
  const sessao = await getCurrentSession(supabase)
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  if (!pode(sessao.papel, 'pedidos.mesa.enviar_cozinha')) {
    return NextResponse.json({ error: 'Sem permissão para lançar pedido de mesa' }, { status: 403 })
  }

  let corpo: { itens?: unknown; observacao?: unknown; idempotencia?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const itens = Array.isArray(corpo.itens) ? (corpo.itens as NovoPedidoItemInput[]) : []
  if (itens.length === 0) {
    return NextResponse.json({ error: 'Nenhum item no lançamento' }, { status: 400 })
  }

  const admin = getAdminSupabase()

  // A mesa tem que ser desta loja. Sem isso, um id de mesa vizinha lançaria pedido lá.
  const { data: mesa, error: erroMesa } = await admin
    .from('mesas')
    .select('id, nome, ativa, bloqueada_em')
    .eq('id', mesaId)
    .eq('restaurante_id', sessao.restauranteId)
    .maybeSingle()
  if (erroMesa) return NextResponse.json({ error: 'Erro ao localizar a mesa' }, { status: 500 })
  if (!mesa) return NextResponse.json({ error: 'Mesa não encontrada nesta loja' }, { status: 404 })
  if ((mesa.ativa ?? true) === false) {
    return NextResponse.json({ error: 'Mesa desativada' }, { status: 409 })
  }
  if (mesa.bloqueada_em !== null) {
    return NextResponse.json({ error: 'Mesa bloqueada' }, { status: 409 })
  }

  // Grupos obrigatórios conferidos no SERVIDOR: `criarPedido` reprecifica cada opção pelo
  // nome, mas não verifica se "Escolha o ponto" foi respondido. Sem isto a cozinha
  // receberia um burger sem ponto. Ver lib/opcoes-item.ts.
  const idsItens = [...new Set(itens.map((i) => i.itemId))]
  const { data: gruposDb, error: erroGrupos } = await admin
    .from('grupos_item_complementos')
    .select('item_id, nome, obrigatorio, min_escolhas, max_escolhas, item_complementos ( nome, pausado )')
    .in('item_id', idsItens)
  if (erroGrupos) return NextResponse.json({ error: 'Erro ao conferir as opções' }, { status: 500 })

  const gruposPorItem = new Map<string, GrupoOpcoesRegra[]>()
  for (const g of (gruposDb ?? []) as unknown as {
    item_id: string; nome: string; obrigatorio: boolean; min_escolhas: number; max_escolhas: number
    item_complementos: { nome: string; pausado: boolean | null }[]
  }[]) {
    const lista = gruposPorItem.get(g.item_id) ?? []
    lista.push({
      nome: g.nome,
      obrigatorio: g.obrigatorio,
      minEscolhas: g.min_escolhas,
      maxEscolhas: g.max_escolhas,
      opcoes: (g.item_complementos ?? []).filter((c) => !c.pausado).map((c) => c.nome),
    })
    gruposPorItem.set(g.item_id, lista)
  }

  for (const linha of itens) {
    const erros = validarOpcoes(gruposPorItem.get(linha.itemId) ?? [], linha.complementos ?? [])
    if (erros.length > 0) return NextResponse.json({ error: erros[0], erros }, { status: 400 })
  }

  try {
    // A conta nasce aqui, no primeiro lançamento — não quando o cliente abriu o QR.
    const comanda = await abrirOuObterComanda(admin, sessao.restauranteId, mesaId)
    const sessaoMesa = await abrirOuObterSessao(admin, sessao.restauranteId, mesaId)

    if (!sessaoMesa.comandaId) {
      await admin.from('sessoes_mesa').update({ comanda_id: comanda.id }).eq('id', sessaoMesa.id)
    }

    const pedido = await criarPedido(admin, sessao.restauranteId, {
      tipo: 'retirada',
      cliente: { nome: mesa.nome, telefone: '' },
      endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
      pagamento: 'dinheiro',
      trocoPara: null,
      itens,
      origem: 'pdv',
      canal: 'mesa',
      mesa: mesa.nome,
      comandaId: comanda.id,
      criadoPor: sessao.userId,
      criadoPorNome: sessao.nome,
    })

    await registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId,
      usuarioId: sessao.userId,
      usuarioNome: sessao.nome,
      acao: 'mesa.enviou_cozinha',
      entidade: 'pedido',
      entidadeId: pedido.id,
      dados: { mesa: mesa.nome, itens: itens.length, numero: pedido.numero },
    })

    // O pedido entra na fila de impressão pelo caminho de sempre: o Assistente lê
    // `pedidos` com impresso=false. Nada de novo no pipeline da cozinha.
    return NextResponse.json({ ok: true, pedidoId: pedido.id, numero: pedido.numero }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível lançar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
