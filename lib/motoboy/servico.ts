import type { SupabaseClient } from '@supabase/supabase-js'
import { buscarLojaNoMapa } from '@/lib/maps/loja-mapa'
import {
  buscarDespachoAberto, calcularCaixaEntregadorHoje, contarEntregasConcluidasHoje, listarPedidosDisponiveisDespacho,
  listarPedidosEmRotaDoEntregador, marcarEntregaComProblema, marcarEntregaConcluida, pegarPedidoDisponivel, registrarPresencaEntregador,
  type EntregadorPortal,
} from '@/lib/queries/pedidos'
import { inicioDoDiaSaoPaulo } from '@/lib/servicos/conta-presencial'
import { notificarPedido } from '@/lib/whatsapp'
import { processarFidelidadePedidoEntregue, reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'
import { mensagemDeErroConta } from '@/lib/conta'

/**
 * Motoboy (Fase 3, 0136): o MESMO serviço atende o link/QR antigo (token) e o app com login. Quem
 * é o motoboy vem sempre do servidor (token válido e ativo, ou a sessão ligada a `entregadores`);
 * o pedido só é dele se `entregador_id` bate. Com o financeiro ligado, "Entregue" exige dizer como
 * o cliente pagou — registro, livro-caixa e status numa transação (entrega_registrar), idempotente.
 */
export type Resultado = { ok: true; dados?: Record<string, unknown> } | { ok: false; erro: string; status: number; codigo?: string }

async function financeiroAtivo(admin: SupabaseClient, restauranteId: string) {
  try {
    const { data } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', restauranteId).maybeSingle()
    return !!(data as { financeiro_ativo?: boolean } | null)?.financeiro_ativo
  } catch {
    return false
  }
}

/** "Dinheiro comigo agora" = saldo da carteira do motoboy no livro-caixa; histórico de hoje. */
async function dinheiroComigo(admin: SupabaseClient, e: EntregadorPortal) {
  let saldo = 0
  const { data } = await admin.from('fin_lancamentos').select('valor_centavos').eq('restaurante_id', e.restauranteId).eq('carteira', 'motoboy').eq('entregador_id', e.id)
  for (const l of data ?? []) saldo += Number(l.valor_centavos)
  const { data: hist } = await admin.from('fin_entregas_pagamento')
    .select('pedido_id, forma, total_centavos, recebido_centavos, troco_dado_centavos, criado_em, pedidos ( numero )')
    .eq('entregador_id', e.id).gte('criado_em', inicioDoDiaSaoPaulo()).order('criado_em', { ascending: false }).limit(50)
  return {
    comigoCentavos: saldo,
    historico: (hist ?? []).map((h) => ({
      numero: (h.pedidos as unknown as { numero?: number } | null)?.numero ?? null, forma: h.forma, totalCentavos: Number(h.total_centavos),
      recebidoCentavos: h.recebido_centavos === null ? null : Number(h.recebido_centavos), trocoDadoCentavos: h.troco_dado_centavos === null ? null : Number(h.troco_dado_centavos),
      em: h.criado_em,
    })),
  }
}

export async function dadosDoPortal(admin: SupabaseClient, e: EntregadorPortal) {
  const inicio = inicioDoDiaSaoPaulo()
  const [pedidos, concluidosHoje, caixaHoje, despachoAberto, fin] = await Promise.all([
    listarPedidosEmRotaDoEntregador(admin, e.id),
    contarEntregasConcluidasHoje(admin, e.id, inicio),
    calcularCaixaEntregadorHoje(admin, e.id, inicio),
    buscarDespachoAberto(admin, e.restauranteId),
    financeiroAtivo(admin, e.restauranteId),
  ])
  // Onde a loja fica: o mapa da rota abre nela (antes: Fortaleza fixo até a rota chegar).
  const loja = await buscarLojaNoMapa(admin, e.restauranteId).catch(() => null)
  const disponiveis = despachoAberto ? await listarPedidosDisponiveisDespacho(admin, e.restauranteId) : []
  const saiu = pedidos.length
    ? ((await admin.from('pedidos').select('id, saiu_para_entrega_em').in('id', pedidos.map((p) => p.id))).data ?? [])
    : []
  const saiuEm = new Map(saiu.map((s) => [s.id as string, (s.saiu_para_entrega_em as string | null) ?? null]))
  return {
    entregador: { nome: e.nome, restauranteNome: e.restauranteNome },
    loja,
    pedidos: pedidos.map((p) => ({ ...p, saiuParaEntregaEm: saiuEm.get(p.id) ?? null })),
    disponiveis,
    despachoAberto,
    concluidosHoje,
    caixaHoje,
    financeiro: fin ? { ativo: true, ...(await dinheiroComigo(admin, e)) } : { ativo: false },
  }
}

export async function heartbeat(admin: SupabaseClient, e: EntregadorPortal, corpo: Record<string, unknown> | null): Promise<Resultado> {
  const lat = typeof corpo?.lat === 'number' ? corpo.lat : null
  const lng = typeof corpo?.lng === 'number' ? corpo.lng : null
  await registrarPresencaEntregador(admin, e.id, lat, lng)
  return { ok: true }
}

const nomeDoMotoboy = (e: EntregadorPortal) => `Motoboy ${e.nome}`.slice(0, 120)

export async function acaoNoPedido(admin: SupabaseClient, e: EntregadorPortal, pedidoId: string, acao: string, corpo: Record<string, unknown> | null): Promise<Resultado> {
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return { ok: false, erro: 'Pedido inválido.', status: 400 }
  try {
    if (acao === 'saiu') {
      const { data } = await admin.from('pedidos').update({ saiu_para_entrega_em: new Date().toISOString() })
        .eq('id', pedidoId).eq('entregador_id', e.id).eq('status', 'em_rota').is('saiu_para_entrega_em', null).select('id')
      if (!data?.length) {
        const { data: ja } = await admin.from('pedidos').select('id').eq('id', pedidoId).eq('entregador_id', e.id).not('saiu_para_entrega_em', 'is', null).maybeSingle()
        if (!ja) return { ok: false, erro: 'Pedido não encontrado na sua rota.', status: 404, codigo: 'pedido_de_outro' }
      }
      return { ok: true }
    }
    if (acao === 'pegar') {
      if (!(await buscarDespachoAberto(admin, e.restauranteId))) return { ok: false, erro: 'O despacho não está aberto no momento.', status: 403 }
      await pegarPedidoDisponivel(admin, pedidoId, e.id, e.restauranteId)
      notificarPedido(admin, pedidoId, 'em_rota').catch((err) => console.error('[whatsapp] em rota', err))
      return { ok: true }
    }
    if (acao === 'problema') {
      const motivo = typeof corpo?.motivo === 'string' ? corpo.motivo.trim().slice(0, 300) : ''
      if (await financeiroAtivo(admin, e.restauranteId) && motivo.length < 3) return { ok: false, erro: 'Diga o motivo.', status: 400, codigo: 'motivo_obrigatorio' }
      await marcarEntregaComProblema(admin, pedidoId, e.id, e.nome, motivo || undefined)
      reverterBeneficiosPedidoCancelado(admin, e.restauranteId, pedidoId).catch(console.error)
      await aplicarEfeitosStatusPedidoComTrava(admin, pedidoId, 'cancelado').catch(console.error)
      return { ok: true }
    }
    if (acao === 'entregar') {
      if (await financeiroAtivo(admin, e.restauranteId)) {
        const forma = typeof corpo?.forma === 'string' ? corpo.forma : ''
        if (!['dinheiro', 'cartao', 'pix', 'nao_pago'].includes(forma)) return { ok: false, erro: 'Diga como o cliente pagou.', status: 400, codigo: 'forma_obrigatoria' }
        const recebido = typeof corpo?.recebidoCentavos === 'number' && Number.isSafeInteger(corpo.recebidoCentavos) ? corpo.recebidoCentavos : null
        const chave = typeof corpo?.chave === 'string' && corpo.chave.length >= 8 ? corpo.chave.slice(0, 120) : `app:${pedidoId}`
        const { data, error } = await admin.rpc('entrega_registrar', {
          p_restaurante: e.restauranteId, p_pedido: pedidoId, p_entregador: e.id, p_forma: forma, p_recebido_centavos: recebido,
          p_nsu: typeof corpo?.nsu === 'string' ? corpo.nsu.slice(0, 40) : null, p_motivo: typeof corpo?.motivo === 'string' ? corpo.motivo.slice(0, 300) : null,
          p_chave: chave, p_ator: e.usuarioId ?? null, p_ator_nome: nomeDoMotoboy(e), p_origem: 'motoboy',
        })
        if (error) {
          const cod = (/([a-z_]+)/.exec(error.message)?.[1]) ?? ''
          const msg: Record<string, string> = {
            pedido_de_outro: 'Este pedido não é da sua rota.', pedido_nao_em_rota: 'Este pedido não está em rota.',
            motivo_obrigatorio: 'Diga o motivo de não ter recebido.', ja_registrado: 'Esta entrega já foi registrada.',
          }
          return { ok: false, erro: msg[cod] ?? mensagemDeErroConta(error.message), status: cod === 'pedido_de_outro' ? 403 : 409, codigo: cod }
        }
        const r = data as { idempotente?: boolean; forma?: string; troco_dado_centavos?: number | null }
        if (!r.idempotente) {
          notificarPedido(admin, pedidoId, 'entregue').catch((err) => console.error('[whatsapp] entregue', err))
          processarFidelidadePedidoEntregue(admin, e.restauranteId, pedidoId).catch((err) => console.error('[fidelidade]', err))
        }
        return { ok: true, dados: r }
      }
      await marcarEntregaConcluida(admin, pedidoId, e.id)
      notificarPedido(admin, pedidoId, 'entregue').catch((err) => console.error('[whatsapp] entregue', err))
      processarFidelidadePedidoEntregue(admin, e.restauranteId, pedidoId).catch((err) => console.error('[fidelidade]', err))
      return { ok: true }
    }
    return { ok: false, erro: 'Ação inválida.', status: 400 }
  } catch (err) {
    return { ok: false, erro: err instanceof Error ? err.message : 'Não foi possível concluir.', status: 400 }
  }
}
