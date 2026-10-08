import type { SupabaseClient } from '@supabase/supabase-js'
import { despacharAutomaticamente } from '@/lib/motoboy/despacho-automatico'
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
import { registrarAuditoria } from '@/lib/auditoria'
import { lerEntradaDoQr } from '@/lib/motoboy/qr-rota'
import { enderecoCompletoPedido } from '@/lib/queries/pedidos'

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
    ? ((await admin.from('pedidos').select('id, saiu_para_entrega_em, entrega_latitude, entrega_longitude').in('id', pedidos.map((p) => p.id))).data ?? [])
    : []
  const saiuEm = new Map(saiu.map((s) => [s.id as string, s as { saiu_para_entrega_em: string | null; entrega_latitude: number | null; entrega_longitude: number | null }]))
  // Item 59 (tela inicial nova): logo da loja, foto e situação do motoboy.
  const [{ data: rest }, { data: ent }] = await Promise.all([
    admin.from('restaurantes').select('logo_url').eq('id', e.restauranteId).maybeSingle(),
    admin.from('entregadores').select('foto_url, status').eq('id', e.id).maybeSingle(),
  ])
  return {
    entregador: {
      nome: e.nome, restauranteNome: e.restauranteNome,
      logoUrl: ((rest as { logo_url?: string | null } | null)?.logo_url) ?? null,
      fotoUrl: ((ent as { foto_url?: string | null } | null)?.foto_url) ?? null,
      status: ((ent as { status?: string } | null)?.status) ?? 'online',
    },
    loja,
    pedidos: pedidos.map((p) => {
      const s = saiuEm.get(p.id)
      const lat = s?.entrega_latitude === null || s?.entrega_latitude === undefined ? null : Number(s.entrega_latitude)
      const lng = s?.entrega_longitude === null || s?.entrega_longitude === undefined ? null : Number(s.entrega_longitude)
      return { ...p, saiuParaEntregaEm: s?.saiu_para_entrega_em ?? null, coordenadas: lat !== null && lng !== null ? { lat, lng } : null }
    }),
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
  // Item 61: com o despacho automático ligado, o sinal do motoboy também despacha o que ficou esperando.
  despacharAutomaticamente(admin, e.restauranteId).catch((err) => console.error('[despacho automático]', (err as Error).message))
  return { ok: true }
}

const nomeDoMotoboy = (e: EntregadorPortal) => `Motoboy ${e.nome}`.slice(0, 120)

/**
 * Item 59 — o motoboy leu o QR da comanda (ou digitou o número). Diz o que pode acontecer, sem
 * mudar nada: "pegar" (pronto, sem motoboy, despacho aberto), "seu" (já está na rota dele) ou
 * "bloqueado" com o motivo em português. Quem pega mesmo é a ação "pegar" de sempre.
 */
export async function lerQrDaEntrega(admin: SupabaseClient, e: EntregadorPortal, texto: unknown): Promise<Resultado> {
  const entrada = lerEntradaDoQr(texto)
  if (!entrada) return { ok: false, erro: 'Este QR não é de uma comanda de entrega da Menuzia.', status: 400, codigo: 'qr_invalido' }
  const sel = 'id, numero, restaurante_id, tipo, status, entregador_id, cliente_nome, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_referencia, total, entrega_latitude, entrega_longitude'
  const q = admin.from('pedidos').select(sel)
  const { data: p } = entrada.tipo === 'codigo'
    ? await q.eq('id', entrada.pedidoId).maybeSingle()
    // Número digitado: só na loja do motoboy (o número se repete entre lojas).
    : await q.eq('restaurante_id', e.restauranteId).eq('numero', entrada.numero).order('criado_em', { ascending: false }).limit(1).maybeSingle()
  if (!p) return { ok: false, erro: entrada.tipo === 'numero' ? `Pedido #${entrada.numero} não encontrado na sua loja.` : 'Pedido não encontrado.', status: 404, codigo: 'nao_encontrado' }
  const r = p as Record<string, unknown> & { id: string; numero: number; restaurante_id: string; tipo: string; status: string; entregador_id: string | null }
  const coordenadas = r.entrega_latitude !== null && r.entrega_longitude !== null ? { lat: Number(r.entrega_latitude), lng: Number(r.entrega_longitude) } : null
  const resumo = {
    id: r.id, numero: r.numero, cliente: (r.cliente_nome as string) || 'Cliente', bairro: (r.endereco_bairro as string) || '', coordenadas,
    endereco: enderecoCompletoPedido({ enderecoRua: (r.endereco_rua as string) ?? '', enderecoNumero: (r.endereco_numero as string) ?? '', enderecoComplemento: (r.endereco_complemento as string) ?? '', enderecoBairro: (r.endereco_bairro as string) ?? '', enderecoCidade: (r.endereco_cidade as string) ?? '' } as never),
    total: Number(r.total),
  }
  const bloqueio = (codigo: string, erro: string) => ({ ok: true as const, dados: { situacao: 'bloqueado', codigo, motivo: erro, pedido: { numero: r.numero } } })
  if (r.restaurante_id !== e.restauranteId) return bloqueio('outra_loja', 'Este pedido é de outra loja.')
  if (r.entregador_id === e.id && r.status === 'em_rota') return { ok: true, dados: { situacao: 'seu', pedido: resumo } }
  if (r.tipo !== 'entrega') return bloqueio('nao_entrega', `O pedido #${r.numero} não é de entrega.`)
  if (r.status === 'cancelado') return bloqueio('cancelado', `O pedido #${r.numero} foi cancelado.`)
  if (r.status === 'entregue') return bloqueio('entregue', `O pedido #${r.numero} já foi entregue.`)
  if (r.status === 'recebido' || r.status === 'preparando') return bloqueio('em_preparo', `O pedido #${r.numero} ainda está em preparo. Espere a cozinha marcar como pronto.`)
  if (r.status === 'aguardando_pagamento') return bloqueio('aguardando_pagamento', `O pedido #${r.numero} ainda espera o pagamento.`)
  if (r.entregador_id && r.entregador_id !== e.id) return bloqueio('outro_motoboy', `O pedido #${r.numero} já está com outro motoboy.`)
  if (r.status !== 'pronto') return bloqueio('indisponivel', `O pedido #${r.numero} não está disponível para entrega.`)
  const { data: ent } = await admin.from('entregadores').select('status').eq('id', e.id).maybeSingle()
  if ((ent as { status?: string } | null)?.status === 'offline') return bloqueio('pausado', 'Você está como Offline (pausado) na loja. Peça ao operador para te colocar como Disponível.')
  // Item 61: pegar pelo QR da comanda não depende mais do "despacho aberto" (que saiu do Kanban).
  return { ok: true, dados: { situacao: 'pegar', pedido: resumo } }
}

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
      // Item 61: pelo QR da comanda sempre pode (pronto e sem motoboy); pela lista, só com o despacho aberto.
      if (corpo?.via !== 'qr' && !(await buscarDespachoAberto(admin, e.restauranteId))) return { ok: false, erro: 'O despacho não está aberto no momento.', status: 403 }
      const { data: ent } = await admin.from('entregadores').select('status').eq('id', e.id).maybeSingle()
      if ((ent as { status?: string } | null)?.status === 'offline') return { ok: false, erro: 'Você está como Offline (pausado) na loja. Peça ao operador para te colocar como Disponível.', status: 403, codigo: 'pausado' }
      await pegarPedidoDisponivel(admin, pedidoId, e.id, e.restauranteId)
      notificarPedido(admin, pedidoId, 'em_rota').catch((err) => console.error('[whatsapp] em rota', err))
      // Item 59: quem pegou (pela lista ou pelo QR da comanda) fica na auditoria.
      registrarAuditoria(admin, {
        restauranteId: e.restauranteId, usuarioId: e.usuarioId ?? undefined, usuarioNome: nomeDoMotoboy(e),
        acao: 'pedido.motoboy_pegou', entidade: 'pedido', entidadeId: pedidoId, dados: { entregador_id: e.id, via: corpo?.via === 'qr' ? 'qr' : 'lista' },
      }).catch((err) => console.error('[auditoria] motoboy pegou', err))
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
