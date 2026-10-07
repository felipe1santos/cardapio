import type { SupabaseClient } from '@supabase/supabase-js'
import { comTokenDaLoja, contaPublica, tokenDaLoja, webhookUrlMp } from './contas'
import { ErroMp, mpConfigurado, provedorMp, type PagamentoMp } from './mercadopago'
import { lancar } from '@/lib/financeiro/ledger'
import { criarAlerta } from '@/lib/financeiro/alertas'
import { registrarAuditoria } from '@/lib/auditoria'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { notificarPedido } from '@/lib/whatsapp'
import { enviarPurchaseCapi, type ContextoCompra } from '@/lib/meta-capi'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { conferirAprovacao, type Aprovacao } from '@/lib/financeiro/caixa'

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

function paraCliente(r: Record<string, unknown>, pedidoStatus: string): CobrancaParaCliente {
  return {
    pagamentoId: String(r.id), status: String(r.status), valor: Number(r.valor), qrCode: (r.qr_code as string) ?? null, qrCodeBase64: (r.qr_code_base64 as string) ?? null,
    expiraEm: String(r.expira_em), pedidoStatus,
  }
}

export type ResultadoConferencia =
  | 'confirmado' | 'ja_confirmado' | 'a_devolver' | 'pendente' | 'expirado' | 'recusado' | 'divergente' | 'devolvido' | 'desconhecido' | 'sem_conta' | 'erro_api'

/** Confere TUDO que o MP devolveu contra o registro e o pedido. Puro (testado). */
export function divergencias(pg: PagamentoMp, reg: { pedido_id: string; valor: number; mp_user_id: string | null }, contaUserId: string | null, totalPedido: number): string[] {
  const d: string[] = []
  if (pg.externalReference !== reg.pedido_id) d.push('referencia')
  if (centavos(pg.valor) !== centavos(Number(reg.valor)) || centavos(pg.valor) !== centavos(totalPedido)) d.push('valor')
  if (pg.moeda && pg.moeda !== 'BRL') d.push('moeda')
  const coletorEsperado = contaUserId ?? reg.mp_user_id
  if (!pg.coletorId || !coletorEsperado || pg.coletorId !== coletorEsperado) d.push('coletor')
  if (pg.metodo && pg.metodo !== 'pix') d.push('metodo')
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
  const { data: ped } = await admin.from('pedidos').select('id, numero, status, total, restaurante_id, tipo, agendado_para').eq('id', reg.pedido_id).single()
  if (!ped) return 'desconhecido'
  await admin.from('pagamentos_online').update({ status_mp: pg.status, verificacoes: (reg.verificacoes ?? 0) + 1, ultima_verificacao_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }).eq('id', reg.id)

  if (pg.status === 'approved') {
    const div = divergencias(pg, reg, contaUserId, Number(ped.total))
    if (div.length) {
      await admin.from('pagamentos_online').update({ status: 'erro', erro: `não confere: ${div.join(', ')}` }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente'])
      await criarAlerta(admin, { restauranteId: reg.restaurante_id, tipo: 'pix_online_divergente', gravidade: 'grave',
        mensagem: `Pix online do pedido #${ped.numero} NÃO confere (${div.join(', ')}). O pedido não foi liberado.`, dados: { pagamento: reg.id, mp: mpPaymentId, divergencias: div }, dedupeMin: 60, dedupeChave: mpPaymentId })
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
  if (['cancelled', 'rejected', 'expired'].includes(pg.status)) {
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
  const comum = { carteira: 'online' as const, forma: 'pix_online', pedidoId: reg.pedido_id, pagamentoId: reg.id, dados: { mp_payment_id: pg.id } }
  const r = await lancar(admin, {
    restauranteId: reg.restaurante_id, turnoId: await turnoAberto(admin, reg.restaurante_id), chave: `pixonline:${pg.id}`, origem: 'online',
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
  await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: USUARIO_MP.nome, acao: 'pix_online.pago', entidade: 'pedido', entidadeId: ped.id, dados: { mp_payment_id: pg.id, valor: pg.valor, taxa: pg.taxa, origem } })
  // Agora sim: o que antes saía na criação do pedido.
  notificarPedido(admin, ped.id, 'recebido').catch(() => null)
  if (!ped.agendado_para) avisarPainelPedidoNovo(admin, reg.restaurante_id, { id: ped.id, numero: ped.numero, canal: ped.tipo }).catch(() => null)
  const ctx = (reg.contexto ?? {}) as Partial<ContextoCompra>
  enviarPurchaseCapi(admin, reg.restaurante_id, ped.id, { ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, fbp: ctx.fbp ?? null, fbc: ctx.fbc ?? null, url: ctx.url ?? null }).catch(() => null)
  return 'confirmado'
}

async function pagoDepoisDeCancelado(admin: SupabaseClient, reg: Reg, pg: PagamentoMp, ped: Reg, origem: string): Promise<ResultadoConferencia> {
  await admin.from('pagamentos_online').update({ status: 'a_devolver', pago_em: pg.aprovadoEm ?? new Date().toISOString(), taxa: pg.taxa, liquido: pg.liquido }).eq('id', reg.id)
  await lancarRecebimento(admin, reg, pg, `Pix pago depois de ${ped.status === 'cancelado' ? 'cancelado' : 'expirado'} — a devolver`)
  await criarAlerta(admin, { restauranteId: reg.restaurante_id, tipo: 'pix_online_a_devolver', gravidade: 'grave',
    mensagem: `Pix de R$ ${Number(pg.valor).toFixed(2).replace('.', ',')} do pedido #${ped.numero} caiu DEPOIS de cancelado. Devolva em Integrações › Mercado Pago.`,
    dados: { pagamento: reg.id, mp_payment_id: pg.id, pedido: ped.id }, dedupeMin: 24 * 60, dedupeChave: pg.id })
  await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: USUARIO_MP.nome, acao: 'pix_online.pago_apos_cancelado', entidade: 'pedido', entidadeId: ped.id, dados: { mp_payment_id: pg.id, valor: pg.valor, origem } })
  return 'a_devolver'
}

/** Cancela o pedido que não foi pago no prazo: MP cancelado, benefícios devolvidos, cliente avisado. */
async function expirarPedido(admin: SupabaseClient, reg: Reg, ped: Reg) {
  const { data: mudou } = await admin.from('pedidos').update({
    status: 'cancelado', cancelado_motivo: 'pix_expirado', cancelado_observacao: 'Pix online não pago no prazo', cancelado_por: 'sistema',
    cancelado_em: new Date().toISOString(), reimprimir: false,
  }).eq('id', ped.id).eq('status', 'aguardando_pagamento').select('id').maybeSingle()
  await admin.from('pagamentos_online').update({ status: 'expirado' }).eq('id', reg.id).in('status', ['pendente', 'verificacao_pendente'])
  if (!mudou) return
  await reverterBeneficiosPedidoCancelado(admin, reg.restaurante_id, ped.id)
  notificarPedido(admin, ped.id, 'cancelado').catch(() => null)
  await registrarAuditoria(admin, { restauranteId: reg.restaurante_id, usuarioNome: 'Sistema', acao: 'pix_online.expirado', entidade: 'pedido', entidadeId: ped.id, dados: { pagamento: reg.id } })
}

/**
 * Verificação periódica (cron, a cada minuto): consulta as pendentes (rede de segurança se o webhook
 * falhar), expira as vencidas — CONSULTANDO antes (pode ter sido pago no último segundo) — e renova
 * tokens perto de vencer.
 */
export async function verificarPendentes(admin: SupabaseClient, opcoes: { limite?: number } = {}) {
  const resumo = { consultadas: 0, confirmadas: 0, expiradas: 0, a_devolver: 0, erros: 0, renovadas: 0 }
  const agora = Date.now()
  const { data: pend } = await admin.from('pagamentos_online').select('id, mp_payment_id, restaurante_id, pedido_id, expira_em, status')
    .in('status', ['pendente', 'verificacao_pendente']).order('criado_em').limit(opcoes.limite ?? 200)
  for (const reg of pend ?? []) {
    if (!reg.mp_payment_id) continue
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
}): Promise<ResultadoDevolucao> {
  const motivo = p.motivo?.trim()
  if (!motivo || motivo.length < 3) return { ok: false, erro: 'Escreva o motivo da devolução.', status: 400 }
  const { data: reg } = await admin.from('pagamentos_online').select('*').eq('id', p.pagamentoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!reg) return { ok: false, erro: 'Pagamento não encontrado.', status: 404 }
  if (!['pago', 'a_devolver'].includes(reg.status)) return { ok: false, erro: 'Só dá para devolver um Pix pago.', status: 409 }
  const apr = await conferirAprovacao(admin, { restauranteId: p.restauranteId, solicitante: p.solicitante, aprovacao: p.aprovacao, acao: 'pix_online_devolver', valorCentavos: centavos(Number(reg.valor)), motivo, contexto: { pagamento: reg.id, pedido: reg.pedido_id } })
  if (!apr.ok) return { ok: false, erro: apr.erro, status: apr.status }
  let reembolso
  try {
    reembolso = await comTokenDaLoja(admin, p.restauranteId, (t) => provedorMp().reembolsar(t, reg.mp_payment_id, `devolucao:${reg.id}`))
  } catch (e) {
    return { ok: false, erro: e instanceof ErroMp ? `O Mercado Pago recusou a devolução (${e.status}).` : 'Falha ao falar com o Mercado Pago.', status: 502 }
  }
  await admin.from('pagamentos_online').update({
    status: 'devolvido', devolucao_id: reembolso.id, devolvido_em: new Date().toISOString(), devolucao_pedida_por: p.solicitante.nome,
    aprovado_por_nome: apr.aprovadorNome, motivo_devolucao: motivo.slice(0, 300),
  }).eq('id', reg.id)
  const { data: loja } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', p.restauranteId).maybeSingle()
  if (loja?.financeiro_ativo) {
    const { data: original } = await admin.from('fin_lancamentos').select('id').eq('restaurante_id', p.restauranteId).eq('chave_idempotencia', `pixonline:${reg.mp_payment_id}`).eq('linha', 1).maybeSingle()
    await lancar(admin, {
      restauranteId: p.restauranteId, turnoId: await turnoAberto(admin, p.restauranteId), chave: `pixonline-devolucao:${reg.mp_payment_id}`, origem: 'online',
      usuario: { id: p.solicitante.id, nome: p.solicitante.nome }, motivo, aprovacao: { id: apr.id, nome: apr.aprovadorNome },
      linhas: [{ carteira: 'online', tipo: 'estorno', valorCentavos: -centavos(Number(reg.valor)), forma: 'pix_online', pedidoId: reg.pedido_id, pagamentoId: reg.id, referenciaId: original?.id ?? null, dados: { mp_payment_id: reg.mp_payment_id, devolucao_id: reembolso.id } }],
    })
  }
  await registrarAuditoria(admin, { restauranteId: p.restauranteId, usuarioId: p.solicitante.id, usuarioNome: p.solicitante.nome, acao: 'pix_online.devolvido', entidade: 'pagamento_online', entidadeId: reg.id,
    dados: { valor: reg.valor, motivo, aprovado_por: apr.aprovadorNome, devolucao_id: reembolso.id, pedido: reg.pedido_id } })
  return { ok: true, devolucaoId: reembolso.id }
}
