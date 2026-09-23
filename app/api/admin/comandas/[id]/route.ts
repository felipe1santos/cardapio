import { NextResponse } from 'next/server'
import { contextoPresencial, type ContextoPresencial } from '@/lib/auth/presencial'
import { ehAcaoConta, ehUuid, permissoesDaConta, PERMISSAO_DA_ACAO, sanearResolucao } from '@/lib/pdv-v2'
import { ajustarValores } from '@/lib/queries/conta'
import { ehFormaOferecida } from '@/lib/conta'
import * as conta from '@/lib/servicos/conta-presencial'

/**
 * Conta presencial (mesa ou balcão) no PDV v2: leitura completa (GET) e toda ação que
 * mexe nela (POST `{ acao, ... }`).
 *
 * Três portas antes de qualquer ação: sessão + flag `pdv_v2` (contextoPresencial),
 * a comanda precisa ser DESTA loja, e a permissão da ação com as regras da loja
 * (`PERMISSAO_DA_ACAO`). O banco confere o resto (estado, saldo, trava).
 */

const texto = (v: unknown, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function ator(ctx: ContextoPresencial): conta.Ator {
  return { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel }
}

function responder<T>(r: conta.Resultado<T> & { pendencias?: unknown }) {
  if (r.ok) return NextResponse.json({ ok: true, resultado: r.valor })
  return NextResponse.json({ error: r.erro, codigo: r.codigo, detalhe: r.detalhe, pendencias: r.pendencias ?? undefined }, { status: r.status })
}

async function carregar(id: string) {
  const ctx = await contextoPresencial('comanda.ver')
  if ('erro' in ctx) return ctx
  if (!ehUuid(id)) return { erro: NextResponse.json({ error: 'Conta inválida' }, { status: 400 }) }
  const c = await conta.buscarConta(ctx.admin, ctx.sessao.restauranteId, id)
  if (!c) return { erro: NextResponse.json({ error: 'Conta não encontrada nesta loja' }, { status: 404 }) }
  // Conta de mesa pertence ao módulo de mesas: desligado, ela não existe para o PDV.
  if (c.tipo === 'mesa' && !ctx.loja.moduloMesas) return { erro: NextResponse.json({ error: 'Não encontrado' }, { status: 404 }) }
  return { ctx, c }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await carregar(id)
  if ('erro' in r) return r.erro
  const { ctx, c } = r
  const [historico, pend] = await Promise.all([
    conta.historicoDaContaPresencial(ctx.admin, ctx.sessao.restauranteId, c),
    c.status === 'aberta' ? conta.pendencias(ctx.admin, ator(ctx), c.id) : Promise.resolve(null),
  ])
  const permissoes = permissoesDaConta(ctx.pode, c.tipo)
  // Garçom só atende mesa; no balcão ele não tem papel.
  if (ctx.sessao.papel === 'garcom' && c.tipo === 'balcao') permissoes.atender = false
  return NextResponse.json(
    {
      conta: c,
      historico,
      pendencias: pend && pend.ok ? pend.valor : null,
      formasPagamento: ctx.loja.formasPagamento.filter((f) => ehFormaOferecida(f) || f === 'fiado'),
      permissoes,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const r = await carregar(id)
  if ('erro' in r) return r.erro
  const { ctx, c } = r
  const eu = ator(ctx)

  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  const acao = corpo.acao
  if (!ehAcaoConta(acao)) return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })

  // cancelar_pedido: basta uma das duas chaves; o banco aplica a regra de quem pediu.
  const permitido =
    acao === 'cancelar_pedido'
      ? ctx.pode('pedidos.presencial.cancelar_recebido') || ctx.pode('pedidos.presencial.cancelar')
      : ctx.pode(PERMISSAO_DA_ACAO[acao])
  if (!permitido) return NextResponse.json({ error: 'Sem permissão para esta ação' }, { status: 403 })

  const pedidoDaConta = (pid: unknown) => (ehUuid(pid) ? c.pedidos.find((p) => p.id === pid) : undefined)

  switch (acao) {
    case 'pagamento':
      return responder(await conta.pagar(ctx.admin, eu, c, corpo as never, ctx.loja.formasPagamento, 'pdv'))

    case 'estorno':
      return responder(await conta.estornar(ctx.admin, eu, c, texto(corpo.pagamentoId, 36), texto(corpo.motivo), 'pdv'))

    case 'ajustar_valores': {
      const num = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number(v))
      const taxa = num(corpo.taxaServico)
      const tipo = corpo.descontoTipo === 'percentual' ? 'percentual' : corpo.descontoTipo === 'valor' ? 'valor' : null
      const valor = num(corpo.descontoValor)
      const pct = num(corpo.descontoPercentual)
      for (const n of [taxa, valor, pct]) if (n !== null && !Number.isFinite(n)) return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 })
      // Balcão nasce em 0% e só dono/gerente aplicam taxa manual (`comanda.taxa`) — o
      // atendente não, nem quando a loja deixa o caixa dar desconto. Mesa segue a regra
      // do salão (`comanda.desconto` + `salao_caixa_desconto`).
      const mudaTaxa = taxa !== null && Math.round(taxa * 100) !== Math.round(c.taxaServicoPercentual * 100)
      if (mudaTaxa && c.tipo === 'balcao' && !ctx.pode('comanda.taxa')) {
        return NextResponse.json({ error: 'No balcão, só gerente ou dono aplica taxa de serviço.', codigo: 'sem_permissao_taxa' }, { status: 403 })
      }
      const aj = await ajustarValores(ctx.admin, {
        restauranteId: eu.restauranteId, comandaId: c.id, taxa, descontoTipo: tipo ?? (valor !== null ? 'valor' : null),
        descontoValor: valor, descontoPercentual: pct, motivo: texto(corpo.motivo) || null, atorId: eu.userId, atorNome: eu.nome,
      })
      if (!aj.ok) return NextResponse.json({ error: aj.erro, codigo: aj.codigo }, { status: aj.codigo === 'pagamento_excede_total' ? 409 : 400 })
      return NextResponse.json({ ok: true, resultado: aj.valor })
    }

    case 'atender': {
      const p = pedidoDaConta(corpo.pedidoId)
      if (!p) return NextResponse.json({ error: 'Pedido não pertence a esta conta.' }, { status: 404 })
      if (ctx.sessao.papel === 'garcom' && c.tipo !== 'mesa') return NextResponse.json({ error: 'Sem permissão para esta ação' }, { status: 403 })
      return responder(await conta.atender(ctx.admin, eu, p.id, 'pdv'))
    }

    case 'transicionar': {
      const p = pedidoDaConta(corpo.pedidoId)
      if (!p) return NextResponse.json({ error: 'Pedido não pertence a esta conta.' }, { status: 404 })
      return responder(await conta.transicionar(ctx.admin, eu, p.id, texto(corpo.de, 20), texto(corpo.para, 20), 'pdv'))
    }

    case 'pendencias':
      return responder(await conta.pendencias(ctx.admin, eu, c.id))

    case 'fechar':
      return responder(await conta.fechar(ctx.admin, eu, c, 'pdv'))

    case 'resolver': {
      const s = sanearResolucao(corpo)
      if (!s.ok) return NextResponse.json({ error: s.erro }, { status: 400 })
      if (!s.acoes.every((a) => c.pedidos.some((p) => p.id === a.pedido_id))) {
        return NextResponse.json({ error: 'Há pedido que não pertence a esta conta.' }, { status: 400 })
      }
      return responder(await conta.resolver(ctx.admin, eu, c, s, 'pdv'))
    }

    case 'reabrir':
      return responder(await conta.reabrir(ctx.admin, eu, c, texto(corpo.motivo), 'pdv'))

    case 'cancelar_pedido': {
      const p = pedidoDaConta(corpo.pedidoId)
      if (!p) return NextResponse.json({ error: 'Pedido não pertence a esta conta.' }, { status: 404 })
      const motivo = texto(corpo.motivo, 200)
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo.', codigo: 'motivo_obrigatorio' }, { status: 400 })
      return responder(await conta.cancelarPedido(ctx.admin, eu, p.id, motivo, ctx.pode('pedidos.presencial.cancelar'), 'pdv'))
    }

    case 'solicitar_cancelamento': {
      const p = pedidoDaConta(corpo.pedidoId)
      const itemId = ehUuid(corpo.itemId) ? corpo.itemId : null
      if (!p || (itemId && !p.itens.some((i) => i.id === itemId))) {
        return NextResponse.json({ error: 'Item não pertence a esta conta.' }, { status: 404 })
      }
      const motivo = texto(corpo.motivo, 200)
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo.', codigo: 'motivo_obrigatorio' }, { status: 400 })
      return responder(await conta.solicitarCancelamento(ctx.admin, eu, p.id, itemId, motivo))
    }

    case 'decidir_cancelamento': {
      const solicitacaoId = texto(corpo.solicitacaoId, 36)
      if (!c.solicitacoes.some((s) => s.id === solicitacaoId)) {
        return NextResponse.json({ error: 'Pedido de cancelamento não pertence a esta conta.' }, { status: 404 })
      }
      if (typeof corpo.aprovar !== 'boolean') return NextResponse.json({ error: 'Informe se aprova ou recusa.' }, { status: 400 })
      return responder(await conta.decidirCancelamento(ctx.admin, eu, solicitacaoId, corpo.aprovar, texto(corpo.observacao) || null))
    }

    case 'cancelar_item': {
      const motivo = texto(corpo.motivo, 200)
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo.', codigo: 'motivo_obrigatorio' }, { status: 400 })
      return responder(await conta.cancelarItem(ctx.admin, eu, c, texto(corpo.itemId, 36), motivo, 'pdv'))
    }

    case 'reimprimir':
      return responder(await conta.reimprimir(ctx.admin, eu, c, texto(corpo.pedidoId, 36), 'pdv'))
  }
  return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
}
