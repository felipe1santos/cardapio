import type { SupabaseClient } from '@supabase/supabase-js'
import { comTokenDaLoja, tokenDaLoja, webhookUrlMp } from './contas'
import { ErroMp, mpConfigurado, provedorMp, type PagamentoCartao } from './mercadopago'
import { conferirPagamento, ehCartao } from './pix-online'
import { registrarAuditoria } from '@/lib/auditoria'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import type { ContextoCompra } from '@/lib/meta-capi'

/**
 * CARTÃO DE CRÉDITO E DÉBITO ONLINE (Mercado Pago, Card Payment Brick — 12/10/2026). Mesma espinha do Pix online
 * (pix-online.ts): o pedido nasce "aguardando pagamento" e só vai para o Kanban quando o pagamento é CONSULTADO no MP com o
 * token da loja e bate (aprovado, referência, valor, coletor, tipo cartão).
 *
 * Os dados do cartão NUNCA passam por aqui: o Brick (navegador) tokeniza no próprio MP e manda só o token. Guardamos bandeira,
 * últimos 4 dígitos, crédito/débito e parcelas. Recusado: o pedido continua esperando (outro cartão ou trocar a forma);
 * só o prazo o expira. Parcelamento: só à vista por padrão; a loja escolhe até N parcelas.
 */
export const PRAZO_CARTAO_MIN = 30

// Renovação para buscar a chave pública: no máximo 1 vez por hora por loja (o checkout pergunta a cada abertura).
const renovouEm = new Map<string, number>()

export interface CartaoDaLoja { ativo: boolean; parcelasMax: number; publicKey: string | null }

/** Cartão online disponível nesta loja? Flag da loja + servidor + conta conectada com chave pública. */
export async function cartaoOnlineDaLoja(admin: SupabaseClient, restauranteId: string): Promise<CartaoDaLoja> {
  const [{ data: loja }, { data: conta }] = await Promise.all([
    admin.from('restaurantes').select('cartao_online_ativo, cartao_online_parcelas_max').eq('id', restauranteId).maybeSingle(),
    admin.from('pagamentos_contas').select('status, public_key').eq('restaurante_id', restauranteId).maybeSingle(),
  ])
  const parcelasMax = Math.min(12, Math.max(1, Number(loja?.cartao_online_parcelas_max) || 1))
  if (!loja?.cartao_online_ativo || !mpConfigurado() || conta?.status !== 'conectada') return { ativo: false, parcelasMax, publicKey: null }
  let publicKey = (conta.public_key as string | null) ?? null
  // Conta conectada antes de guardarmos a chave pública: uma renovação traz a chave (o MP manda junto com o token).
  if (!publicKey && Date.now() - (renovouEm.get(restauranteId) ?? 0) > 3_600_000) {
    renovouEm.set(restauranteId, Date.now())
    await tokenDaLoja(admin, restauranteId, { forcar: true, semMarcarErro: true }).catch(() => null)
    const { data: de } = await admin.from('pagamentos_contas').select('public_key').eq('restaurante_id', restauranteId).maybeSingle()
    publicKey = (de?.public_key as string | null) ?? null
  }
  return { ativo: !!publicKey, parcelasMax, publicKey }
}

export interface DadosCartao { token: string; metodoId: string; emissorId: string | null; parcelas: number; email: string; documento: { tipo: string; numero: string } | null }

const PROIBIDOS = /card_?number|security_?code|cvv|expiration|cardholder_?name|numero_?cartao/i

/** Limpa o que o navegador mandou (só o formato do Brick). Valor nunca vem daqui. Pura. */
export function limparDadosCartao(bruto: unknown, parcelasMax: number): { ok: true; dados: DadosCartao } | { ok: false; erro: string } {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  if (Object.keys(b).some((k) => PROIBIDOS.test(k))) return { ok: false, erro: 'Dados do cartão não podem ser enviados ao servidor.' }
  const token = typeof b.token === 'string' ? b.token.trim() : ''
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(token)) return { ok: false, erro: 'Cartão não reconhecido. Confira os dados e tente de novo.' }
  const metodoId = typeof b.payment_method_id === 'string' ? b.payment_method_id.trim().slice(0, 40) : ''
  if (!/^[a-z0-9_]{2,40}$/.test(metodoId)) return { ok: false, erro: 'Bandeira do cartão não reconhecida.' }
  const emissor = b.issuer_id == null ? '' : String(b.issuer_id).trim()
  const parcelas = Math.floor(Number(b.installments ?? 1))
  if (!Number.isFinite(parcelas) || parcelas < 1 || parcelas > parcelasMax) return { ok: false, erro: parcelasMax === 1 ? 'Esta loja aceita só pagamento à vista.' : `Esta loja aceita até ${parcelasMax} parcelas.` }
  const payer = (b.payer && typeof b.payer === 'object' ? b.payer : {}) as Record<string, unknown>
  const email = typeof payer.email === 'string' && /^[^@\s]{1,64}@[^@\s]{1,190}$/.test(payer.email.trim()) ? payer.email.trim() : ''
  const id = (payer.identification && typeof payer.identification === 'object' ? payer.identification : {}) as Record<string, unknown>
  const docTipo = typeof id.type === 'string' ? id.type.trim().toUpperCase().slice(0, 10) : ''
  const docNumero = typeof id.number === 'string' ? id.number.replace(/\D/g, '').slice(0, 20) : ''
  return {
    ok: true,
    dados: { token, metodoId, emissorId: /^[0-9]{1,12}$/.test(emissor) ? emissor : null, parcelas, email, documento: docTipo && docNumero ? { tipo: docTipo, numero: docNumero } : null },
  }
}

export type ResultadoCartao = 'aprovado' | 'recusado' | 'em_analise'
export function resultadoDoStatus(status: string): ResultadoCartao {
  if (status === 'approved') return 'aprovado'
  if (status === 'rejected' || status === 'cancelled' || status === 'refunded' || status === 'charged_back') return 'recusado'
  return 'em_analise'
}

/** Mensagem para o cliente a partir do status_detail do MP (recusas mais comuns). Pura. */
export function mensagemRecusa(detalhe: string | null | undefined): string {
  const d = String(detalhe ?? '')
  if (/insufficient_amount/.test(d)) return 'Pagamento recusado: limite ou saldo insuficiente. Tente outro cartão ou outra forma de pagamento.'
  if (/bad_filled_security_code/.test(d)) return 'Código de segurança inválido. Confira o CVV e tente de novo.'
  if (/bad_filled_date/.test(d)) return 'Data de validade inválida. Confira e tente de novo.'
  if (/bad_filled/.test(d)) return 'Algum dado do cartão está errado. Confira e tente de novo.'
  if (/call_for_authorize/.test(d)) return 'O banco pediu autorização. Libere a compra no app do banco e tente de novo, ou use outro cartão.'
  if (/card_disabled/.test(d)) return 'Cartão bloqueado ou inativo. Fale com o banco ou use outro cartão.'
  if (/duplicated_payment/.test(d)) return 'Pagamento repetido recusado. Se já pagou, aguarde; senão, use outro cartão.'
  if (/max_attempts/.test(d)) return 'Muitas tentativas com este cartão. Use outro cartão ou outra forma de pagamento.'
  if (/high_risk|blacklist/.test(d)) return 'Pagamento recusado por segurança. Use outro cartão ou outra forma de pagamento.'
  return 'Pagamento recusado. Tente outro cartão ou outra forma de pagamento.'
}

export function tipoDoCartao(tipoMp: string | null | undefined): 'credito' | 'debito' | null {
  return tipoMp === 'credit_card' ? 'credito' : tipoMp === 'debit_card' ? 'debito' : null
}

/** Cria a "espera" do pagamento (linha pendente, sem id do MP até a 1ª tentativa). Idempotente por pedido. */
export async function prepararCartao(admin: SupabaseClient, p: { restauranteId: string; pedidoId: string; contexto?: ContextoCompra | null }) {
  const { data: ped } = await admin.from('pedidos').select('id, total, status').eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!ped || ped.status !== 'aguardando_pagamento') throw new Error('pedido_nao_aguarda_pagamento')
  const { data: ja } = await admin.from('pagamentos_online').select('valor, expira_em').eq('pedido_id', ped.id).eq('status', 'pendente').maybeSingle()
  const loja = await cartaoOnlineDaLoja(admin, p.restauranteId)
  if (ja) return { valor: Number(ja.valor), expiraEm: String(ja.expira_em), publicKey: loja.publicKey, parcelasMax: loja.parcelasMax }
  const expiraEm = new Date(Date.now() + PRAZO_CARTAO_MIN * 60_000).toISOString()
  const { error } = await admin.from('pagamentos_online').insert({
    restaurante_id: p.restauranteId, pedido_id: ped.id, valor: Number(ped.total), status: 'pendente', metodo: 'cartao', expira_em: expiraEm, contexto: p.contexto ?? null,
  })
  if (error && error.code !== '23505') throw error
  return { valor: Number(ped.total), expiraEm, publicKey: loja.publicKey, parcelasMax: loja.parcelasMax }
}

export type RespostaPagamento = { resultado: ResultadoCartao | 'expirado' | 'ja_pago'; mensagem: string | null }

/** Uma tentativa de pagamento com o token do Brick. Valor = total do pedido NO BANCO. */
export async function pagarComCartao(admin: SupabaseClient, p: { restauranteId: string; pedidoId: string; dados: DadosCartao }): Promise<RespostaPagamento> {
  const [{ data: ped }, { data: reg }, { data: loja }] = await Promise.all([
    admin.from('pedidos').select('id, numero, total, status').eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).maybeSingle(),
    admin.from('pagamentos_online').select('*').eq('pedido_id', p.pedidoId).eq('restaurante_id', p.restauranteId).in('status', ['pendente', 'verificacao_pendente', 'pago']).order('criado_em', { ascending: false }).limit(1).maybeSingle(),
    admin.from('restaurantes').select('nome').eq('id', p.restauranteId).maybeSingle(),
  ])
  if (!ped || !reg || !ehCartao(reg)) return { resultado: 'expirado', mensagem: 'Este pedido não está esperando pagamento com cartão.' }
  if (reg.status === 'pago' || ped.status !== 'aguardando_pagamento') return { resultado: reg.status === 'pago' ? 'ja_pago' : 'expirado', mensagem: reg.status === 'pago' ? null : 'O prazo para pagar este pedido acabou. Faça o pedido de novo.' }
  if (Date.parse(reg.expira_em) < Date.now()) return { resultado: 'expirado', mensagem: 'O prazo para pagar este pedido acabou. Faça o pedido de novo.' }
  const tentativa = Number(reg.tentativas ?? 0) + 1
  if (tentativa > 6) return { resultado: 'recusado', mensagem: 'Muitas tentativas. Escolha outra forma de pagamento.' }
  const corpo: PagamentoCartao = {
    valor: Number(ped.total), token: p.dados.token, metodoId: p.dados.metodoId, emissorId: p.dados.emissorId, parcelas: p.dados.parcelas,
    descricao: `Pedido #${ped.numero} - ${String(loja?.nome ?? 'Menuzia').slice(0, 60)}`, referencia: ped.id,
    email: p.dados.email || `pedido-${ped.id.slice(0, 8)}@pagamentos.menuzia.com.br`, documento: p.dados.documento,
    notificacaoUrl: webhookUrlMp(), idempotencia: `cartao:${reg.id}:${tentativa}`,
  }
  let pg
  try {
    pg = await comTokenDaLoja(admin, p.restauranteId, (token) => provedorMp().pagarCartao(token, corpo))
  } catch (e) {
    await admin.from('pagamentos_online').update({ tentativas: tentativa, erro: e instanceof ErroMp ? `MP ${e.status}` : 'falha ao falar com o MP', atualizado_em: new Date().toISOString() }).eq('id', reg.id)
    // 400 do MP aqui é dado do cartão inválido/token vencido: o cliente tenta de novo.
    return { resultado: 'recusado', mensagem: e instanceof ErroMp && e.status === 400 ? 'Não foi possível usar este cartão. Confira os dados e tente de novo.' : 'O Mercado Pago não respondeu. Tente de novo em instantes.' }
  }
  await admin.from('pagamentos_online').update({
    mp_payment_id: pg.id, status_mp: pg.status, tentativas: tentativa, parcelas: pg.parcelas ?? p.dados.parcelas, cartao_bandeira: (pg.metodo ?? p.dados.metodoId).slice(0, 40),
    cartao_final: pg.cartaoFinal && /^[0-9]{4}$/.test(pg.cartaoFinal) ? pg.cartaoFinal : null, cartao_tipo: tipoDoCartao(pg.tipo), erro: null, atualizado_em: new Date().toISOString(),
  }).eq('id', reg.id)
  const resultado = resultadoDoStatus(pg.status)
  if (resultado === 'aprovado') {
    // A MESMA conferência do webhook: só libera se bater tudo.
    const c = await conferirPagamento(admin, pg.id, 'cliente')
    if (c === 'confirmado' || c === 'ja_confirmado') return { resultado: 'aprovado', mensagem: null }
    if (c === 'divergente') return { resultado: 'recusado', mensagem: 'Não conseguimos confirmar o pagamento. Fale com a loja.' }
    return { resultado: 'em_analise', mensagem: 'Pagamento em confirmação. Aguarde alguns segundos.' }
  }
  if (resultado === 'recusado') return { resultado, mensagem: mensagemRecusa(pg.statusDetail) }
  return { resultado, mensagem: 'Pagamento em análise pelo banco. Assim que for aprovado, o pedido vai para a loja.' }
}

/** Situação para a tela do cliente (consulta o MP se houver tentativa pendente). */
export async function situacaoCartao(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<RespostaPagamento> {
  const { data: reg } = await admin.from('pagamentos_online').select('mp_payment_id, status, status_mp').eq('pedido_id', pedidoId).eq('restaurante_id', restauranteId).eq('metodo', 'cartao').order('criado_em', { ascending: false }).limit(1).maybeSingle()
  if (!reg) return { resultado: 'expirado', mensagem: null }
  if (reg.status === 'pago') return { resultado: 'aprovado', mensagem: null }
  if (reg.status !== 'pendente' && reg.status !== 'verificacao_pendente') return { resultado: 'expirado', mensagem: 'O prazo para pagar este pedido acabou.' }
  if (reg.mp_payment_id) {
    const c = await conferirPagamento(admin, reg.mp_payment_id, 'cliente')
    if (c === 'confirmado' || c === 'ja_confirmado') return { resultado: 'aprovado', mensagem: null }
    if (c === 'recusado') return { resultado: 'recusado', mensagem: 'Pagamento recusado. Tente outro cartão ou outra forma de pagamento.' }
  }
  return { resultado: 'em_analise', mensagem: null }
}

/**
 * Cliente desistiu do cartão (quer outra forma de pagamento): cancela o pedido que ainda espera o pagamento — só se NÃO houver
 * pagamento aprovado. A vitrine volta ao checkout com a mesma sacola para fazer o pedido com outra forma.
 */
export async function desistirDoCartao(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<'cancelado' | 'pago' | 'nada'> {
  const s = await situacaoCartao(admin, restauranteId, pedidoId)
  if (s.resultado === 'aprovado') return 'pago'
  const { data: mudou } = await admin.from('pedidos').update({
    status: 'cancelado', cancelado_motivo: 'outro', cancelado_observacao: 'Cliente trocou a forma de pagamento (cartão online)', cancelado_por: 'cliente',
    cancelado_em: new Date().toISOString(), reimprimir: false,
  }).eq('id', pedidoId).eq('restaurante_id', restauranteId).eq('status', 'aguardando_pagamento').select('id').maybeSingle()
  await admin.from('pagamentos_online').update({ status: 'cancelado' }).eq('pedido_id', pedidoId).eq('restaurante_id', restauranteId).eq('metodo', 'cartao').in('status', ['pendente', 'verificacao_pendente'])
  if (!mudou) return 'nada'
  await reverterBeneficiosPedidoCancelado(admin, restauranteId, pedidoId).catch(() => null)
  await registrarAuditoria(admin, { restauranteId, usuarioNome: 'Cliente (vitrine)', acao: 'cartao_online.desistiu', entidade: 'pedido', entidadeId: pedidoId, dados: {} })
  return 'cancelado'
}
