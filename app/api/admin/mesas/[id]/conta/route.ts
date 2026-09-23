import { NextResponse } from 'next/server'
import type { Permissao } from '@/lib/auth/permissoes'
import { contextoSalao, type ContextoSalao } from '@/lib/auth/salao'
import { ehFormaOferecida, formatarResumoPagamento } from '@/lib/conta'
import { registrarAuditoria } from '@/lib/auditoria'
import * as servicoConta from '@/lib/servicos/conta-presencial'
import {
  ajustarValores,
  buscarConta,
  cancelarComanda,
  cancelarItem,
  cancelarPedido,
  decidirCancelamento,
  estornarPagamento,
  historicoDaConta,
  solicitarCancelamento,
  transferirItens,
  transferirMesa,
} from '@/lib/queries/conta'

/**
 * Conta da mesa: resumo (GET) e todas as operações (POST com `acao`).
 *
 * Uma rota com ação discriminada, e não dez arquivos, para a tabela de permissões ficar
 * num lugar só e ser lida de uma vez. `contextoSalao` confere sessão, flag do módulo e a
 * permissão de VER a conta; cada ação exige a SUA permissão por cima, com as regras da
 * loja aplicadas (`podeNoSalao`: garçom recebe? caixa dá desconto?).
 *
 * Loja, mesa e autor vêm da sessão e da URL — nunca do corpo. Valores e totais vêm das
 * funções do banco (0067/0072), que travam a comanda enquanto mexem nela.
 */

const PERMISSAO_DA_ACAO: Record<string, Permissao> = {
  pagamento: 'comanda.fechar',
  estorno: 'comanda.estornar',
  ajustar_mesa: 'comanda.ver',
  ajustar_valores: 'comanda.desconto',
  fechar: 'comanda.fechar',
  transferir_mesa: 'comanda.transferir',
  transferir_itens: 'comanda.transferir',
  cancelar_item: 'pedidos.mesa.cancelar',
  cancelar_pedido: 'pedidos.mesa.cancelar',
  // Derrubar a conta inteira é mais grave que derrubar um lançamento, mas é a mesma
  // natureza de decisão (e o banco recusa se já entrou dinheiro).
  cancelar_comanda: 'pedidos.mesa.cancelar',
  solicitar_cancelamento: 'pedidos.mesa.solicitar_cancelamento',
  decidir_cancelamento: 'pedidos.mesa.cancelar',
  reimprimir: 'mesas.operar',
}

/** O que a tela usa para esconder botões. O POST confere de novo, ação por ação. */
function permissoesDaTela(ctx: ContextoSalao) {
  return {
    ...Object.fromEntries(Object.entries(PERMISSAO_DA_ACAO).map(([acao, p]) => [acao, ctx.pode(p)])),
    // Pessoas e observação: quem atende e quem divide a conta.
    ajustar_mesa: ctx.pode('mesas.operar') || ctx.pode('comanda.fechar'),
    // Assumir a mesa é de quem atende; o caixa ajusta pessoas e observação, não o responsável.
    assumir: ctx.pode('mesas.operar'),
    lancar: ctx.pode('pedidos.mesa.enviar_cozinha'),
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const texto = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

async function contexto(mesaId: string) {
  const ctx = await contextoSalao('comanda.ver')
  if ('erro' in ctx) return ctx
  if (!UUID.test(mesaId)) return { erro: NextResponse.json({ error: 'Mesa inválida' }, { status: 400 }) } as const

  const { data: mesa } = await ctx.admin
    .from('mesas')
    .select('id, nome')
    .eq('id', mesaId)
    .eq('restaurante_id', ctx.sessao.restauranteId)
    .maybeSingle()
  if (!mesa) return { erro: NextResponse.json({ error: 'Mesa não encontrada nesta loja' }, { status: 404 }) } as const
  return { ...ctx, mesa: mesa as { id: string; nome: string } } as const
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contexto(id)
  if ('erro' in ctx) return ctx.erro

  const conta = await buscarConta(ctx.admin, ctx.sessao.restauranteId, id)
  const { data: loja } = await ctx.admin
    .from('restaurantes')
    .select('formas_pagamento_mesa, taxa_servico_padrao, mesa_somente_visualizacao')
    .eq('id', ctx.sessao.restauranteId)
    .maybeSingle()

  return NextResponse.json({
    conta,
    historico: conta ? await historicoDaConta(ctx.admin, ctx.sessao.restauranteId, conta) : [],
    // Filtrado na fonte: loja que ainda tem `fiado` gravado de antes não oferece a
    // forma na tela de receber nem para nenhum outro consumidor desta rota.
    formasPagamento: ((loja?.formas_pagamento_mesa as string[] | null) ?? ['dinheiro', 'pix', 'credito', 'debito']).filter(
      ehFormaOferecida,
    ),
    taxaServicoPadrao: Number(loja?.taxa_servico_padrao ?? 0),
    // Cardápio da mesa só para ver (0075): a tela do salão avisa o garçom de que aqui
    // não existe seleção do cliente nem chamado — nada vem do QR.
    somenteVisualizacao: (loja?.mesa_somente_visualizacao as boolean | null) === true,
    permissoes: permissoesDaTela(ctx),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contexto(id)
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin, mesa } = ctx

  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const acao = typeof corpo.acao === 'string' ? corpo.acao : ''
  const exigida = PERMISSAO_DA_ACAO[acao]
  if (!exigida) return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  const permitido = acao === 'ajustar_mesa' ? permissoesDaTela(ctx).ajustar_mesa : ctx.pode(exigida)
  if (!permitido) return NextResponse.json({ error: 'Sem permissão para esta ação' }, { status: 403 })

  const conta = await buscarConta(admin, sessao.restauranteId, id)
  const precisaConta = acao !== 'transferir_itens'
  if (precisaConta && !conta) return NextResponse.json({ error: 'Esta mesa não tem conta aberta' }, { status: 409 })

  const auditar = (acaoAudit: string, entidadeId: string, dados: Record<string, unknown>) =>
    registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId,
      usuarioId: sessao.userId,
      usuarioNome: sessao.nome,
      acao: acaoAudit,
      entidade: 'comanda',
      entidadeId,
      dados: { mesa: mesa.nome, ...dados },
    })

  const STATUS_CONFLITO = new Set(['destino_ocupado', 'cancelamento_pendente', 'pagamento_excede_total', 'solicitacao_decidida', 'ja_cancelado'])
  const falhou = (r: { erro: string; codigo: string }) =>
    NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: STATUS_CONFLITO.has(r.codigo) ? 409 : 400 })

  switch (acao) {
    case 'pagamento': {
      const forma = corpo.forma
      const valor = Number(corpo.valor)
      const recebido = corpo.recebido === null || corpo.recebido === undefined || corpo.recebido === '' ? null : Number(corpo.recebido)
      const chave = typeof corpo.chave === 'string' ? corpo.chave : ''
      const observacao = texto(corpo.observacao) || null
      // `ehFormaOferecida` já barra `fiado`: a forma saiu da tela e não nasce mais
      // pagamento com ela, mesmo que a loja a tenha gravada de antes.
      if (!ehFormaOferecida(forma)) return NextResponse.json({ error: 'Forma de pagamento inválida.' }, { status: 400 })
      // A loja escolhe o que aceita na mesa; esconder o botão na tela não basta.
      const { data: loja } = await admin.from('restaurantes').select('formas_pagamento_mesa').eq('id', sessao.restauranteId).maybeSingle()
      const aceitas = (loja?.formas_pagamento_mesa as string[] | null) ?? ['dinheiro', 'pix', 'credito', 'debito']
      if (!aceitas.includes(forma)) return NextResponse.json({ error: 'A loja não aceita esta forma de pagamento na mesa.' }, { status: 400 })
      if (!UUID.test(chave)) return NextResponse.json({ error: 'Chave do pagamento ausente.' }, { status: 400 })
      if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: 'Informe um valor maior que zero.' }, { status: 400 })
      if (recebido !== null && !Number.isFinite(recebido)) return NextResponse.json({ error: 'Valor recebido inválido.' }, { status: 400 })

      // Mesmo serviço do PDV: grava canal (mesa) e origem (salao) e audita igual.
      const r = await servicoConta.pagar(
        admin,
        { restauranteId: sessao.restauranteId, userId: sessao.userId, nome: sessao.nome, papel: sessao.papel },
        { id: conta!.comandaId, tipo: 'mesa', mesaNome: mesa.nome, numero: conta!.numero, senha: null, clienteNome: null },
        { forma, valor, recebido, chave, observacao },
        aceitas,
        'salao',
      )
      if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'estorno': {
      const pagamentoId = typeof corpo.pagamentoId === 'string' ? corpo.pagamentoId : ''
      const motivo = texto(corpo.motivo)
      if (!UUID.test(pagamentoId)) return NextResponse.json({ error: 'Pagamento inválido.' }, { status: 400 })
      // O pagamento tem que ser DESTA conta — id de outra mesa não serve.
      const pag = conta!.pagamentos.find((p) => p.id === pagamentoId)
      if (!pag) return NextResponse.json({ error: 'Pagamento não pertence a esta conta.' }, { status: 404 })
      const r = await estornarPagamento(admin, { restauranteId: sessao.restauranteId, pagamentoId, motivo, atorNome: sessao.nome })
      if (!r.ok) return falhou(r)
      await auditar('conta.estorno', conta!.comandaId, {
        resumo: formatarResumoPagamento(pag.forma, pag.valor, 0), motivo, pagamento_id: pagamentoId,
      })
      return NextResponse.json({ ok: true })
    }

    case 'ajustar_mesa': {
      const patch: Record<string, unknown> = {}
      const antes: Record<string, unknown> = {}
      if (corpo.pessoas !== undefined) {
        const p = corpo.pessoas === null || corpo.pessoas === '' ? null : Math.floor(Number(corpo.pessoas))
        if (p !== null && (!Number.isFinite(p) || p < 1 || p > 99)) {
          return NextResponse.json({ error: 'Número de pessoas inválido.' }, { status: 400 })
        }
        patch.pessoas = p
        antes.pessoas = conta!.pessoas
      }
      if (typeof corpo.observacoes === 'string') {
        patch.observacoes = corpo.observacoes.trim().slice(0, 300) || null
        antes.observacoes = conta!.observacoes
      }
      // Assumir a mesa é de quem atende, não do caixa.
      if (corpo.assumir === true && ctx.pode('mesas.operar')) {
        patch.responsavel_id = sessao.userId
        patch.responsavel_nome = sessao.nome
        antes.responsavel = conta!.responsavelNome
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })
      const { error } = await admin.from('comandas').update(patch).eq('id', conta!.comandaId).eq('status', 'aberta')
      if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
      await auditar('conta.ajustou', conta!.comandaId, {
        resumo: Object.keys(patch).filter((k) => k !== 'responsavel_id').join(', '),
        antes,
        depois: { pessoas: patch.pessoas, observacoes: patch.observacoes, responsavel: patch.responsavel_nome },
      })
      return NextResponse.json({ ok: true })
    }

    case 'ajustar_valores': {
      const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))
      const taxa = num(corpo.taxaServico)
      const tipo = corpo.descontoTipo === 'percentual' ? 'percentual' : corpo.descontoTipo === 'valor' ? 'valor' : null
      // Compatibilidade: `desconto` sem tipo é desconto em reais, como antes da 0072.
      const valor = num(corpo.descontoValor ?? corpo.desconto)
      const pct = num(corpo.descontoPercentual)
      for (const n of [taxa, valor, pct]) {
        if (n !== null && !Number.isFinite(n)) return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 })
      }
      const r = await ajustarValores(admin, {
        restauranteId: sessao.restauranteId, comandaId: conta!.comandaId, taxa,
        descontoTipo: tipo ?? (valor !== null ? 'valor' : null),
        descontoValor: valor, descontoPercentual: pct,
        motivo: texto(corpo.descontoMotivo ?? corpo.motivo) || null,
        atorId: sessao.userId, atorNome: sessao.nome,
      })
      if (!r.ok) return falhou(r)
      // A função do banco já auditou taxa e desconto com antes, depois e motivo.
      return NextResponse.json({ ok: true, totais: r.valor })
    }

    case 'fechar': {
      // Mesmo fechamento do PDV. Loja sem `pdv_v2`: fecha como sempre fechou. Com a
      // flag: pedido na cozinha ou pronto sem servir bloqueia, e a resposta traz as
      // pendências para a tela mostrar.
      const r = await servicoConta.fechar(
        admin,
        { restauranteId: sessao.restauranteId, userId: sessao.userId, nome: sessao.nome, papel: sessao.papel },
        { id: conta!.comandaId, tipo: 'mesa', mesaNome: mesa.nome, numero: conta!.numero, senha: null, clienteNome: null },
        'salao',
      )
      if (!r.ok) {
        const pend = 'pendencias' in r ? r.pendencias : undefined
        return NextResponse.json({ error: r.erro, codigo: r.codigo, pendencias: pend }, { status: r.status })
      }
      return NextResponse.json({ ok: true, ...(r.valor as Record<string, unknown>) })
    }

    case 'transferir_mesa': {
      const destino = typeof corpo.destinoMesaId === 'string' ? corpo.destinoMesaId : ''
      const motivo = texto(corpo.motivo)
      if (!UUID.test(destino)) return NextResponse.json({ error: 'Mesa de destino inválida.' }, { status: 400 })
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo da transferência.', codigo: 'motivo_obrigatorio' }, { status: 400 })
      const r = await transferirMesa(admin, {
        restauranteId: sessao.restauranteId, origemMesaId: id, destinoMesaId: destino, mesclar: corpo.mesclar === true,
        atorId: sessao.userId, atorNome: sessao.nome, motivo,
      })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'transferir_itens': {
      const destino = typeof corpo.destinoMesaId === 'string' ? corpo.destinoMesaId : ''
      const motivo = texto(corpo.motivo)
      const itemIds = Array.isArray(corpo.itemIds) ? (corpo.itemIds as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)) : []
      if (!UUID.test(destino)) return NextResponse.json({ error: 'Mesa de destino inválida.' }, { status: 400 })
      if (itemIds.length === 0) return NextResponse.json({ error: 'Selecione pelo menos um item.' }, { status: 400 })
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo da transferência.', codigo: 'motivo_obrigatorio' }, { status: 400 })

      // Quantidade parcial: um número por item, na mesma ordem. Corpo sem isto (ou com
      // tamanho errado) transfere a linha inteira — o banco também trata `null`.
      const brutas = Array.isArray(corpo.quantidades) ? (corpo.quantidades as unknown[]) : null
      let quantidades: number[] | null = null
      if (brutas && brutas.length === itemIds.length) {
        quantidades = brutas.map((q) => Math.floor(Number(q)))
        if (quantidades.some((q) => !Number.isFinite(q) || q < 1)) {
          return NextResponse.json({ error: 'Quantidade a transferir inválida.' }, { status: 400 })
        }
      }
      // Só itens da conta DESTA mesa: id de item de outra mesa não é transferido daqui.
      const daConta = new Set(conta?.lancamentos.flatMap((l) => l.itens.map((i) => i.id)) ?? [])
      if (!itemIds.every((i) => daConta.has(i))) {
        return NextResponse.json({ error: 'Há itens que não pertencem a esta mesa.' }, { status: 400 })
      }
      const r = await transferirItens(admin, {
        restauranteId: sessao.restauranteId, itemIds, destinoMesaId: destino, atorId: sessao.userId,
        atorNome: sessao.nome, quantidades, motivo,
      })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'cancelar_comanda': {
      const motivo = texto(corpo.motivo)
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo.' }, { status: 400 })
      // A função do banco audita por dentro, na mesma transação do cancelamento.
      const r = await cancelarComanda(admin, {
        restauranteId: sessao.restauranteId, comandaId: conta!.comandaId, motivo,
        atorId: sessao.userId, atorNome: sessao.nome,
      })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'cancelar_item': {
      const itemId = typeof corpo.itemId === 'string' ? corpo.itemId : ''
      const motivo = texto(corpo.motivo)
      const item = conta!.lancamentos.flatMap((l) => l.itens).find((i) => i.id === itemId)
      if (!item) return NextResponse.json({ error: 'Item não pertence a esta conta.' }, { status: 404 })
      const r = await cancelarItem(admin, { restauranteId: sessao.restauranteId, itemId, motivo, atorNome: sessao.nome })
      if (!r.ok) return falhou(r)
      await auditar('conta.cancelou_item', conta!.comandaId, {
        resumo: `${item.quantidade}× ${item.nome}`, motivo, item_id: itemId, de: 'ativo', para: 'cancelado',
      })
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'cancelar_pedido': {
      const pedidoId = typeof corpo.pedidoId === 'string' ? corpo.pedidoId : ''
      const motivo = texto(corpo.motivo)
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo.' }, { status: 400 })
      if (!conta!.lancamentos.some((l) => l.id === pedidoId)) {
        return NextResponse.json({ error: 'Lançamento não pertence a esta conta.' }, { status: 404 })
      }
      // Função do banco: trava a comanda, confere o que já foi pago e audita.
      const r = await cancelarPedido(admin, { restauranteId: sessao.restauranteId, pedidoId, motivo, atorId: sessao.userId, atorNome: sessao.nome })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true })
    }

    case 'solicitar_cancelamento': {
      const pedidoId = typeof corpo.pedidoId === 'string' ? corpo.pedidoId : ''
      const itemId = typeof corpo.itemId === 'string' && corpo.itemId ? corpo.itemId : null
      const motivo = texto(corpo.motivo)
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo.' }, { status: 400 })
      const lanc = conta!.lancamentos.find((l) => l.id === pedidoId)
      if (!lanc || (itemId && !lanc.itens.some((i) => i.id === itemId))) {
        return NextResponse.json({ error: 'Item não pertence a esta conta.' }, { status: 404 })
      }
      const r = await solicitarCancelamento(admin, {
        restauranteId: sessao.restauranteId, pedidoId, itemId, motivo, atorId: sessao.userId, atorNome: sessao.nome,
      })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true, ...r.valor }, { status: r.valor.jaExistia ? 200 : 201 })
    }

    case 'decidir_cancelamento': {
      const solicitacaoId = typeof corpo.solicitacaoId === 'string' ? corpo.solicitacaoId : ''
      if (!conta!.solicitacoes.some((s) => s.id === solicitacaoId)) {
        return NextResponse.json({ error: 'Pedido de cancelamento não pertence a esta conta.' }, { status: 404 })
      }
      if (typeof corpo.aprovar !== 'boolean') return NextResponse.json({ error: 'Informe se aprova ou recusa.' }, { status: 400 })
      const r = await decidirCancelamento(admin, {
        restauranteId: sessao.restauranteId, solicitacaoId, aprovar: corpo.aprovar, observacao: texto(corpo.observacao) || null,
        atorId: sessao.userId, atorNome: sessao.nome,
      })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'reimprimir': {
      const pedidoId = typeof corpo.pedidoId === 'string' ? corpo.pedidoId : ''
      const lanc = conta!.lancamentos.find((l) => l.id === pedidoId)
      if (!lanc) return NextResponse.json({ error: 'Lançamento não pertence a esta conta.' }, { status: 404 })
      if (lanc.status === 'cancelado') return NextResponse.json({ error: 'Lançamento cancelado não é reimpresso.' }, { status: 409 })
      // Mecanismo que já existe: o Assistente de Impressão pega `reimprimir = true` e imprime
      // o recibo de sempre. Nenhum formato novo — a folha é protegida (CLAUDE.md §7).
      const { error } = await admin.from('pedidos').update({ reimprimir: true }).eq('id', pedidoId).eq('restaurante_id', sessao.restauranteId)
      if (error) return NextResponse.json({ error: 'Erro ao pedir reimpressão.' }, { status: 500 })
      await auditar('conta.reimprimiu', conta!.comandaId, { resumo: `#${lanc.numero}` })
      return NextResponse.json({ ok: true })
    }
  }

  return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
}
