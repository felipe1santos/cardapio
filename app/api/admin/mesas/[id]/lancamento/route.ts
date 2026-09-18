import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { contextoSalao } from '@/lib/auth/salao'
import { criarPedido } from '@/lib/queries/pedidos'
import { sanearItensLancamento } from '@/lib/lancamento-mesa'
import { abrirOuObterComanda } from '@/lib/queries/comandas'
import { abrirOuObterSessao, encerrarSelecoesVistas, sanearSelecoesVistas } from '@/lib/queries/mesa-sessao'
import { registrarAuditoria } from '@/lib/auditoria'
import { validarOpcoes, type GrupoOpcoesRegra } from '@/lib/opcoes-item'
import { itemDisponivelNoCanal, motivoIndisponivel } from '@/lib/canais-item'
import { itemDisponivelHoje } from '@/lib/timezone'

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

  // Sessão, módulo ligado na loja e permissão de lançar — conferidos do banco.
  const ctx = await contextoSalao('pedidos.mesa.enviar_cozinha')
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx

  let corpo: { itens?: unknown; chaveIdempotencia?: unknown; selecoesVistas?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  // Allowlist: preço, canal, loja, comanda e autor nunca vêm do corpo.
  const saneado = sanearItensLancamento(corpo.itens)
  if (!saneado.ok) return NextResponse.json({ error: saneado.erro }, { status: 400 })
  const itens = saneado.itens

  // A chave é gerada quando o garçom começa a montar o lançamento e só muda depois de um
  // envio bem-sucedido. Sem ela não há como distinguir "segundo pedido" de "mesmo pedido
  // reenviado", então é obrigatória.
  const chave = typeof corpo.chaveIdempotencia === 'string' ? corpo.chaveIdempotencia : ''
  if (!/^[0-9a-f-]{36}$/i.test(chave)) {
    return NextResponse.json({ error: 'Chave do lançamento ausente ou inválida' }, { status: 400 })
  }
  const selecoesVistas = sanearSelecoesVistas(corpo.selecoesVistas)

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

  const idsItens = [...new Set(itens.map((i) => i.itemId))]

  // Disponibilidade conferida ANTES de criar nada, e devolvida item por item.
  //
  // `criarPedido` já recusa item indisponível, mas estourando um `Error` com o nome no
  // texto: o garçom leria "Item X não está disponível" e não saberia qual linha tirar
  // nem o que aconteceu. Aqui a resposta diz exatamente quais linhas travaram, para a
  // tela marcá-las e deixar o resto do lançamento intacto — o cliente marcou no celular
  // e o prato pode ter esgotado nesse meio-tempo.
  const indisponiveis = await conferirDisponibilidade(admin, sessao.restauranteId, idsItens)
  if (indisponiveis.length > 0) {
    // 400 quando o id nem existe nesta loja (corpo inválido: o navegador mandou algo que
    // nunca foi cardápio). 409 quando o item existe mas saiu do ar entre o cliente marcar
    // e o garçom enviar — aí é conflito de estado, e a tela oferece trocar ou remover.
    const soInexistente = indisponiveis.every((i) => i.tipo === 'inexistente')
    return NextResponse.json(
      {
        error:
          indisponiveis.length === 1
            ? indisponiveis[0]!.motivo
            : `${indisponiveis.length} itens saíram do cardápio. Remova ou substitua antes de enviar.`,
        itensIndisponiveis: indisponiveis,
      },
      { status: soInexistente ? 400 : 409 },
    )
  }

  // Grupos obrigatórios conferidos no SERVIDOR: `criarPedido` reprecifica cada opção pelo
  // nome, mas não verifica se "Escolha o ponto" foi respondido. Sem isto a cozinha
  // receberia um burger sem ponto. Ver lib/opcoes-item.ts.
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

  // Reenvio da mesma chave: devolve o pedido que já existe. Nada é criado de novo.
  const jaExiste = await buscarPedidoPorChave(admin, sessao.restauranteId, chave)
  if (jaExiste) {
    return NextResponse.json({ ok: true, idempotente: true, ...jaExiste }, { status: 200 })
  }

  try {
    // A conta nasce aqui, no primeiro lançamento — não quando o cliente abriu o QR.
    const { comanda, nasceuAgora } = await abrirOuObterComanda(admin, sessao.restauranteId, mesaId)
    const sessaoMesa = await abrirOuObterSessao(admin, sessao.restauranteId, mesaId)

    if (!sessaoMesa.comandaId) {
      await admin.from('sessoes_mesa').update({ comanda_id: comanda.id }).eq('id', sessaoMesa.id)
    }

    // "Mesa aberta" é um evento próprio: é o marco de quando aquela mesa entrou em
    // operação e por quem. Só na comanda que nasceu agora — quem perdeu a corrida do
    // find-or-create não abriu nada.
    if (nasceuAgora) {
      // Quem enviou o primeiro lançamento é o responsável operacional da mesa.
      await admin
        .from('comandas')
        .update({ responsavel_id: sessao.userId, responsavel_nome: sessao.nome })
        .eq('id', comanda.id)
        .is('responsavel_id', null)
      await registrarAuditoria(admin, {
        restauranteId: sessao.restauranteId,
        usuarioId: sessao.userId,
        usuarioNome: sessao.nome,
        acao: 'mesa.abriu',
        entidade: 'comanda',
        entidadeId: comanda.id,
        dados: { mesa: mesa.nome, de: 'livre', para: 'ocupada', numero: comanda.numero ?? null },
      })
    }

    let pedido: { id: string; numero: number }
    try {
      pedido = await criarPedido(admin, sessao.restauranteId, {
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
      chaveIdempotencia: chave,
    })
    } catch (err) {
      // Duas requisições com a mesma chave chegaram juntas: a primeira criou o pedido e
      // a segunda bateu no índice único. Não é erro — é o mesmo lançamento.
      if ((err as { code?: string })?.code === '23505') {
        const vencedor = await buscarPedidoPorChave(admin, sessao.restauranteId, chave)
        if (vencedor) return NextResponse.json({ ok: true, idempotente: true, ...vencedor }, { status: 200 })
      }
      throw err
    }

    // SÓ AGORA, com o pedido criado, o ciclo da seleção do cliente encerra. Se a criação
    // tivesse falhado, a execução não chegaria aqui e a seleção ficaria intacta.
    //
    // A seleção não foi IMPORTADA: o pedido contém só o que o garçom lançou. Ela encerra
    // porque aquele ciclo de escolha terminou. Compare-and-set por versão: lista que o
    // cliente alterou depois que o garçom abriu a tela continua aberta.
    let selecoesEncerradas = 0
    try {
      selecoesEncerradas = await encerrarSelecoesVistas(admin, sessao.restauranteId, mesaId, selecoesVistas)
    } catch (err) {
      // O pedido já existe e já está na cozinha: falhar aqui não pode desfazê-lo. A
      // seleção fica aberta e o garçom vê de novo — incômodo, mas não perde nada.
      console.error('[mesas] pedido criado, mas a seleção não encerrou', err)
    }

    await registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId,
      usuarioId: sessao.userId,
      usuarioNome: sessao.nome,
      acao: 'mesa.enviou_cozinha',
      entidade: 'pedido',
      entidadeId: pedido.id,
      dados: { mesa: mesa.nome, itens: itens.length, numero: pedido.numero, selecoesEncerradas },
    })

    // O pedido entra na fila de impressão pelo caminho de sempre: o Assistente lê
    // `pedidos` com impresso=false. Nada de novo no pipeline da cozinha.
    return NextResponse.json(
      { ok: true, idempotente: false, pedidoId: pedido.id, numero: pedido.numero, selecoesEncerradas },
      { status: 201 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível lançar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/**
 * Quais dos itens pedidos não podem ir para a cozinha agora, e por quê.
 *
 * Mesmas quatro regras que `criarPedido` aplica (existir na loja, status, dia da semana,
 * canal), só que reunidas num relatório em vez de na primeira exceção.
 */
async function conferirDisponibilidade(
  admin: ReturnType<typeof getAdminSupabase>,
  restauranteId: string,
  idsItens: string[],
): Promise<{ itemId: string; nome: string; motivo: string; tipo: 'inexistente' | 'status' | 'dia' | 'canal' }[]> {
  const { data } = await admin
    .from('itens_cardapio')
    .select('id, nome, status, dias_disponiveis, disponivel_salao')
    .eq('restaurante_id', restauranteId)
    .in('id', idsItens)

  const porId = new Map((data ?? []).map((i) => [i.id as string, i]))
  const problemas: { itemId: string; nome: string; motivo: string; tipo: 'inexistente' | 'status' | 'dia' | 'canal' }[] = []

  for (const id of idsItens) {
    const item = porId.get(id)
    if (!item) {
      problemas.push({ itemId: id, nome: 'Item removido', motivo: motivoIndisponivel('inexistente', 'O item'), tipo: 'inexistente' })
      continue
    }
    const nome = item.nome as string
    if (item.status !== 'disponivel') {
      problemas.push({ itemId: id, nome, motivo: motivoIndisponivel('status', nome), tipo: 'status' })
    } else if (!itemDisponivelHoje((item.dias_disponiveis as number[] | null) ?? [])) {
      problemas.push({ itemId: id, nome, motivo: motivoIndisponivel('dia', nome), tipo: 'dia' })
    } else if (
      !itemDisponivelNoCanal({ disponivelDelivery: true, disponivelSalao: (item.disponivel_salao as boolean | null) ?? true }, 'mesa')
    ) {
      problemas.push({ itemId: id, nome, motivo: motivoIndisponivel('canal', nome), tipo: 'canal' })
    }
  }
  return problemas
}

async function buscarPedidoPorChave(
  admin: ReturnType<typeof getAdminSupabase>,
  restauranteId: string,
  chave: string,
): Promise<{ pedidoId: string; numero: number } | null> {
  const { data } = await admin
    .from('pedidos')
    .select('id, numero')
    .eq('restaurante_id', restauranteId)
    .eq('chave_idempotencia', chave)
    .maybeSingle()
  return data ? { pedidoId: data.id as string, numero: data.numero as number } : null
}
