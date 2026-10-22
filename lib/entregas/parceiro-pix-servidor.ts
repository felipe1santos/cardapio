import type { SupabaseClient } from '@supabase/supabase-js'
import { criarAlerta } from '@/lib/financeiro/alertas'
import { registrarAuditoria } from '@/lib/auditoria'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { enviarWhatsapp, formatarTelefoneWhatsapp } from '@/lib/whatsapp'
import { cancelarCobrancaPendente, criarCobrancaParceiro } from '@/lib/pagamentos/pix-online'
import { chamarLalamove, cotarPedido, EntregaError } from './lalamove-servidor'
import { chamarProvedor, cotarProvedor, NOME_PROVEDOR, type ProvedorNovo } from './provedores'
import type { ProvedorEntrega } from './queries'
import { pedidoDeApp } from '@/lib/pedido-editavel'
import { lerParceiroPix, NAO_RECEBE_NA_ENTREGA, PIX_PARCEIRO_PRAZO_MIN, precoMudouDemais, textoPixParceiro, type ParceiroPix } from './parceiro-pix'

/**
 * Pix antes do parceiro que não recebe na entrega (21/10/2026) — o lado do servidor. Regras puras em parceiro-pix.ts.
 * Fluxo: o dono toca "Cobrar por Pix e chamar" no card → Pix do TOTAL pelo WhatsApp → pago (webhook do MP) → o pedido
 * vira Pix online e o parceiro é chamado sozinho com uma cotação nova (se ficou >20% mais cara, o dono confirma).
 * 10 min sem pagar → alarme no painel; a loja escolhe motoboy próprio (o Pix é cancelado) ou cobra de novo.
 */
const SISTEMA = { id: null, nome: 'Sistema (Pix pago)' }
const nome = (p: string) => NOME_PROVEDOR[p as ProvedorEntrega] ?? p

async function gravar(admin: SupabaseClient, pedidoId: string, pp: ParceiroPix | null): Promise<void> {
  await admin.from('pedidos').update({ parceiro_pix: pp }).eq('id', pedidoId)
}

export async function iniciarPixParceiro(admin: SupabaseClient, restauranteId: string, provedor: string, pedidoId: string, preco: number, por: { id: string | null; nome: string }): Promise<void> {
  if (!NAO_RECEBE_NA_ENTREGA.has(provedor)) throw new EntregaError('Este parceiro recebe na entrega: chame direto.', 400)
  const { data: ped } = await admin.from('pedidos').select('id, numero, status, pago, tipo, cliente_telefone, restaurante_id, origem_canal').eq('id', pedidoId).eq('restaurante_id', restauranteId).maybeSingle()
  if (!ped) throw new EntregaError('Pedido não encontrado.', 404)
  // Pedido de app (iFood, 99Food, Keeta…): o pagamento é do app; a loja não cobra Pix por fora (22/10).
  if (pedidoDeApp(ped.origem_canal)) throw new EntregaError('Pedido de app com pagamento na entrega: entregue com motoboy próprio.', 409)
  if (ped.status !== 'pronto' || ped.tipo !== 'entrega') throw new EntregaError(`O pedido #${ped.numero} não está pronto para entrega.`, 409)
  if (ped.pago) throw new EntregaError('Este pedido já está pago: chame o entregador direto.', 409)
  let cob
  try { cob = await criarCobrancaParceiro(admin, { restauranteId, pedidoId, provedor }) } catch (e) {
    const m = (e as Error).message
    throw new EntregaError(m === 'pix_online_desligado' ? 'Conecte o Pix online (Mercado Pago) em Integrações para cobrar por Pix.' : m === 'pedido_ja_pago' ? 'O pedido já foi pago.' : 'Não foi possível gerar o Pix. Tente de novo.', 409)
  }
  const { data: loja } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).maybeSingle()
  const numero = formatarTelefoneWhatsapp(String(ped.cliente_telefone ?? ''))
  let enviado = false
  if (numero && loja?.evolution_instance && cob.qrCode) {
    enviado = await enviarWhatsapp(numero, textoPixParceiro({ numero: ped.numero, valor: cob.valor }), loja.evolution_instance, { admin, origem: 'automatico', restauranteId })
    if (enviado) await enviarWhatsapp(numero, cob.qrCode, loja.evolution_instance, { admin, origem: 'automatico', restauranteId })
  }
  await gravar(admin, pedidoId, { provedor, estado: 'aguardando', preco, desde: new Date().toISOString() })
  await registrarAuditoria(admin, { restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: 'entregas.pix_parceiro_enviado', entidade: 'pedido', entidadeId: pedidoId, dados: { provedor, valor: cob.valor, whatsapp: enviado } }).catch(() => null)
  if (!enviado) throw new EntregaError(`Pix gerado, mas o WhatsApp não saiu (WhatsApp da loja desconectado?). Mande o código ao cliente: ${cob.qrCode ?? ''}`.slice(0, 400), 207)
}

/** A loja desistiu do parceiro: cancela o Pix e libera o pedido para o motoboy próprio. */
export async function usarMotoboyProprio(admin: SupabaseClient, restauranteId: string, pedidoId: string, por: { id: string | null; nome: string }): Promise<void> {
  const r = await cancelarCobrancaPendente(admin, restauranteId, pedidoId)
  if (r === 'paga') throw new EntregaError('O cliente acabou de pagar o Pix: o pedido já está pago.', 409)
  await gravar(admin, pedidoId, null)
  await registrarAuditoria(admin, { restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: 'entregas.pix_parceiro_motoboy_proprio', entidade: 'pedido', entidadeId: pedidoId, dados: { cobranca: r } }).catch(() => null)
}

async function cotarEChamar(admin: SupabaseClient, restauranteId: string, provedor: string, pedidoId: string, referencia: number | null, por: { id: string | null; nome: string }): Promise<{ chamou: true } | { chamou: false; precoNovo: number }> {
  if (provedor === 'lalamove') {
    const cot = await cotarPedido(admin, restauranteId, pedidoId)
    if (referencia !== null && precoMudouDemais(referencia, cot.preco)) return { chamou: false, precoNovo: cot.preco }
    await chamarLalamove(admin, restauranteId, pedidoId, cot, por)
  } else {
    const cot = await cotarProvedor(admin, restauranteId, provedor as ProvedorNovo, pedidoId)
    if (referencia !== null && precoMudouDemais(referencia, cot.preco)) return { chamou: false, precoNovo: cot.preco }
    await chamarProvedor(admin, restauranteId, provedor as ProvedorNovo, pedidoId, cot, por)
  }
  return { chamou: true }
}

/** Chamado pela conferência do Pix (pedido acabou de virar pago): chama o parceiro com a cotação mais recente. */
export async function aposPixParceiroPago(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<void> {
  const { data: ped } = await admin.from('pedidos').select('numero, parceiro_pix, tipo').eq('id', pedidoId).maybeSingle()
  const pp = lerParceiroPix(ped?.parceiro_pix)
  if (!ped || !pp) return
  try {
    const r = await cotarEChamar(admin, restauranteId, pp.provedor, pedidoId, pp.preco, SISTEMA)
    if (r.chamou) { await gravar(admin, pedidoId, null); return }
    await gravar(admin, pedidoId, { ...pp, estado: 'confirmar_preco', precoNovo: r.precoNovo })
    await criarAlerta(admin, { restauranteId, tipo: 'pix_parceiro_preco', gravidade: 'atencao', mensagem: `Pedido #${ped.numero}: o cliente pagou o Pix, mas a corrida ${nome(pp.provedor)} subiu de R$ ${pp.preco.toFixed(2)} para R$ ${r.precoNovo.toFixed(2)}. Confirme no card.`, dados: { pedido: pedidoId, chave: pedidoId }, dedupeMin: 30, dedupeChave: pedidoId })
  } catch (e) {
    await gravar(admin, pedidoId, { ...pp, estado: 'erro', erro: ((e as Error).message ?? 'falhou').slice(0, 160) })
    await criarAlerta(admin, { restauranteId, tipo: 'pix_parceiro_erro', gravidade: 'grave', mensagem: `Pedido #${ped.numero}: Pix pago, mas ${nome(pp.provedor)} não foi chamada (${(e as Error).message}). Chame de novo ou use o motoboy próprio.`, dados: { pedido: pedidoId, chave: pedidoId }, dedupeMin: 30, dedupeChave: pedidoId })
  }
  avisarPainelPedidoNovo(admin, restauranteId, { id: pedidoId, numero: ped.numero, canal: ped.tipo }, undefined, { title: `Pedido #${ped.numero}: Pix pago`, body: 'Confira o entregador parceiro no card.' }).catch(() => null)
}

/** O dono confirma (preço mudou) ou tenta de novo (erro): cota e chama sem o limite de preço. */
export async function confirmarParceiroPix(admin: SupabaseClient, restauranteId: string, pedidoId: string, por: { id: string | null; nome: string }): Promise<void> {
  const { data: ped } = await admin.from('pedidos').select('parceiro_pix, pago').eq('id', pedidoId).eq('restaurante_id', restauranteId).maybeSingle()
  const pp = lerParceiroPix(ped?.parceiro_pix)
  if (!pp) throw new EntregaError('Nada para confirmar neste pedido.', 409)
  if (!ped?.pago) throw new EntregaError('O Pix ainda não foi pago.', 409)
  await cotarEChamar(admin, restauranteId, pp.provedor, pedidoId, null, por)
  await gravar(admin, pedidoId, null)
}

/** Cron de 1 min: Pix do parceiro sem pagamento há 10 min → alarme no painel (a loja decide). */
export async function vencerPixParceiros(admin: SupabaseClient): Promise<number> {
  const limite = new Date(Date.now() - PIX_PARCEIRO_PRAZO_MIN * 60_000).toISOString()
  const { data } = await admin.from('pedidos').select('id, numero, tipo, restaurante_id, parceiro_pix').eq('parceiro_pix->>estado', 'aguardando').lt('parceiro_pix->>desde', limite).eq('pago', false).limit(50)
  let n = 0
  for (const ped of data ?? []) {
    const pp = lerParceiroPix(ped.parceiro_pix)
    if (!pp) continue
    await gravar(admin, ped.id, { ...pp, estado: 'vencido' })
    await criarAlerta(admin, { restauranteId: ped.restaurante_id, tipo: 'pix_parceiro_vencido', gravidade: 'grave', mensagem: `Cliente não pagou o Pix do pedido #${ped.numero} em ${PIX_PARCEIRO_PRAZO_MIN} min — entregar com motoboy próprio?`, dados: { pedido: ped.id, chave: ped.id }, dedupeMin: 60, dedupeChave: ped.id })
    avisarPainelPedidoNovo(admin, ped.restaurante_id, { id: ped.id, numero: ped.numero, canal: ped.tipo }, undefined, { title: `⚠️ Pedido #${ped.numero}: Pix não pago`, body: 'Entregar com motoboy próprio? Decida no card.' }).catch(() => null)
    n++
  }
  return n
}
