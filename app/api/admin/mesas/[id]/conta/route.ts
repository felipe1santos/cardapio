import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, type Permissao } from '@/lib/auth/permissoes'
import { ehForma, formatarResumoPagamento } from '@/lib/conta'
import { registrarAuditoria } from '@/lib/auditoria'
import {
  buscarConta,
  cancelarItem,
  estornarPagamento,
  fecharConta,
  historicoDaConta,
  registrarPagamento,
  transferirItens,
  transferirMesa,
} from '@/lib/queries/conta'

/**
 * Conta da mesa: resumo (GET) e todas as operações (POST com `acao`).
 *
 * Uma rota com ação discriminada, e não dez arquivos, para a tabela de permissões ficar
 * num lugar só e ser lida de uma vez. O middleware já exige `mesas.operar` em
 * `/api/admin/mesas`; cada ação exige a SUA permissão por cima, conferida aqui.
 *
 * Loja, mesa e autor vêm da sessão e da URL — nunca do corpo. Valores e totais vêm das
 * funções do banco (0067), que travam a comanda enquanto mexem nela.
 */

const PERMISSAO_DA_ACAO: Record<string, Permissao> = {
  pagamento: 'comanda.fechar',
  estorno: 'comanda.desconto',
  ajustar_mesa: 'mesas.operar',
  ajustar_valores: 'comanda.desconto',
  fechar: 'comanda.fechar',
  transferir_mesa: 'comanda.transferir',
  transferir_itens: 'comanda.transferir',
  cancelar_item: 'pedidos.mesa.cancelar',
  cancelar_pedido: 'pedidos.mesa.cancelar',
  reimprimir: 'mesas.operar',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function contexto(mesaId: string) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'mesas.operar')) {
    return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) } as const
  }
  if (!UUID.test(mesaId)) return { erro: NextResponse.json({ error: 'Mesa inválida' }, { status: 400 }) } as const

  const admin = getAdminSupabase()
  const { data: mesa } = await admin
    .from('mesas')
    .select('id, nome')
    .eq('id', mesaId)
    .eq('restaurante_id', sessao.restauranteId)
    .maybeSingle()
  if (!mesa) return { erro: NextResponse.json({ error: 'Mesa não encontrada nesta loja' }, { status: 404 }) } as const
  return { sessao, admin, mesa: mesa as { id: string; nome: string } } as const
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await contexto(id)
  if ('erro' in ctx) return ctx.erro

  const conta = await buscarConta(ctx.admin, ctx.sessao.restauranteId, id)
  const { data: loja } = await ctx.admin
    .from('restaurantes')
    .select('formas_pagamento_mesa')
    .eq('id', ctx.sessao.restauranteId)
    .maybeSingle()

  return NextResponse.json({
    conta,
    historico: conta ? await historicoDaConta(ctx.admin, ctx.sessao.restauranteId, conta) : [],
    formasPagamento: (loja?.formas_pagamento_mesa as string[] | null) ?? ['dinheiro', 'pix', 'credito', 'debito'],
    // A tela esconde o que o papel não pode fazer; o POST confere de novo.
    permissoes: Object.fromEntries(Object.entries(PERMISSAO_DA_ACAO).map(([acao, p]) => [acao, pode(ctx.sessao.papel, p)])),
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
  if (!pode(sessao.papel, exigida)) return NextResponse.json({ error: 'Sem permissão para esta ação' }, { status: 403 })

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

  const falhou = (r: { erro: string; codigo: string }) =>
    NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.codigo === 'destino_ocupado' ? 409 : 400 })

  switch (acao) {
    case 'pagamento': {
      const forma = corpo.forma
      const valor = Number(corpo.valor)
      const recebido = corpo.recebido === null || corpo.recebido === undefined || corpo.recebido === '' ? null : Number(corpo.recebido)
      const chave = typeof corpo.chave === 'string' ? corpo.chave : ''
      if (!ehForma(forma)) return NextResponse.json({ error: 'Forma de pagamento inválida.' }, { status: 400 })
      // A loja escolhe o que aceita na mesa; esconder o botão na tela não basta.
      const { data: loja } = await admin.from('restaurantes').select('formas_pagamento_mesa').eq('id', sessao.restauranteId).maybeSingle()
      const aceitas = (loja?.formas_pagamento_mesa as string[] | null) ?? ['dinheiro', 'pix', 'credito', 'debito']
      if (!aceitas.includes(forma)) return NextResponse.json({ error: 'A loja não aceita esta forma de pagamento na mesa.' }, { status: 400 })
      if (!UUID.test(chave)) return NextResponse.json({ error: 'Chave do pagamento ausente.' }, { status: 400 })
      if (!Number.isFinite(valor) || valor <= 0) return NextResponse.json({ error: 'Informe um valor maior que zero.' }, { status: 400 })
      if (recebido !== null && !Number.isFinite(recebido)) return NextResponse.json({ error: 'Valor recebido inválido.' }, { status: 400 })

      const r = await registrarPagamento(admin, {
        restauranteId: sessao.restauranteId, comandaId: conta!.comandaId, forma, valor, recebido, chave,
        atorId: sessao.userId, atorNome: sessao.nome,
      })
      if (!r.ok) return falhou(r)
      if (!r.valor.idempotente) {
        await auditar('conta.pagamento', conta!.comandaId, { resumo: formatarResumoPagamento(forma, valor, r.valor.troco ?? 0) })
      }
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'estorno': {
      const pagamentoId = typeof corpo.pagamentoId === 'string' ? corpo.pagamentoId : ''
      const motivo = typeof corpo.motivo === 'string' ? corpo.motivo.trim().slice(0, 200) : ''
      if (!UUID.test(pagamentoId)) return NextResponse.json({ error: 'Pagamento inválido.' }, { status: 400 })
      // O pagamento tem que ser DESTA conta — id de outra mesa não serve.
      if (!conta!.pagamentos.some((p) => p.id === pagamentoId)) {
        return NextResponse.json({ error: 'Pagamento não pertence a esta conta.' }, { status: 404 })
      }
      const r = await estornarPagamento(admin, { restauranteId: sessao.restauranteId, pagamentoId, motivo, atorNome: sessao.nome })
      if (!r.ok) return falhou(r)
      await auditar('conta.estorno', conta!.comandaId, { resumo: motivo })
      return NextResponse.json({ ok: true })
    }

    case 'ajustar_mesa': {
      const patch: Record<string, unknown> = {}
      if (corpo.pessoas !== undefined) {
        const p = corpo.pessoas === null || corpo.pessoas === '' ? null : Math.floor(Number(corpo.pessoas))
        if (p !== null && (!Number.isFinite(p) || p < 1 || p > 99)) {
          return NextResponse.json({ error: 'Número de pessoas inválido.' }, { status: 400 })
        }
        patch.pessoas = p
      }
      if (typeof corpo.observacoes === 'string') patch.observacoes = corpo.observacoes.trim().slice(0, 300) || null
      if (corpo.assumir === true) {
        patch.responsavel_id = sessao.userId
        patch.responsavel_nome = sessao.nome
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })
      const { error } = await admin.from('comandas').update(patch).eq('id', conta!.comandaId).eq('status', 'aberta')
      if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
      await auditar('conta.ajustou', conta!.comandaId, { resumo: Object.keys(patch).join(', ') })
      return NextResponse.json({ ok: true })
    }

    case 'ajustar_valores': {
      const patch: Record<string, unknown> = {}
      if (corpo.taxaServico !== undefined) {
        const t = Number(corpo.taxaServico)
        if (!Number.isFinite(t) || t < 0 || t > 30) return NextResponse.json({ error: 'Taxa de serviço entre 0% e 30%.' }, { status: 400 })
        patch.taxa_servico_percentual = Math.round(t * 100) / 100
      }
      if (corpo.desconto !== undefined) {
        const d = Number(corpo.desconto)
        if (!Number.isFinite(d) || d < 0) return NextResponse.json({ error: 'Desconto inválido.' }, { status: 400 })
        const motivo = typeof corpo.descontoMotivo === 'string' ? corpo.descontoMotivo.trim().slice(0, 200) : ''
        if (d > 0 && !motivo) return NextResponse.json({ error: 'Informe o motivo do desconto.' }, { status: 400 })
        patch.desconto_valor = Math.round(d * 100) / 100
        patch.desconto_motivo = d > 0 ? motivo : null
      }
      if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })
      const { error } = await admin.from('comandas').update(patch).eq('id', conta!.comandaId).eq('status', 'aberta')
      if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
      await auditar('conta.ajustou', conta!.comandaId, {
        resumo: [
          patch.taxa_servico_percentual !== undefined ? `taxa ${patch.taxa_servico_percentual}%` : null,
          patch.desconto_valor !== undefined ? `desconto R$ ${patch.desconto_valor}` : null,
        ].filter(Boolean).join(' · '),
      })
      return NextResponse.json({ ok: true })
    }

    case 'fechar': {
      const r = await fecharConta(admin, { restauranteId: sessao.restauranteId, comandaId: conta!.comandaId, atorId: sessao.userId, atorNome: sessao.nome })
      if (!r.ok) return falhou(r)
      await auditar('conta.fechou', conta!.comandaId, { resumo: `total R$ ${r.valor.total}` })
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'transferir_mesa': {
      const destino = typeof corpo.destinoMesaId === 'string' ? corpo.destinoMesaId : ''
      if (!UUID.test(destino)) return NextResponse.json({ error: 'Mesa de destino inválida.' }, { status: 400 })
      const r = await transferirMesa(admin, {
        restauranteId: sessao.restauranteId, origemMesaId: id, destinoMesaId: destino, mesclar: corpo.mesclar === true,
        atorId: sessao.userId, atorNome: sessao.nome,
      })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'transferir_itens': {
      const destino = typeof corpo.destinoMesaId === 'string' ? corpo.destinoMesaId : ''
      const itemIds = Array.isArray(corpo.itemIds) ? (corpo.itemIds as unknown[]).filter((x): x is string => typeof x === 'string' && UUID.test(x)) : []
      if (!UUID.test(destino)) return NextResponse.json({ error: 'Mesa de destino inválida.' }, { status: 400 })
      if (itemIds.length === 0) return NextResponse.json({ error: 'Selecione pelo menos um item.' }, { status: 400 })
      // Só itens da conta DESTA mesa: id de item de outra mesa não é transferido daqui.
      const daConta = new Set(conta?.lancamentos.flatMap((l) => l.itens.map((i) => i.id)) ?? [])
      if (!itemIds.every((i) => daConta.has(i))) {
        return NextResponse.json({ error: 'Há itens que não pertencem a esta mesa.' }, { status: 400 })
      }
      const r = await transferirItens(admin, { restauranteId: sessao.restauranteId, itemIds, destinoMesaId: destino, atorId: sessao.userId, atorNome: sessao.nome })
      if (!r.ok) return falhou(r)
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'cancelar_item': {
      const itemId = typeof corpo.itemId === 'string' ? corpo.itemId : ''
      const motivo = typeof corpo.motivo === 'string' ? corpo.motivo.trim().slice(0, 200) : ''
      if (!conta!.lancamentos.some((l) => l.itens.some((i) => i.id === itemId))) {
        return NextResponse.json({ error: 'Item não pertence a esta conta.' }, { status: 404 })
      }
      const r = await cancelarItem(admin, { restauranteId: sessao.restauranteId, itemId, motivo, atorNome: sessao.nome })
      if (!r.ok) return falhou(r)
      const item = conta!.lancamentos.flatMap((l) => l.itens).find((i) => i.id === itemId)
      await auditar('conta.cancelou_item', conta!.comandaId, { resumo: `${item?.quantidade}× ${item?.nome} — ${motivo}` })
      return NextResponse.json({ ok: true, ...r.valor })
    }

    case 'cancelar_pedido': {
      const pedidoId = typeof corpo.pedidoId === 'string' ? corpo.pedidoId : ''
      const motivo = typeof corpo.motivo === 'string' ? corpo.motivo.trim().slice(0, 200) : ''
      if (!motivo) return NextResponse.json({ error: 'Informe o motivo.' }, { status: 400 })
      const lanc = conta!.lancamentos.find((l) => l.id === pedidoId)
      if (!lanc) return NextResponse.json({ error: 'Lançamento não pertence a esta conta.' }, { status: 404 })
      // Mesma gravação do cancelamento do Kanban: status + motivo, nada apagado, e
      // `reimprimir = false` para uma reimpressão pendente não sair depois de cancelado.
      const { data, error } = await admin
        .from('pedidos')
        .update({
          status: 'cancelado', cancelado_motivo: 'outro', cancelado_observacao: motivo,
          cancelado_por: sessao.nome, cancelado_em: new Date().toISOString(), reimprimir: false,
        })
        .eq('id', pedidoId)
        .eq('restaurante_id', sessao.restauranteId)
        .not('status', 'in', '(entregue,cancelado)')
        .select('id')
      if (error) return NextResponse.json({ error: 'Erro ao cancelar.' }, { status: 500 })
      if (!data?.length) return NextResponse.json({ error: 'Lançamento já cancelado.' }, { status: 409 })
      await auditar('conta.cancelou_pedido', conta!.comandaId, { resumo: `#${lanc.numero} — ${motivo}` })
      return NextResponse.json({ ok: true })
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

