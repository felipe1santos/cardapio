import type { SupabaseClient } from '@supabase/supabase-js'
import { comTokenDaLoja, contaPublica, tokenDaLoja, webhookUrlMp } from './contas'
import { ErroMp, mpConfigurado, provedorMp, type PagamentoMp } from './mercadopago'
import { lancar } from '@/lib/financeiro/ledger'
import { criarAlerta } from '@/lib/financeiro/alertas'
import { registrarAuditoria } from '@/lib/auditoria'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { enviarWhatsapp, formatarTelefoneWhatsapp, notificarPedido } from '@/lib/whatsapp'
import { DIFERENCA_VALIDADE_MIN, pushDiferencaVencida, textoCobrancaDiferenca, textoDiferencaRecebida, textoDiferencaVencida } from './diferenca'
import { enviarPurchaseCapi, type ContextoCompra } from '@/lib/meta-capi'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { conferirAprovacao, type Aprovacao } from '@/lib/financeiro/caixa'
import { avisarPixExpiradoIa } from '@/lib/agente-ia/avisos'
import { textoPixParceiroPago } from '@/lib/entregas/parceiro-pix'

/**
 * Pix online (Mercado Pago) — núcleo. Plano: docs/pix-online/plano.md (aprovado em 2026-10-04).
 *
 * Regra de ouro: o pedido só vira PAGO depois de o pagamento ser CONSULTADO na API do MP com o token da
 * loja e bater tudo (status aprovado, referência = pedido, valor = total, BRL, coletor = conta da loja).
 * Webhook, verificação periódica e a tela do cliente só "acordam" a consulta — nenhum deles confirma.
 */
/** Linha do banco (pagamentos_online / pedidos) como o Supabase devolve. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Reg = Record<string, any>

export const USUARIO_MP = { id: null, nome: 'Mercado Pago (API)' } as const
const centavos = (v: number) => Math.round(v * 100)

/** Pix online disponível na vitrine desta loja? Flag + servidor configurado + conta conectada. */
export async function pixOnlineDaLoja(admin: SupabaseClient, restauranteId: string): Promise<{ ativo: boolean; validadeMin: number }> {
  const { data } = await admin.from('restaurantes').select('pix_online_ativo, pix_online_validade_min').eq('id', restauranteId).maybeSingle()
  const validadeMin = Number(data?.pix_online_validade_min ?? 15)
  if (!data?.pix_online_ativo || !mpConfigurado()) return { ativo: false, validadeMin }
  const conta = await contaPublica(admin, restauranteId)
  // Conta sem chave Pix: o MP recusa gerar o QR. A vitrine não oferece "Pagar agora" até a chave existir.
  return { ativo: conta.conectada && conta.erro !== ERRO_SEM_CHAVE_PIX, validadeMin }
}

/** Marca em pagamentos_contas.erro: a conta conectada não tem chave Pix (o MP não gera QR). */
export const ERRO_SEM_CHAVE_PIX = 'sem_chave_pix'
/** O erro do MP quando a conta não tem chave Pix: "Collector user without key enabled for QR render". */
export function erroDeChavePix(e: unknown): boolean {
  return e instanceof ErroMp && e.status === 400 && /without key enabled|key enabled for qr/i.test(e.message)
}
async function marcarChavePix(admin: SupabaseClient, restauranteId: string, temChave: boolean) {
  if (temChave) await admin.from('pagamentos_contas').update({ erro: null }).eq('restaurante_id', restauranteId).eq('erro', ERRO_SEM_CHAVE_PIX)
  else await admin.from('pagamentos_contas').update({ erro: ERRO_SEM_CHAVE_PIX }).eq('restaurante_id', restauranteId).eq('status', 'conectada')
}

/**
 * O MP não tem API de "chaves Pix". A sondagem cria uma cobrança Pix de R$ 1,00 (31 min) e a CANCELA
 * na hora — ninguém paga, nada é cobrado. Sem chave, o MP recusa já na criação.
 */
export async function verificarChavePix(admin: SupabaseClient, restauranteId: string): Promise<'ok' | 'sem_chave' | 'erro'> {
  const agora = new Date()
  try {
    const cob = await comTokenDaLoja(admin, restauranteId, (token) => provedorMp().criarPix(token, {
      valor: 1, descricao: 'Verificacao da chave Pix (Menuzia) - nao pague', referencia: `verificacao-chave-pix:${restauranteId}`,
      expiraEm: expiracaoMp(vencimentoNoMp(agora, agora)), email: 'verificacao@pagamentos.menuzia.com.br',
      notificacaoUrl: null, idempotencia: `verificacao-chave-pix:${restauranteId}:${agora.getTime()}`,
    }))
    await comTokenDaLoja(admin, restauranteId, (token) => provedorMp().cancelar(token, cob.id)).catch(() => null)
    await marcarChavePix(admin, restauranteId, true)
    return 'ok'
  } catch (e) {
    if (erroDeChavePix(e)) { await marcarChavePix(admin, restauranteId, false); return 'sem_chave' }
    console.error('[pix-online] verificação da chave Pix:', (e as Error).message?.slice(0, 160))
    return 'erro'
  }
}

/** Expiração no formato que o MP aceita, com o fuso de São Paulo: 2026-10-04T23:15:00.000-03:00. */
/**
 * O Mercado Pago exige vencimento de Pix de no mínimo 30 min: abaixo disso ele devolve a cobrança já
 * "cancelled" (achado no teste real de 2026-10-07, prazo de 5 min). O MP recebe max(prazo, 31 min);
 * o pedido continua vencendo pelo prazo da loja — a verificação periódica cancela no MP o que passar.
 */
export const MIN_VENCIMENTO_MP_MIN = 31
export function vencimentoNoMp(expiraLocal: Date, agora: Date): Date {
  return new Date(Math.max(expiraLocal.getTime(), agora.getTime() + MIN_VENCIMENTO_MP_MIN * 60_000))
}

export function expiracaoMp(d: Date): string {
  const sp = new Date(d.getTime() - 3 * 3_600_000)
  return sp.toISOString().replace('Z', '-03:00')
}

export interface CobrancaParaCliente {
  pagamentoId: string; status: string; valor: number; qrCode: string | null; qrCodeBase64: string | null; expiraEm: string; pedidoStatus: string
}

/**
 * Cria (ou devolve a que já existe) a cobrança Pix do pedido. Valor = total do pedido NO BANCO.
 * Idempotente: um pedido tem no máximo uma cobrança pendente; o MP recebe `X-Idempotency-Key`.
 */
export async function criarCobrancaPix(admin: SupabaseClient, p: { restauranteId: string; pedidoId: string; contexto?: ContextoCompra | null }): Promise<CobrancaParaCliente> {
  const { data: ped } = await admin.from('pedidos').select('id, numero, total, status, restaurante_id').eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!ped) throw new Error('pedido_nao_encontrado')
  if (ped.status !== 'aguardando_pagamento') throw new Error('pedido_nao_aguarda_pagamento')
  const { data: ja } = await admin.from('pagamentos_online').select('*').eq('pedido_id', ped.id).eq('status', 'pendente').maybeSingle()
  if (ja) return paraCliente(ja, ped.status)

  const { validadeMin } = await pixOnlineDaLoja(admin, p.restauranteId)
  const { data: loja } = await admin.from('restaurantes').select('nome').eq('id', p.restauranteId).maybeSingle()
  const agora = new Date()
  const expira = new Date(agora.getTime() + validadeMin * 60_000)
  const valor = Number(ped.total)
  let cob: Awaited<ReturnType<ReturnType<typeof provedorMp>['criarPix']>>
  try {
    cob = await comTokenDaLoja(admin, p.restauranteId, (token) => provedorMp().criarPix(token, {
      valor, descricao: `Pedido #${ped.numero} - ${(loja?.nome ?? 'Menuzia').slice(0, 60)}`, referencia: ped.id,
      expiraEm: expiracaoMp(vencimentoNoMp(expira, agora)), email: `pedido-${ped.id.slice(0, 8)}@pagamentos.menuzia.com.br`,
      notificacaoUrl: webhookUrlMp(), idempotencia: `pedido:${ped.id}`,
    }))
  } catch (e) {
    if (erroDeChavePix(e)) await marcarChavePix(admin, p.restauranteId, false)
    throw e
  }
  await marcarChavePix(admin, p.restauranteId, true)
  const conta = await tokenDaLoja(admin, p.restauranteId)
  const linha = {
    restaurante_id: p.restauranteId, pedido_id: ped.id, mp_payment_id: cob.id, mp_user_id: conta?.mpUserId ?? null, valor,
    status: 'pendente', status_mp: cob.status, qr_code: cob.qrCode, qr_code_base64: cob.qrCodeBase64, expira_em: expira.toISOString(),
    contexto: p.contexto ?? null,
  }
  const { data: gravada, error } = await admin.from('pagamentos_online').upsert(linha, { onConflict: 'mp_payment_id' }).select('*').single()
  if (error) {
    // Clique duplo: a outra requisição gravou primeiro (índice de uma pendente por pedido).
    const { data: outra } = await admin.from('pagamentos_online').select('*').eq('pedido_id', ped.id).eq('status', 'pendente').maybeSingle()
    if (outra) return paraCliente(outra, ped.status)
    throw error
  }
  return paraCliente(gravada, ped.status)
}

/**
 * Pix só da DIFERENÇA de um pedido já pago online que aumentou na edição (Fase 3, 19/10). Linha própria em
 * pagamentos_online (finalidade 'diferenca', referência = o mesmo pedido, valor = diferença, vale 30 min). Uma nova
 * edição cancela a cobrança de diferença pendente anterior; se ela tiver sido paga nesse meio-tempo, recusa
 * ('diferenca_anterior_paga') para o operador reabrir o pedido com o valor certo.
 */
export async function criarCobrancaDiferenca(admin: SupabaseClient, p: { restauranteId: string; pedidoId: string; valor: number; motivo: string }): Promise<CobrancaParaCliente> {
  const { data: ped } = await admin.from('pedidos').select('id, numero, status, pago, pagamento_online, restaurante_id').eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!ped) throw new Error('pedido_nao_encontrado')
  if (!(ped.pago && ped.pagamento_online)) throw new Error('pedido_nao_pago_online')
  const valor = Math.round(p.valor * 100) / 100
  if (!(valor > 0)) throw new Error('valor_invalido')
  const { ativo } = await pixOnlineDaLoja(admin, p.restauranteId)
  if (!ativo) throw new Error('pix_online_desligado')
  const anterior = await cancelarCobrancaPendente(admin, p.restauranteId, p.pedidoId)
  if (anterior === 'paga') throw new Error('diferenca_anterior_paga')
  if (anterior === 'erro') throw new Error('diferenca_anterior_nao_cancelada')
  const { data: loja } = await admin.from('restaurantes').select('nome').eq('id', p.restauranteId).maybeSingle()
  const agora = new Date()
  const expira = new Date(agora.getTime() + DIFERENCA_VALIDADE_MIN * 60_000)
  let cob: Awaited<ReturnType<ReturnType<typeof provedorMp>['criarPix']>>
  try {
    cob = await comTokenDaLoja(admin, p.restauranteId, (token) => provedorMp().criarPix(token, {
      valor, descricao: `Diferenca do pedido #${ped.numero} - ${(loja?.nome ?? 'Menuzia').slice(0, 50)}`, referencia: ped.id,
      expiraEm: expiracaoMp(vencimentoNoMp(expira, agora)), email: `pedido-${ped.id.slice(0, 8)}@pagamentos.menuzia.com.br`,
      notificacaoUrl: webhookUrlMp(), idempotencia: `diferenca:${ped.id}:${agora.getTime()}`,
    }))
  } catch (e) {
    if (erroDeChavePix(e)) await marcarChavePix(admin, p.restauranteId, false)
    throw e
  }
  const conta = await tokenDaLoja(admin, p.restauranteId)
  const { data: gravada, error } = await admin.from('pagamentos_online').insert({
    restaurante_id: p.restauranteId, pedido_id: ped.id, mp_payment_id: cob.id, mp_user_id: conta?.mpUserId ?? null, valor, finalidade: 'diferenca',
    status: 'pendente', status_mp: cob.status, qr_code: cob.qrCode, qr_code_base64: cob.qrCodeBase64, expira_em: expira.toISOString(), contexto: { motivo: p.motivo.slice(0, 200) },
  }).select('*').single()
  if (error) throw error
  return paraCliente(gravada, ped.status)
}

/**
 * Pix do TOTAL para um parceiro de entrega que não recebe na entrega (21/10/2026, Uber/Lalamove). Pedido pronto e
 * ainda "a receber": linha própria em pagamentos_online (finalidade 'entrega_parceiro'). Pago → o pedido vira Pix online
 * e o servidor chama o parceiro (lib/entregas/parceiro-pix-servidor.ts). O prazo de 10 min é nosso (cron); no MP a
 * cobrança vale o mínimo dele (31 min), para quem pagar um pouco depois ainda ser atendido.
 */
export async function criarCobrancaParceiro(admin: SupabaseClient, p: { restauranteId: string; pedidoId: string; provedor: string }): Promise<CobrancaParaCliente> {
  const { data: ped } = await admin.from('pedidos').select('id, numero, status, pago, total, restaurante_id').eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!ped) throw new Error('pedido_nao_encontrado')
  if (ped.pago) throw new Error('pedido_ja_pago')
  const valor = Math.round(Number(ped.total) * 100) / 100
  if (!(valor > 0)) throw new Error('valor_invalido')
  const { ativo } = await pixOnlineDaLoja(admin, p.restauranteId)
  if (!ativo) throw new Error('pix_online_desligado')
  const anterior = await cancelarCobrancaPendente(admin, p.restauranteId, p.pedidoId)
  if (anterior === 'paga') throw new Error('pedido_ja_pago')
  if (anterior === 'erro') throw new Error('cobranca_anterior_nao_cancelada')
  const { data: loja } = await admin.from('restaurantes').select('nome').eq('id', p.restauranteId).maybeSingle()
  const agora = new Date()
  const expira = new Date(agora.getTime() + 10 * 60_000)
  let cob: Awaited<ReturnType<ReturnType<typeof provedorMp>['criarPix']>>
  try {
    cob = await comTokenDaLoja(admin, p.restauranteId, (token) => provedorMp().criarPix(token, {
      valor, descricao: `Pedido #${ped.numero} - ${(loja?.nome ?? 'Menuzia').slice(0, 50)}`, referencia: ped.id,
      expiraEm: expiracaoMp(vencimentoNoMp(expira, agora)), email: `pedido-${ped.id.slice(0, 8)}@pagamentos.menuzia.com.br`,
      notificacaoUrl: webhookUrlMp(), idempotencia: `parceiro:${ped.id}:${agora.getTime()}`,
    }))
  } catch (e) {
    if (erroDeChavePix(e)) await marcarChavePix(admin, p.restauranteId, false)
    throw e
  }
  const conta = await tokenDaLoja(admin, p.restauranteId)
  const { data: gravada, error } = await admin.from('pagamentos_online').insert({
    restaurante_id: p.restauranteId, pedido_id: ped.id, mp_payment_id: cob.id, mp_user_id: conta?.mpUserId ?? null, valor, finalidade: 'entrega_parceiro',
    status: 'pendente', status_mp: cob.status, qr_code: cob.qrCode, qr_code_base64: cob.qrCodeBase64, expira_em: expira.toISOString(), contexto: { provedor: p.provedor },
  }).select('*').single()
  if (error) throw error
  return paraCliente(gravada, ped.status)
}

/** Pix do parceiro pago (21/10): pedido vira "Pix online pago", livro-caixa recebe, cliente é avisado e o parceiro é chamado. */
async function conferirParceiro(admin: SupabaseClient, reg: Reg, pg: PagamentoMp, ped: Reg, contaUserId: string | null, origem: string): Promise<ResultadoConferencia> {
  const numero = Number(ped.numero)
  if (pg.status === 'approved') {
    const div = divergencias(pg, reg as { pedido_id: string; valor: number; mp_user_id: string | null; metodo?: string | null }, contaUserId, Number(reg.valor))
    if (div.length) {
      await admin.from('pagamentos_online').update({ status: 'erro', erro: `não confere: ${div.join(', ')}` }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente', 'expirado'])
      await criarAlerta(admin, { restauranteId: reg.restaurante_id, tipo: 'pix_online_divergente', gravidade: 'grave',
        mensagem: `Pix do pedido #${numero} (entregador parceiro) NÃO confere (${div.join(', ')}). O parceiro não foi chamado.`, dados: { pagamento: reg.id, mp: pg.id, divergencias: div, chave: pg.id }, dedupeMin: 60, dedupeChave: pg.id })
      return 'divergente'
    }
    if (reg.status === 'pago') return 'ja_confirmado'
    await admin.from('pagamentos_online').update({ status: 'pago', pago_em: pg.aprovadoEm ?? new Date().toISOString(), taxa: pg.taxa, liquido: pg.liquido, erro: null }).eq('id', reg.id)
    // O pagamento muda de "dinheiro/maquininha" para Pix online (Financeiro e comanda passam a mostrar Pix).
    const { data: mudou } = await admin.from('pedidos').update({ pago: true, pagamento_online: true, forma_pagamento: 'pix', troco_para: null, cartao_tipo: null }).eq('id', ped.id).eq('pago', false).select('id, cliente_telefone').maybeSingle()
    await lancarRecebimento(admin, reg, pg, `Pedido #${numero} (Pix antes do entregador parceiro)`)
    await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: USUARIO_MP.nome, acao: 'pix_online.parceiro_pago', entidade: 'pedido', entidadeId: ped.id, dados: { mp_payment_id: pg.id, valor: pg.valor, origem } })
    if (mudou) {
      avisarClienteDiferenca(admin, reg.restaurante_id, mudou, textoPixParceiroPago({ numero })).catch(() => null)
      const { aposPixParceiroPago } = await import('@/lib/entregas/parceiro-pix-servidor')
      await aposPixParceiroPago(admin, reg.restaurante_id, ped.id).catch((e) => console.error('[pix parceiro] chamar parceiro:', (e as Error).message))
    }
    return 'confirmado'
  }
  if (pg.status === 'refunded' || pg.status === 'charged_back') {
    if (reg.status !== 'devolvido') await admin.from('pagamentos_online').update({ status: 'devolvido', devolvido_em: reg.devolvido_em ?? new Date().toISOString() }).eq('id', reg.id)
    return 'devolvido'
  }
  if (['cancelled', 'rejected', 'expired'].includes(pg.status)) {
    if (reg.status !== 'cancelado') await admin.from('pagamentos_online').update({ status: 'expirado' }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente'])
    return 'expirado'
  }
  return 'pendente'
}

/** WhatsApp ao cliente com o Pix da diferença: texto + código sozinho (fácil de copiar). Falha não derruba a edição. */
export async function enviarPixDiferencaAoCliente(admin: SupabaseClient, restauranteId: string, ped: { numero: number; cliente_telefone: string | null }, cob: CobrancaParaCliente): Promise<boolean> {
  if (!cob.qrCode) return false
  const { data: loja } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).maybeSingle()
  const numero = formatarTelefoneWhatsapp(ped.cliente_telefone ?? '')
  if (!numero || !loja?.evolution_instance) return false
  const ok1 = await enviarWhatsapp(numero, textoCobrancaDiferenca({ numero: ped.numero, valor: cob.valor, expiraEm: cob.expiraEm }), loja.evolution_instance, { admin, origem: 'automatico', restauranteId })
  const ok2 = ok1 && await enviarWhatsapp(numero, cob.qrCode, loja.evolution_instance, { admin, origem: 'automatico', restauranteId })
  return ok1 && ok2
}

async function avisarClienteDiferenca(admin: SupabaseClient, restauranteId: string, ped: { cliente_telefone?: string | null }, texto: string) {
  const { data: loja } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).maybeSingle()
  const numero = formatarTelefoneWhatsapp(ped.cliente_telefone ?? '')
  if (!numero || !loja?.evolution_instance) return
  await enviarWhatsapp(numero, texto, loja.evolution_instance, { admin, origem: 'automatico', restauranteId })
}

/**
 * Conferência de uma cobrança de DIFERENÇA (Fase 3). Aprovada: pedido limpa a diferença, livro-caixa recebe o valor,
 * cliente recebe "Recebemos a diferença ✅". Vencida/cancelada no MP sem pagar: pedido vira 'pix_vencido' e a loja é
 * avisada (alerta grave + push do painel) para decidir. Nunca cancela nem muda o status do pedido.
 */
async function conferirDiferenca(admin: SupabaseClient, reg: Reg, pg: PagamentoMp, ped: Reg, contaUserId: string | null, origem: string): Promise<ResultadoConferencia> {
  const numero = Number(ped.numero)
  if (pg.status === 'approved') {
    const div = divergencias(pg, reg as { pedido_id: string; valor: number; mp_user_id: string | null; metodo?: string | null }, contaUserId, Number(reg.valor))
    if (div.length) {
      await admin.from('pagamentos_online').update({ status: 'erro', erro: `não confere: ${div.join(', ')}` }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente', 'expirado'])
      await criarAlerta(admin, { restauranteId: reg.restaurante_id, tipo: 'pix_online_divergente', gravidade: 'grave',
        mensagem: `Pix da diferença do pedido #${numero} NÃO confere (${div.join(', ')}). A diferença continua em aberto.`, dados: { pagamento: reg.id, mp: pg.id, divergencias: div, chave: pg.id }, dedupeMin: 60, dedupeChave: pg.id })
      return 'divergente'
    }
    if (reg.status === 'pago') return 'ja_confirmado'
    await admin.from('pagamentos_online').update({ status: 'pago', pago_em: pg.aprovadoEm ?? new Date().toISOString(), taxa: pg.taxa, liquido: pg.liquido, erro: null }).eq('id', reg.id)
    const { data: mudou } = await admin.from('pedidos').update({ diferenca_a_receber: null, diferenca_modo: null }).eq('id', ped.id).in('diferenca_modo', ['pix', 'pix_vencido']).select('id').maybeSingle()
    await lancarRecebimento(admin, reg, pg, `Diferença do pedido #${numero} (edição)`)
    await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: USUARIO_MP.nome, acao: 'pix_online.diferenca_paga', entidade: 'pedido', entidadeId: ped.id, dados: { mp_payment_id: pg.id, valor: pg.valor, origem } })
    if (mudou) avisarClienteDiferenca(admin, reg.restaurante_id, ped, textoDiferencaRecebida({ numero, valor: Number(reg.valor) })).catch(() => null)
    return 'confirmado'
  }
  if (pg.status === 'refunded' || pg.status === 'charged_back') {
    if (reg.status !== 'devolvido') await admin.from('pagamentos_online').update({ status: 'devolvido', devolvido_em: reg.devolvido_em ?? new Date().toISOString() }).eq('id', reg.id)
    return 'devolvido'
  }
  if (['cancelled', 'rejected', 'expired'].includes(pg.status)) {
    // Cancelada por nova edição / "receber na entrega": nada a avisar.
    if (reg.status === 'cancelado') return 'expirado'
    await admin.from('pagamentos_online').update({ status: 'expirado' }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente'])
    const { data: venceu } = await admin.from('pedidos').update({ diferenca_modo: 'pix_vencido' }).eq('id', ped.id).eq('diferenca_modo', 'pix').select('id').maybeSingle()
    if (venceu) {
      const valor = Number(reg.valor)
      await criarAlerta(admin, { restauranteId: reg.restaurante_id, tipo: 'pix_diferenca_vencida', gravidade: 'grave', mensagem: textoDiferencaVencida({ numero, valor }),
        dados: { pagamento: reg.id, pedido: ped.id, chave: reg.id }, dedupeMin: 60, dedupeChave: reg.id })
      avisarPainelPedidoNovo(admin, reg.restaurante_id, { id: ped.id, numero, canal: ped.tipo }, undefined, pushDiferencaVencida({ numero, valor })).catch(() => null)
      await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: 'Sistema', acao: 'pix_online.diferenca_vencida', entidade: 'pedido', entidadeId: ped.id, dados: { pagamento: reg.id, valor } })
    }
    return 'expirado'
  }
  if (reg.status === 'verificacao_pendente') await admin.from('pagamentos_online').update({ status: 'pendente', erro: null }).eq('id', reg.id)
  return 'pendente'
}

function paraCliente(r: Record<string, unknown>, pedidoStatus: string): CobrancaParaCliente {
  return {
    pagamentoId: String(r.id), status: String(r.status), valor: Number(r.valor), qrCode: (r.qr_code as string) ?? null, qrCodeBase64: (r.qr_code_base64 as string) ?? null,
    expiraEm: String(r.expira_em), pedidoStatus,
  }
}

export type ResultadoConferencia =
  | 'confirmado' | 'ja_confirmado' | 'a_devolver' | 'pendente' | 'expirado' | 'recusado' | 'divergente' | 'devolvido' | 'desconhecido' | 'sem_conta' | 'erro_api'

/** Confere TUDO que o MP devolveu contra o registro e o pedido. Puro (testado). */
/** Cartão online (12/10): a mesma conferência vale para Pix e cartão; muda só o tipo esperado. */
export const ehCartao = (reg: { metodo?: string | null }) => reg.metodo === 'cartao'
const FORMA = (reg: { metodo?: string | null }) => (ehCartao(reg) ? 'cartao_online' : 'pix_online')
const CHAVE = (reg: { metodo?: string | null }) => (ehCartao(reg) ? 'cartaoonline' : 'pixonline')
const NOME = (reg: { metodo?: string | null }) => (ehCartao(reg) ? 'Cartão online' : 'Pix online')

export function divergencias(pg: PagamentoMp, reg: { pedido_id: string; valor: number; mp_user_id: string | null; metodo?: string | null }, contaUserId: string | null, totalPedido: number): string[] {
  const d: string[] = []
  if (pg.externalReference !== reg.pedido_id) d.push('referencia')
  if (centavos(pg.valor) !== centavos(Number(reg.valor)) || centavos(pg.valor) !== centavos(totalPedido)) d.push('valor')
  if (pg.moeda && pg.moeda !== 'BRL') d.push('moeda')
  const coletorEsperado = contaUserId ?? reg.mp_user_id
  if (!pg.coletorId || !coletorEsperado || pg.coletorId !== coletorEsperado) d.push('coletor')
  if (ehCartao(reg) ? !['credit_card', 'debit_card'].includes(pg.tipo ?? '') : pg.metodo && pg.metodo !== 'pix') d.push('metodo')
  return d
}

/**
 * Consulta o pagamento no MP e aplica o resultado. Idempotente (pode ser chamado por webhook, cron e
 * cliente ao mesmo tempo): a passagem "aguardando → recebido" é um UPDATE condicional no banco.
 */
export async function conferirPagamento(admin: SupabaseClient, mpPaymentId: string, origem: 'webhook' | 'verificacao' | 'cliente'): Promise<ResultadoConferencia> {
  const { data: reg } = await admin.from('pagamentos_online').select('*').eq('mp_payment_id', mpPaymentId).maybeSingle()
  if (!reg) return 'desconhecido'
  let pg: PagamentoMp
  let contaUserId: string | null = null
  try {
    pg = await comTokenDaLoja(admin, reg.restaurante_id, async (token, mpUserId) => { contaUserId = mpUserId; return provedorMp().consultar(token, mpPaymentId) })
  } catch (e) {
    const semConta = e instanceof ErroMp && e.status === 401
    await admin.from('pagamentos_online').update({
      verificacoes: (reg.verificacoes ?? 0) + 1, ultima_verificacao_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
      ...(semConta && reg.status === 'pendente' ? { status: 'verificacao_pendente', erro: 'conta do Mercado Pago desconectada' } : {}),
    }).eq('id', reg.id)
    return semConta ? 'sem_conta' : 'erro_api'
  }
  const { data: ped } = await admin.from('pedidos').select('id, numero, status, total, restaurante_id, tipo, agendado_para, cliente_telefone, diferenca_a_receber, diferenca_modo').eq('id', reg.pedido_id).single()
  if (!ped) return 'desconhecido'
  await admin.from('pagamentos_online').update({ status_mp: pg.status, verificacoes: (reg.verificacoes ?? 0) + 1, ultima_verificacao_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', reg.id)
  // Fase 3 (19/10): cobrança da DIFERENÇA de um pedido já pago — caminho próprio (nunca mexe no status do pedido).
  if (reg.finalidade === 'diferenca') return conferirDiferenca(admin, reg, pg, ped, contaUserId, origem)
  // 21/10: Pix do total antes de chamar o parceiro de entrega que não recebe na entrega.
  if (reg.finalidade === 'entrega_parceiro') return conferirParceiro(admin, reg, pg, ped, contaUserId, origem)

  if (pg.status === 'approved') {
    const div = divergencias(pg, reg, contaUserId, Number(ped.total))
    if (div.length) {
      await admin.from('pagamentos_online').update({ status: 'erro', erro: `não confere: ${div.join(', ')}` }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente'])
      await criarAlerta(admin, { restauranteId: reg.restaurante_id, tipo: 'pix_online_divergente', gravidade: 'grave',
        mensagem: `${NOME(reg)} do pedido #${ped.numero} NÃO confere (${div.join(', ')}). O pedido não foi liberado.`, dados: { pagamento: reg.id, mp: mpPaymentId, divergencias: div }, dedupeMin: 60, dedupeChave: mpPaymentId })
      await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: USUARIO_MP.nome, acao: 'pix_online.divergente', entidade: 'pagamento_online', entidadeId: reg.id, dados: { divergencias: div, origem } })
      return 'divergente'
    }
    if (['pago', 'devolvido', 'a_devolver'].includes(reg.status)) return reg.status === 'pago' ? 'ja_confirmado' : (reg.status as ResultadoConferencia)
    if (ped.status === 'aguardando_pagamento') return confirmarPago(admin, reg, pg, ped, origem)
    return pagoDepoisDeCancelado(admin, reg, pg, ped, origem)
  }
  if (pg.status === 'refunded' || pg.status === 'charged_back') {
    if (reg.status !== 'devolvido') await admin.from('pagamentos_online').update({ status: 'devolvido', devolvido_em: reg.devolvido_em ?? new Date().toISOString() }).eq('id', reg.id)
    return 'devolvido'
  }
  // Cartão recusado (ou cancelado pelo MP numa análise): o pedido CONTINUA esperando — o cliente tenta outro cartão ou
  // troca a forma de pagamento. Só o prazo expira o pedido (verificarPendentes).
  if (ehCartao(reg) && ['cancelled', 'rejected'].includes(pg.status)) return 'recusado'
  if (['cancelled', 'rejected', 'expired'].includes(pg.status)) {
    // Cobrança que NÓS cancelamos (cliente trocou para cartão/dinheiro pelo WhatsApp, 12/10): o aviso do MP chega antes
    // de o pedido ir para a cozinha — não é Pix expirado, quem cancelou termina a troca (teste real #289).
    if (reg.status === 'cancelado') return 'expirado'
    if (ped.status === 'aguardando_pagamento') await expirarPedido(admin, reg, ped)
    else if (reg.status === 'pendente' || reg.status === 'verificacao_pendente') await admin.from('pagamentos_online').update({ status: pg.status === 'rejected' ? 'cancelado' : 'expirado' }).eq('id', reg.id)
    return pg.status === 'rejected' ? 'recusado' : 'expirado'
  }
  if (reg.status === 'verificacao_pendente') await admin.from('pagamentos_online').update({ status: 'pendente', erro: null }).eq('id', reg.id)
  return 'pendente'
}

async function turnoAberto(admin: SupabaseClient, restauranteId: string): Promise<string | null> {
  const { data } = await admin.from('caixa_turnos').select('id').eq('restaurante_id', restauranteId).is('fechado_em', null).order('aberto_em', { ascending: false }).limit(1).maybeSingle()
  return data?.id ?? null
}

/** Livro-caixa (só loja com financeiro): +bruto e −taxa na carteira "online". Idempotente pela chave. */
async function lancarRecebimento(admin: SupabaseClient, reg: Reg, pg: PagamentoMp, motivo?: string) {
  const { data: loja } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', reg.restaurante_id).maybeSingle()
  if (!loja?.financeiro_ativo) return
  const bruto = centavos(pg.valor)
  const taxa = centavos(pg.taxa || 0)
  const comum = { carteira: 'online' as const, forma: FORMA(reg), pedidoId: reg.pedido_id, pagamentoId: reg.id, dados: { mp_payment_id: pg.id } }
  const r = await lancar(admin, {
    restauranteId: reg.restaurante_id, turnoId: await turnoAberto(admin, reg.restaurante_id), chave: `${CHAVE(reg)}:${pg.id}`, origem: 'online',
    usuario: { id: null, nome: USUARIO_MP.nome }, motivo: motivo ?? null,
    linhas: [
      { tipo: 'recebimento' as const, valorCentavos: bruto, ...comum },
      ...(taxa > 0 ? [{ tipo: 'taxa' as const, valorCentavos: -taxa, ...comum }] : []),
    ],
  })
  if (r.ok) await admin.from('pagamentos_online').update({ lancado_em: new Date().toISOString() }).eq('id', reg.id)
  else console.error('[pix-online] livro-caixa:', r.erro)
}

async function confirmarPago(admin: SupabaseClient, reg: Reg, pg: PagamentoMp, ped: Reg, origem: string): Promise<ResultadoConferencia> {
  // A passagem acontece UMA vez: só quem acha o pedido ainda em "aguardando" muda.
  const { data: mudou } = await admin.from('pedidos').update({ status: 'recebido', pago: true, pagamento_online: true }).eq('id', ped.id).eq('status', 'aguardando_pagamento').select('id').maybeSingle()
  await admin.from('pagamentos_online').update({ status: 'pago', pago_em: pg.aprovadoEm ?? new Date().toISOString(), taxa: pg.taxa, liquido: pg.liquido, erro: null }).eq('id', reg.id)
  if (!mudou) return 'ja_confirmado'
  await lancarRecebimento(admin, reg, pg)
  await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: USUARIO_MP.nome, acao: ehCartao(reg) ? 'cartao_online.pago' : 'pix_online.pago', entidade: 'pedido', entidadeId: ped.id, dados: { mp_payment_id: pg.id, valor: pg.valor, taxa: pg.taxa, origem, ...(ehCartao(reg) ? { parcelas: pg.parcelas ?? null } : {}) } })
  // Agora sim: o que antes saía na criação do pedido.
  notificarPedido(admin, ped.id, 'recebido').catch(() => null)
  if (!ped.agendado_para) avisarPainelPedidoNovo(admin, reg.restaurante_id, { id: ped.id, numero: ped.numero, canal: ped.tipo }).catch(() => null)
  const ctx = (reg.contexto ?? {}) as Partial<ContextoCompra>
  enviarPurchaseCapi(admin, reg.restaurante_id, ped.id, { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, fbp: ctx.fbp ?? null, fbc: ctx.fbc ?? null, url: ctx.url ?? null }).catch(() => null)
  return 'confirmado'
}

async function pagoDepoisDeCancelado(admin: SupabaseClient, reg: Reg, pg: PagamentoMp, ped: Reg, origem: string): Promise<ResultadoConferencia> {
  await admin.from('pagamentos_online').update({ status: 'a_devolver', pago_em: pg.aprovadoEm ?? new Date().toISOString(), taxa: pg.taxa, liquido: pg.liquido }).eq('id', reg.id)
  await lancarRecebimento(admin, reg, pg, `${NOME(reg)} pago depois de ${ped.status === 'cancelado' ? 'cancelado' : 'expirado'} — a devolver`)
  await criarAlerta(admin, { restauranteId: reg.restaurante_id, tipo: 'pix_online_a_devolver', gravidade: 'grave',
    mensagem: `${NOME(reg)} de R$ ${Number(pg.valor).toFixed(2).replace('.', ',')} do pedido #${ped.numero} foi pago DEPOIS de cancelado. Devolva em Integrações › Mercado Pago.`,
    dados: { pagamento: reg.id, mp_payment_id: pg.id, pedido: ped.id }, dedupeMin: 24 * 60, dedupeChave: pg.id })
  await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: USUARIO_MP.nome, acao: 'pix_online.pago_apos_cancelado', entidade: 'pedido', entidadeId: ped.id, dados: { mp_payment_id: pg.id, valor: pg.valor, origem } })
  return 'a_devolver'
}

/** Cancela o pedido que não foi pago no prazo: MP cancelado, benefícios devolvidos, cliente avisado. */
async function expirarPedido(admin: SupabaseClient, reg: Reg, ped: Reg) {
  const { data: mudou } = await admin.from('pedidos').update({
    status: 'cancelado', cancelado_motivo: ehCartao(reg) ? 'pagamento_expirado' : 'pix_expirado',
    cancelado_observacao: ehCartao(reg) ? 'Cartão online não pago no prazo' : 'Pix online não pago no prazo', cancelado_por: 'sistema',
    cancelado_em: new Date().toISOString(), reimprimir: false,
  }).eq('id', ped.id).eq('status', 'aguardando_pagamento').select('id').maybeSingle()
  await admin.from('pagamentos_online').update({ status: 'expirado' }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente'])
  if (!mudou) return
  await reverterBeneficiosPedidoCancelado(admin, reg.restaurante_id, ped.id)
  // Pedido feito pela IA no WhatsApp (12/10): a IA pergunta se gera outro Pix ou paga na entrega, no lugar do aviso de cancelado.
  const pelaIa = !ehCartao(reg) && (await avisarPixExpiradoIa(admin, reg.restaurante_id, ped.id).catch(() => false))
  if (!pelaIa) notificarPedido(admin, ped.id, 'cancelado').catch(() => null)
  await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: 'Sistema', acao: 'pix_online.expirado', entidade: 'pedido', entidadeId: ped.id, dados: { pagamento: reg.id } })
}

/**
 * Cliente desistiu do Pix ainda NÃO pago (troca para cartão/dinheiro ou cancela pelo WhatsApp, 12/10). Ordem segura:
 * consulta (pago → 'paga', não mexe) → marca a cobrança 'cancelado' aqui (a verificação periódica deixa de olhar) →
 * cancela no MP. O MP recusou (ex.: pago naquele segundo) → volta a 'pendente' e devolve 'erro' (quem chama aciona o
 * atendente). Não consulta de novo depois de cancelar: "cancelled" com o pedido aguardando expiraria o pedido.
 */
export async function cancelarCobrancaPendente(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<'cancelada' | 'paga' | 'sem_cobranca' | 'erro'> {
  const { data: reg } = await admin.from('pagamentos_online').select('id, mp_payment_id, status').eq('pedido_id', pedidoId).eq('restaurante_id', restauranteId)
    .in('status', ['pendente', 'verificacao_pendente']).maybeSingle()
  if (!reg) return 'sem_cobranca'
  if (reg.mp_payment_id) {
    const r = await conferirPagamento(admin, reg.mp_payment_id, 'cliente')
    if (r === 'confirmado' || r === 'ja_confirmado') return 'paga'
    if (r !== 'pendente') return 'erro'
  }
  const { data: marcada } = await admin.from('pagamentos_online').update({ status: 'cancelado', atualizado_em: new Date().toISOString() })
    .eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente']).select('id').maybeSingle()
  if (!marcada) return 'erro'
  if (reg.mp_payment_id) {
    try {
      await comTokenDaLoja(admin, restauranteId, (t) => provedorMp().cancelar(t, reg.mp_payment_id))
    } catch (e) {
      console.error('[pix-online] cancelar cobrança:', (e as Error).message?.slice(0, 160))
      await admin.from('pagamentos_online').update({ status: reg.status }).eq('id', reg.id).eq('status', 'cancelado')
      return 'erro'
    }
  }
  return 'cancelada'
}

/**
 * Verificação periódica (cron, a cada minuto): consulta as pendentes (rede de segurança se o webhook
 * falhar), expira as vencidas — CONSULTANDO antes (pode ter sido pago no último segundo) — e renova
 * tokens perto de vencer.
 */
export async function verificarPendentes(admin: SupabaseClient, opcoes: { limite?: number } = {}) {
  const resumo = { consultadas: 0, confirmadas: 0, expiradas: 0, a_devolver: 0, erros: 0, renovadas: 0 }
  const agora = Date.now()
  const { data: pend } = await admin.from('pagamentos_online').select('id, mp_payment_id, restaurante_id, pedido_id, expira_em, status, metodo')
    .in('status', ['pendente', 'verificacao_pendente']).order('criado_em').limit(opcoes.limite ?? 200)
  for (const reg of pend ?? []) {
    // Cartão online sem nenhuma tentativa (cliente fechou a tela): só o prazo vale.
    if (!reg.mp_payment_id) {
      if (new Date(reg.expira_em).getTime() + 60_000 < agora) {
        const { data: ped } = await admin.from('pedidos').select('id, status').eq('id', reg.pedido_id).single()
        if (ped?.status === 'aguardando_pagamento') { await expirarPedido(admin, reg, ped); resumo.expiradas++ }
        else await admin.from('pagamentos_online').update({ status: 'expirado' }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente'])
      }
      continue
    }
    resumo.consultadas++
    const r = await conferirPagamento(admin, reg.mp_payment_id, 'verificacao')
    if (r === 'confirmado') resumo.confirmadas++
    else if (r === 'a_devolver') resumo.a_devolver++
    else if (r === 'erro_api' || r === 'sem_conta') resumo.erros++
    else if (r === 'pendente' && new Date(reg.expira_em).getTime() + 60_000 < agora) {
      // Venceu no MP e ainda "pendente" lá: cancela no MP e expira aqui.
      await comTokenDaLoja(admin, reg.restaurante_id, (t) => provedorMp().cancelar(t, reg.mp_payment_id)).catch(() => null)
      const de = await conferirPagamento(admin, reg.mp_payment_id, 'verificacao')
      if (de === 'confirmado') resumo.confirmadas++
      else {
        const { data: ped } = await admin.from('pedidos').select('id, status').eq('id', reg.pedido_id).single()
        const { data: atual } = await admin.from('pagamentos_online').select('*').eq('id', reg.id).single()
        if (ped?.status === 'aguardando_pagamento') await expirarPedido(admin, atual, ped)
        resumo.expiradas++
      }
    }
  }
  const limite = new Date(agora + 30 * 86_400_000).toISOString()
  const { data: contas } = await admin.from('pagamentos_contas').select('restaurante_id').eq('status', 'conectada').lt('expira_em', limite)
  for (const c of contas ?? []) if (await tokenDaLoja(admin, c.restaurante_id)) resumo.renovadas++
  return resumo
}

export type ResultadoDevolucao = { ok: true; devolucaoId: string } | { ok: false; erro: string; status: number }

/**
 * Devolução (estorno total) pela API do MP. SEMPRE com aprovação de gerente/dono com PIN (ou pelo
 * celular), e nunca de quem pediu (conferirAprovacao recusa a própria). Auditada; no livro-caixa entra
 * o estorno negativo na carteira "online", apontando o recebimento.
 */
export async function devolverPix(admin: SupabaseClient, p: {
  restauranteId: string; pagamentoId: string; solicitante: { id: string; nome: string }; aprovacao: Aprovacao; motivo: string
  /** Estorno PARCIAL (edição de pedido, 18/10): só este valor volta; o pagamento continua "pago" pelo resto. Ausente = total. */
  valorCentavos?: number
}): Promise<ResultadoDevolucao> {
  const motivo = p.motivo?.trim()
  if (!motivo || motivo.length < 3) return { ok: false, erro: 'Escreva o motivo da devolução.', status: 400 }
  const { data: reg } = await admin.from('pagamentos_online').select('*').eq('id', p.pagamentoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!reg) return { ok: false, erro: 'Pagamento não encontrado.', status: 404 }
  if (!['pago', 'a_devolver', 'devolvido_parcial'].includes(reg.status)) return { ok: false, erro: `Só dá para devolver um ${ehCartao(reg) ? 'cartão' : 'Pix'} pago.`, status: 409 }
  // Valor que ainda pode voltar: o pago menos o que já foi devolvido em estornos parciais anteriores.
  const jaDevolvido = centavos(Number(reg.devolucao_valor ?? 0))
  const restante = centavos(Number(reg.valor)) - jaDevolvido
  const parcial = p.valorCentavos !== undefined && p.valorCentavos < restante
  const valorEstorno = parcial ? Math.round(p.valorCentavos!) : restante
  if (valorEstorno <= 0) return { ok: false, erro: 'Não há valor a devolver.', status: 409 }
  const apr = await conferirAprovacao(admin, { restauranteId: p.restauranteId, solicitante: p.solicitante, aprovacao: p.aprovacao, acao: 'pix_online_devolver', valorCentavos: valorEstorno, motivo, contexto: { pagamento: reg.id, pedido: reg.pedido_id } })
  if (!apr.ok) return { ok: false, erro: apr.erro, status: apr.status }
  let reembolso
  try {
    // Chave de idempotência própria por estorno parcial (o total continua a de sempre).
    const idem = parcial ? `devolucao:${reg.id}:${jaDevolvido + valorEstorno}` : `devolucao:${reg.id}`
    reembolso = await comTokenDaLoja(admin, p.restauranteId, (t) => provedorMp().reembolsar(t, reg.mp_payment_id, idem, parcial ? valorEstorno / 100 : undefined))
  } catch (e) {
    return { ok: false, erro: e instanceof ErroMp ? `O Mercado Pago recusou a devolução (${e.status}).` : 'Falha ao falar com o Mercado Pago.', status: 502 }
  }
  await admin.from('pagamentos_online').update({
    status: parcial ? 'devolvido_parcial' : 'devolvido', devolucao_id: reembolso.id, devolvido_em: new Date().toISOString(), devolucao_pedida_por: p.solicitante.nome,
    aprovado_por_nome: apr.aprovadorNome, motivo_devolucao: motivo.slice(0, 300), devolucao_valor: (jaDevolvido + valorEstorno) / 100,
  }).eq('id', reg.id)
  const { data: loja } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', p.restauranteId).maybeSingle()
  if (loja?.financeiro_ativo) {
    const { data: original } = await admin.from('fin_lancamentos').select('id').eq('restaurante_id', p.restauranteId).eq('chave_idempotencia', `${CHAVE(reg)}:${reg.mp_payment_id}`).eq('linha', 1).maybeSingle()
    await lancar(admin, {
      restauranteId: p.restauranteId, turnoId: await turnoAberto(admin, p.restauranteId), chave: parcial ? `${CHAVE(reg)}-devolucao:${reg.mp_payment_id}:${jaDevolvido + valorEstorno}` : `${CHAVE(reg)}-devolucao:${reg.mp_payment_id}`, origem: 'online',
      usuario: { id: p.solicitante.id, nome: p.solicitante.nome }, motivo, aprovacao: { id: apr.id, nome: apr.aprovadorNome },
      linhas: [{ carteira: 'online', tipo: 'estorno', valorCentavos: -valorEstorno, forma: FORMA(reg), pedidoId: reg.pedido_id, pagamentoId: reg.id, referenciaId: original?.id ?? null, dados: { mp_payment_id: reg.mp_payment_id, devolucao_id: reembolso.id } }],
    })
  }
  await registrarAuditoria(admin, { restauranteId: p.restauranteId, usuarioId: p.solicitante.id, usuarioNome: p.solicitante.nome, acao: ehCartao(reg) ? 'cartao_online.devolvido' : 'pix_online.devolvido', entidade: 'pagamento_online', entidadeId: reg.id,
    dados: { valor: valorEstorno / 100, parcial, motivo, aprovado_por: apr.aprovadorNome, devolucao_id: reembolso.id, pedido: reg.pedido_id } })
  return { ok: true, devolucaoId: reembolso.id }
}

/**
 * Pedido cancelado no painel DEPOIS de pago online (Pix ou cartão, 12/10): o dinheiro está na conta da loja. Marca "a devolver"
 * e alerta — a devolução é sempre de uma pessoa, com PIN de gerente (devolverPix). Nunca estorna sozinho.
 */
export async function aDevolverAoCancelar(admin: SupabaseClient, restauranteId: string, pedido: { id: string; numero: number | null }): Promise<number> {
  const { data } = await admin.from('pagamentos_online').update({ status: 'a_devolver' })
    .eq('restaurante_id', restauranteId).eq('pedido_id', pedido.id).eq('status', 'pago').select('id, valor, metodo')
  for (const reg of data ?? []) {
    await criarAlerta(admin, { restauranteId, tipo: 'pix_online_a_devolver', gravidade: 'grave',
      mensagem: `${NOME(reg)} de R$ ${Number(reg.valor).toFixed(2).replace('.', ',')} do pedido #${pedido.numero ?? ''} foi pago e o pedido foi CANCELADO. Devolva em Integrações › Mercado Pago.`,
      dados: { pagamento: reg.id, pedido: pedido.id }, dedupeMin: 24 * 60, dedupeChave: `cancelado:${reg.id}` })
  }
  return data?.length ?? 0
}
