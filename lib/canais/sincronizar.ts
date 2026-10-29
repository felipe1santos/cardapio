import type { SupabaseClient } from '@supabase/supabase-js'
import { listarCanaisAtivos, registrarPolling, type ConfigCanal } from './config'
import { cancelarPeloApp, importarPedidoExterno } from './importar'
import { CANAL_DISPONIVEL, etapasAEnviar, statusParaApp, type Canal, type StatusParaApp } from './tipos'
import { acknowledgmentOd, detalheDoPedidoOd, enviarStatusOd, pollingOd, type EventoOd } from './opendelivery/cliente'
import { mapearPedidoOpenDelivery } from './opendelivery/mapear'
import { acknowledgmentIfood, detalheDoPedidoIfood, enviarStatusIfood, EVENTO_IFOOD, pollingIfood, type EventoIfood } from './ifood/cliente'
import { mapearPedidoIfood } from './ifood/mapear'
import { app99, detalheDoPedido99, enviarStatus99 } from './noventaenove/cliente'
import { mapearPedido99 } from './noventaenove/mapear'
import { buscarCorridaPorExterno } from '@/lib/entregas/queries'
import { aplicarEventoCorrida, statusDeEventoIfood } from '@/lib/entregas/provedores'
import { esperaEnvioCanal, MAX_TENTATIVAS_CANAL } from '@/lib/espera-tentativas'

/**
 * O que o cron `/api/cron/canais` faz a cada minuto, por loja com canal ligado E módulo liberado:
 *   1. polling de eventos no app (Keeta/99Food via Open Delivery; iFood) → pedido novo importado; cancelamento aplicado;
 *      todo evento é confirmado (acknowledgment) e lembrado em canal_eventos (reentrega não repete nada);
 *   2. sincronização de status: o que a loja moveu no Kanban (preparando/pronto/em rota/entregue/cancelado) vai ao app
 *      na ordem certa (confirm → preparing → readyForPickup → dispatch → delivered), uma etapa por vez, sem voltar.
 * O webhook do Open Delivery (newEvent) chama `tratarEventoOd` direto — o polling é a rede de segurança.
 */
/** 20/10: canal roda se estiver liberado (CANAL_DISPONIVEL), ligado na loja e com credenciais — sem módulo pago. */
export const canalPodeRodar = (canal: Canal) => CANAL_DISPONIVEL[canal] === true

export interface ResumoSincronizacao { lojas: number; eventos: number; pedidosNovos: number; cancelados: number; statusEnviados: number; erros: string[] }

async function eventoJaTratado(admin: SupabaseClient, canal: Canal, eventoId: string): Promise<boolean> {
  const { data } = await admin.from('canal_eventos').select('evento_id').eq('canal', canal).eq('evento_id', eventoId).maybeSingle()
  return !!data
}
async function lembrarEvento(admin: SupabaseClient, c: ConfigCanal, eventoId: string, tipo: string, externoId: string | null) {
  await admin.from('canal_eventos').upsert({ restaurante_id: c.restauranteId, canal: c.canal, evento_id: eventoId, tipo, externo_id: externoId }, { onConflict: 'canal,evento_id', ignoreDuplicates: true })
}

/** Um evento do Open Delivery (polling ou webhook). Devolve o que aconteceu. */
export async function tratarEventoOd(admin: SupabaseClient, c: ConfigCanal, e: EventoOd): Promise<'pedido_novo' | 'cancelado' | 'ignorado' | 'repetido'> {
  if (await eventoJaTratado(admin, c.canal, e.eventId)) return 'repetido'
  let resultado: 'pedido_novo' | 'cancelado' | 'ignorado' = 'ignorado'
  if (e.eventType === 'CREATED') {
    const bruto = await detalheDoPedidoOd(admin, c, e.orderId, e.orderURL)
    const r = await importarPedidoExterno(admin, c.restauranteId, mapearPedidoOpenDelivery(c.canal, bruto))
    resultado = r.novo ? 'pedido_novo' : 'ignorado'
  } else if (e.eventType === 'CANCELLED' || e.eventType === 'CANCELLATION_REQUESTED' || e.eventType === 'ORDER_CANCELLATION_REQUEST') {
    // Pedido do app cancelado pelo cliente/app: cai aqui também; a loja vê "Cancelado no app" no Kanban.
    resultado = (await cancelarPeloApp(admin, c.restauranteId, c.canal, e.orderId, e.eventType)) ? 'cancelado' : 'ignorado'
  } else {
    await admin.from('pedidos_externos').update({ status_externo: e.eventType, atualizado_em: new Date().toISOString() }).eq('canal', c.canal).eq('externo_id', e.orderId)
  }
  await lembrarEvento(admin, c, e.eventId, e.eventType, e.orderId)
  return resultado
}

/** Um aviso da 99Food (protocolo próprio, só webhook — 22/10). `orderNew` traz o pedido completo em order_info. */
export async function tratarEvento99(admin: SupabaseClient, c: ConfigCanal, tipo: string, orderId: string, dados: Record<string, unknown>): Promise<'pedido_novo' | 'cancelado' | 'ignorado' | 'repetido'> {
  // orderCancelApply/orderRefundApply repetem o mesmo aviso (lembrete): uma vez por tipo+pedido basta.
  const eventoId = `${tipo}:${orderId}`
  if (await eventoJaTratado(admin, c.canal, eventoId)) return 'repetido'
  let resultado: 'pedido_novo' | 'cancelado' | 'ignorado' = 'ignorado'
  if (tipo === 'orderNew') {
    const info = (dados.order_info && typeof dados.order_info === 'object' ? dados.order_info : null) ?? await detalheDoPedido99(admin, c, orderId)
    const r = await importarPedidoExterno(admin, c.restauranteId, mapearPedido99(info))
    resultado = r.novo ? 'pedido_novo' : 'ignorado'
    // Id do estabelecimento na 99Food (para suporte/monitoramento), na 1ª vez.
    const shopId = String(((info as Record<string, unknown>).shop as Record<string, unknown> | undefined)?.shop_id ?? '')
    if (shopId && !c.merchantIdExterno) await admin.from('canais_config').update({ merchant_id_externo: shopId.slice(0, 120) }).eq('restaurante_id', c.restauranteId).eq('canal', c.canal)
    if (r.novo) await registrarPolling(admin, c, null, true)
  } else if (tipo === 'orderCancel') {
    resultado = (await cancelarPeloApp(admin, c.restauranteId, c.canal, orderId, 'orderCancel')) ? 'cancelado' : 'ignorado'
  } else {
    // orderConfirm/orderReady/orderFinish/deliveryStatus/orderCancelApply/orderRefundApply/orderPartialCancel: registro.
    await admin.from('pedidos_externos').update({ status_externo: tipo, atualizado_em: new Date().toISOString() }).eq('canal', c.canal).eq('externo_id', orderId)
  }
  await lembrarEvento(admin, c, eventoId, tipo, orderId)
  return resultado
}

async function tratarEventoIfood(admin: SupabaseClient, c: ConfigCanal, e: EventoIfood): Promise<'pedido_novo' | 'cancelado' | 'ignorado' | 'repetido'> {
  if (await eventoJaTratado(admin, c.canal, e.id)) return 'repetido'
  let resultado: 'pedido_novo' | 'cancelado' | 'ignorado' = 'ignorado'
  const code = (e.code || '').toUpperCase()
  if (code === EVENTO_IFOOD.PLACED) {
    const bruto = await detalheDoPedidoIfood(admin, c, e.orderId)
    const r = await importarPedidoExterno(admin, c.restauranteId, mapearPedidoIfood(bruto))
    resultado = r.novo ? 'pedido_novo' : 'ignorado'
  } else if (code === EVENTO_IFOOD.CANCELLED) {
    resultado = (await cancelarPeloApp(admin, c.restauranteId, 'ifood', e.orderId, e.fullCode ?? 'CANCELLED')) ? 'cancelado' : 'ignorado'
  } else {
    // Entregador iFood (Etapa 3): o pedido "de fora" que criamos no iFood manda eventos de entrega por aqui também.
    const corrida = await buscarCorridaPorExterno(admin, e.orderId, 'ifood').catch(() => null)
    if (corrida && corrida.restauranteId === c.restauranteId) {
      const novo = statusDeEventoIfood(e.fullCode ?? code)
      if (novo) {
        const md = (e.metadata ?? {}) as { driverName?: string; driverPhone?: string; vehiclePlate?: string; trackingUrl?: string }
        await aplicarEventoCorrida(admin, corrida, novo, { motorista: md.driverName ? { nome: md.driverName, telefone: md.driverPhone ?? null, placa: md.vehiclePlate ?? null } : null, shareLink: md.trackingUrl ?? null, evento: { code: e.fullCode ?? code, em: e.createdAt }, origem: 'polling' })
      }
    } else {
      await admin.from('pedidos_externos').update({ status_externo: e.fullCode ?? code, atualizado_em: new Date().toISOString() }).eq('canal', 'ifood').eq('externo_id', e.orderId)
    }
  }
  await lembrarEvento(admin, c, e.id, e.fullCode ?? code, e.orderId)
  return resultado
}

/** Polling de uma loja/canal: busca, trata e confirma os eventos. */
export async function pollingDaLoja(admin: SupabaseClient, c: ConfigCanal, resumo: ResumoSincronizacao): Promise<void> {
  let novo = false
  try {
    if (c.canal === 'ifood') {
      const eventos = await pollingIfood(admin, c)
      for (const e of eventos) {
        resumo.eventos++
        const r = await tratarEventoIfood(admin, c, e).catch((err) => { resumo.erros.push(`${c.canal}/${e.orderId}: ${(err as Error).message}`); return 'ignorado' as const })
        if (r === 'pedido_novo') { resumo.pedidosNovos++; novo = true }
        if (r === 'cancelado') resumo.cancelados++
      }
      if (eventos.length) await acknowledgmentIfood(admin, c, eventos)
    } else {
      const eventos = await pollingOd(admin, c)
      for (const e of eventos) {
        resumo.eventos++
        const r = await tratarEventoOd(admin, c, e).catch((err) => { resumo.erros.push(`${c.canal}/${e.orderId}: ${(err as Error).message}`); return 'ignorado' as const })
        if (r === 'pedido_novo') { resumo.pedidosNovos++; novo = true }
        if (r === 'cancelado') resumo.cancelados++
      }
      if (eventos.length) await acknowledgmentOd(admin, c, eventos)
    }
    await registrarPolling(admin, c, null, novo)
  } catch (err) {
    const m = (err as Error).message?.slice(0, 200) ?? 'erro'
    resumo.erros.push(`${c.canal}@${c.restauranteId.slice(0, 8)}: ${m}`)
    await registrarPolling(admin, c, m, novo)
  }
}

/** Status do Kanban → app, para os pedidos externos ainda abertos desta loja/canal. */
export async function sincronizarStatusDaLoja(admin: SupabaseClient, c: ConfigCanal, resumo: ResumoSincronizacao): Promise<void> {
  const desde = new Date(Date.now() - 12 * 3600_000).toISOString()
  const { data: exts } = await admin.from('pedidos_externos').select('id, externo_id, status_enviado, envio_tentativas, envio_proxima_em, pedidos!inner ( id, status, tipo, cancelado_observacao, cancelado_motivo, origem_detalhe )')
    .eq('restaurante_id', c.restauranteId).eq('canal', c.canal).gte('criado_em', desde).not('pedido_id', 'is', null).limit(200)
  const agora = Date.now()
  for (const ext of exts ?? []) {
    // Erro anterior (28/10, 0233): espera crescente e desiste depois de 8 erros (antes: todo minuto, sem limite).
    const tentativas = Number(ext.envio_tentativas) || 0
    if (tentativas >= MAX_TENTATIVAS_CANAL) continue
    if (ext.envio_proxima_em && Date.parse(ext.envio_proxima_em as string) > agora) continue
    const ped = (Array.isArray(ext.pedidos) ? ext.pedidos[0] : ext.pedidos) as { id: string; status: string; tipo: 'entrega' | 'retirada'; cancelado_observacao: string | null; cancelado_motivo: string | null; origem_detalhe: { entregaPor?: string } | null } | null
    if (!ped) continue
    const alvo = statusParaApp(ped.status, ped.tipo)
    if (!alvo) continue
    const jaEnviado = (ext.status_enviado as StatusParaApp | null) ?? null
    // Cancelado NO APP já veio marcado como enviado (cancelarPeloApp): não devolvemos o cancelamento ao app.
    const etapas = etapasAEnviar(jaEnviado, alvo)
    for (const etapa of etapas) {
      try {
        const r = c.canal === 'ifood'
          ? await enviarStatusIfood(admin, c, ext.externo_id as string, etapa, { motivoCancelamento: ped.cancelado_observacao ?? undefined })
          : c.canal === '99food'
            ? await enviarStatus99(admin, c, ext.externo_id as string, etapa, { entregaPelaLoja: ped.origem_detalhe?.entregaPor === 'loja', motivo: ped.cancelado_motivo, texto: ped.cancelado_observacao })
            : await enviarStatusOd(admin, c, ext.externo_id as string, etapa, { motivoCancelamento: ped.cancelado_observacao ?? undefined })
        await admin.from('pedidos_externos').update({ status_enviado: etapa, status_enviado_em: new Date().toISOString(), erro_envio: null, envio_tentativas: 0, envio_proxima_em: null, atualizado_em: new Date().toISOString() }).eq('id', ext.id)
        if (r === 'ok') resumo.statusEnviados++
      } catch (err) {
        const m = (err as Error).message?.slice(0, 200) ?? 'erro'
        const espera = esperaEnvioCanal(tentativas + 1)
        await admin.from('pedidos_externos').update({
          erro_envio: m, envio_tentativas: tentativas + 1, envio_proxima_em: espera ? new Date(agora + espera).toISOString() : null, atualizado_em: new Date().toISOString(),
        }).eq('id', ext.id)
        resumo.erros.push(`${c.canal}/${ext.externo_id} ${etapa}: ${m}`)
        break
      }
    }
  }
}

/** Entrada do cron: todas as lojas com canal ligado e módulo liberado. */
export async function sincronizarCanais(admin: SupabaseClient): Promise<ResumoSincronizacao> {
  const resumo: ResumoSincronizacao = { lojas: 0, eventos: 0, pedidosNovos: 0, cancelados: 0, statusEnviados: 0, erros: [] }
  const configs = await listarCanaisAtivos(admin)
  for (const c of configs) {
    if (!canalPodeRodar(c.canal)) continue
    // 99Food (22/10): app ÚNICO da Menuzia no servidor (sem credencial por loja) e pedido só por webhook (sem polling).
    if (c.canal === '99food') {
      if (!app99()) continue
      resumo.lojas++
      await sincronizarStatusDaLoja(admin, c, resumo)
      continue
    }
    if (!c.credenciais) continue
    resumo.lojas++
    await pollingDaLoja(admin, c, resumo)
    await sincronizarStatusDaLoja(admin, c, resumo)
  }
  return resumo
}
