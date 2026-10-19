/**
 * Agente de IA — pedido JÁ criado: trocar a forma de pagamento, cancelar ou mudar (pedido do dono, 12/10).
 *
 *  - Pix online ainda NÃO pago (fora da cozinha): cartão/dinheiro → cancela a cobrança no Mercado Pago e manda para o
 *    Kanban; cancelar → cancela a cobrança e o pedido. Pix já pago: nunca troca (atendente).
 *  - Recebido e ainda não aceito: troca a forma (cartão ↔ dinheiro, ou para Pix). Papel já impresso → reimprime com a
 *    forma certa; para Pix online, só se não saiu papel (senão a cozinha prepara um pedido que ainda não foi pago).
 *  - No Kanban (cancelar, itens, endereço) ou já aceito (qualquer mudança): a IA NÃO faz — chama atendente, com o motivo
 *    ("Cancelamento do pedido #X" / "Alteração do pedido #X"); robô e IA ficam pausados na conversa.
 *  - Pix expirado (pedido cancelado pelo prazo): remonta o MESMO pedido com a forma nova e manda o resumo (precisa do "sim").
 * A regra é do SERVIDOR (planoAlteracao, puro e testado); a IA só diz o que o cliente quer.
 */
import { cancelarCobrancaPendente, criarCobrancaPix } from '@/lib/pagamentos/pix-online'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { registrarAuditoria } from '@/lib/auditoria'
import { notificarPedido } from '@/lib/whatsapp'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { variantesTelefone } from '@/lib/mensageria/robo'
import { brl, type DadosLojaAuto } from '@/lib/robo-auto/respostas'
import type { FormaPagamento } from '@/lib/queries/pedidos'
import { calcularPedido, type Carrinho, type ContextoPedido } from './pedido'

export type AcaoPosPedido = 'trocar_pagamento' | 'cancelar' | 'alterar_itens' | 'alterar_endereco' | 'outro'
export const ACOES_POS_PEDIDO: AcaoPosPedido[] = ['trocar_pagamento', 'cancelar', 'alterar_itens', 'alterar_endereco', 'outro']

export interface PedidoPos {
  id: string; numero: number; status: string; forma_pagamento: string; pago: boolean; pagamento_online: boolean; impresso: boolean
  cancelado_motivo: string | null; total: number
}

export type PlanoAlteracao =
  | { tipo: 'atendente'; motivo: string }
  /** 18/10: registra a solicitação para a loja aplicar/recusar no card (ou cancela sozinho em Recebido não pago online). */
  | { tipo: 'solicitacao'; tipoSol: 'alterar' | 'cancelar' }
  | { tipo: 'pix_para_entrega' }
  | { tipo: 'cancelar_pix_pendente' }
  | { tipo: 'trocar_simples'; reimprimir: boolean }
  | { tipo: 'para_pix_online' }
  | { tipo: 'remontar' }
  | { tipo: 'info'; texto: string }

/** O que fazer com o pedido criado. Puro. */
export function planoAlteracao(p: PedidoPos, acao: AcaoPosPedido, pagamento: FormaPagamento | undefined, loja: { pixOnline: boolean; pixChave: boolean }, editavel = false): PlanoAlteracao {
  const alteracao = { tipo: 'atendente' as const, motivo: `Alteração do pedido #${p.numero}` }
  // Solicitações (18/10): pedido ainda não despachado → itens/endereço/outro viram solicitação para a loja; cancelar fora
  // do Pix pendente também (automático em Recebido não pago online — decidido em abrirSolicitacao).
  if (editavel && p.status !== 'cancelado' && p.status !== 'entregue') {
    if (acao === 'cancelar' && p.status !== 'aguardando_pagamento') return { tipo: 'solicitacao', tipoSol: 'cancelar' }
    if (acao === 'alterar_itens' || acao === 'alterar_endereco' || acao === 'outro') return { tipo: 'solicitacao', tipoSol: 'alterar' }
  }
  if (p.status === 'cancelado') {
    if (p.cancelado_motivo === 'pix_expirado' && acao === 'trocar_pagamento' && pagamento) return { tipo: 'remontar' }
    return { tipo: 'info', texto: `O pedido #${p.numero} está cancelado. Se o cliente quiser, monte um pedido novo.` }
  }
  if (p.status === 'entregue') return acao === 'cancelar' ? { tipo: 'atendente', motivo: `Cancelamento do pedido #${p.numero}` } : alteracao
  if (acao === 'cancelar') {
    return p.status === 'aguardando_pagamento' ? { tipo: 'cancelar_pix_pendente' } : { tipo: 'atendente', motivo: `Cancelamento do pedido #${p.numero}` }
  }
  if (acao !== 'trocar_pagamento' || !pagamento) return alteracao
  if (p.status === 'aguardando_pagamento') {
    return pagamento === 'pix' ? { tipo: 'info', texto: 'O pedido já é no Pix; o código enviado continua valendo até o prazo.' } : { tipo: 'pix_para_entrega' }
  }
  if (p.pagamento_online && p.pago) return { tipo: 'atendente', motivo: `Alteração do pedido #${p.numero} (Pix já pago)` }
  if (p.status !== 'recebido') return alteracao
  if (pagamento === p.forma_pagamento && pagamento !== 'dinheiro') return { tipo: 'info', texto: `O pedido #${p.numero} já está nessa forma de pagamento.` }
  if (pagamento === 'pix') {
    if (loja.pixOnline) return p.impresso ? alteracao : { tipo: 'para_pix_online' }
    if (!loja.pixChave) return { tipo: 'info', texto: 'A loja não aceita Pix. Ofereça cartão na entrega ou dinheiro.' }
  }
  return { tipo: 'trocar_simples', reimprimir: p.impresso }
}

export const TEXTO_CHAMEI_ATENDENTE = 'Vou chamar alguém da loja pra te ajudar com isso, só um instante 🙏'
const TIPOS_CHAVE: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', telefone: 'telefone', email: 'e-mail', aleatoria: 'chave aleatória' }

function rotulo(pagamento: FormaPagamento, troco: number | null): string {
  if (pagamento === 'cartao') return 'Cartão na entrega'
  if (pagamento === 'dinheiro') return troco ? `Dinheiro (troco para ${brl(troco)})` : 'Dinheiro (sem troco)'
  return 'Pix'
}

export interface ResultadoAlteracao {
  /** Para a IA (JSON curto). */
  conteudo: string
  erro?: boolean
  /** Mensagens do SERVIDOR ao cliente (a IA não escreve mais nada). */
  mensagens?: string[]
  resumo?: string
  atendente?: string
}

export interface ContextoAlteracao extends ContextoPedido { loja: DadosLojaAuto }

const COLUNAS = 'id, numero, status, forma_pagamento, pago, pagamento_online, impresso, cancelado_motivo, total, tipo, agendado_para'

/** Pedido do número informado (só deste telefone) ou o último criado nesta conversa pela IA. */
async function acharPedido(ctx: ContextoAlteracao, numero: number | null): Promise<(PedidoPos & { tipo: string; agendado_para: string | null }) | null> {
  let q = ctx.admin.from('pedidos').select(COLUNAS).eq('restaurante_id', ctx.restauranteId)
  if (numero) q = q.eq('numero', numero).in('cliente_telefone', variantesTelefone(ctx.telefone))
  else {
    const { data: conv } = await ctx.admin.from('whatsapp_conversas').select('ia_pedido_id').eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId).maybeSingle()
    const id = (conv as { ia_pedido_id?: string | null } | null)?.ia_pedido_id
    if (!id) return null
    q = q.eq('id', id)
  }
  const { data } = await q.order('criado_em', { ascending: false }).limit(1)
  const p = ((data ?? []) as Record<string, unknown>[])[0]
  return p ? { ...(p as unknown as PedidoPos & { tipo: string; agendado_para: string | null }), total: Number(p.total), pago: p.pago === true, pagamento_online: p.pagamento_online === true, impresso: p.impresso === true } : null
}

const auditar = (ctx: ContextoAlteracao, p: PedidoPos, acao: string, dados: Record<string, unknown>) =>
  registrarAuditoria(ctx.admin, { restauranteId: ctx.restauranteId, usuarioNome: 'Agente de IA (WhatsApp)', acao, entidade: 'pedido', entidadeId: p.id, dados: { numero: p.numero, conversa: ctx.conversaId, ...dados } }).catch(() => null)

export async function alterarPedidoFeito(ctx: ContextoAlteracao, input: Record<string, unknown>): Promise<ResultadoAlteracao> {
  const acao = (ACOES_POS_PEDIDO as string[]).includes(String(input.acao)) ? (input.acao as AcaoPosPedido) : 'outro'
  const pagamento = input.pagamento === 'pix' || input.pagamento === 'cartao' || input.pagamento === 'dinheiro' ? input.pagamento : undefined
  const numero = Number.isInteger(Number(input.numero)) && Number(input.numero) > 0 ? Number(input.numero) : null
  const p = await acharPedido(ctx, numero)
  if (!p) return { conteudo: 'Não achei esse pedido deste cliente. Pergunte o número do pedido.', erro: true }

  let troco: number | null = null
  if (pagamento === 'dinheiro') {
    if (input.troco_para === undefined || input.troco_para === null || input.troco_para === '') return { conteudo: 'Antes, pergunte ao cliente se precisa de troco e para quanto (troco_para; 0 = sem troco).', erro: true }
    const t = Number(input.troco_para)
    troco = Number.isFinite(t) && t > 0 ? Math.round(t * 100) / 100 : null
    if (troco !== null && troco < p.total) return { conteudo: `O troco tem que ser para um valor maior que o total (${brl(p.total)}). Pergunte de novo.`, erro: true }
  }

  const { pedidoEditavel } = await import('@/lib/pedido-editavel')
  const { corridaAtivaDoPedido } = await import('@/lib/entregas/queries')
  const { data: pe } = await ctx.admin.from('pedidos').select('canal, entregador_id, saiu_para_entrega_em, origem_canal').eq('id', p.id).maybeSingle()
  const editavel = !!pe && pedidoEditavel({ status: p.status, canal: pe.canal, entregadorId: pe.entregador_id, saiuParaEntregaEm: pe.saiu_para_entrega_em, origemCanal: pe.origem_canal }, !!(await corridaAtivaDoPedido(ctx.admin, p.id).catch(() => null))).ok
  const plano = planoAlteracao(p, acao, pagamento, { pixOnline: ctx.pixOnlineAtivo, pixChave: !!ctx.loja.pixChave }, editavel)
  const atendente = (motivo: string): ResultadoAlteracao => ({
    conteudo: JSON.stringify({ ok: true, aviso: 'O sistema chamou um atendente e avisou o cliente. Não escreva mais nada.' }),
    mensagens: [TEXTO_CHAMEI_ATENDENTE], atendente: motivo,
  })
  const pronto = (mensagens: string[]): ResultadoAlteracao => ({ conteudo: JSON.stringify({ ok: true, aviso: 'O sistema já confirmou ao cliente. Não escreva mais nada.' }), mensagens })

  switch (plano.tipo) {
    case 'info':
      return { conteudo: JSON.stringify({ ok: false, aviso: plano.texto }) }
    case 'atendente':
      return atendente(plano.motivo)
    case 'solicitacao': {
      const { abrirSolicitacao } = await import('@/lib/pedidos/solicitacoes')
      const detalhes = String(input.detalhes ?? '').trim().slice(0, 1000)
      if (plano.tipoSol === 'alterar' && !detalhes) return { conteudo: 'Pergunte ao cliente exatamente o que ele quer mudar e chame de novo com `detalhes`.', erro: true }
      // Itens a adicionar (ids do cardápio) viram proposta estruturada; o preço é do servidor na hora de aplicar.
      const adicionar = Array.isArray(input.adicionar) ? (input.adicionar as { item_id?: unknown; quantidade?: unknown; observacao?: unknown }[])
        .filter((a) => typeof a.item_id === 'string' && /^[0-9a-f-]{36}$/i.test(a.item_id) && Number.isFinite(Number(a.quantidade)) && Number(a.quantidade) >= 1)
        .map((a) => ({ itemId: a.item_id as string, quantidade: Math.min(99, Math.floor(Number(a.quantidade))), observacao: String(a.observacao ?? '').slice(0, 200), complementos: [] })) : []
      const r = await abrirSolicitacao(ctx.admin, { restauranteId: ctx.restauranteId, pedidoId: p.id, origem: 'ia', tipo: plano.tipoSol, texto: detalhes || (plano.tipoSol === 'cancelar' ? 'Cliente pediu para cancelar' : ''), proposta: adicionar.length ? { itens: { adicionar } } : null, conversaId: ctx.conversaId })
      return pronto([r.mensagem])
    }
    case 'cancelar_pix_pendente': {
      const c = await cancelarCobrancaPendente(ctx.admin, ctx.restauranteId, p.id)
      if (c === 'paga' || c === 'erro') return atendente(`Cancelamento do pedido #${p.numero}${c === 'paga' ? ' (Pix já pago)' : ''}`)
      const { data: mudou, error: erroUpd } = await ctx.admin.from('pedidos').update({
        status: 'cancelado', cancelado_motivo: 'cliente_desistiu', cancelado_observacao: 'Cliente cancelou pelo WhatsApp (Pix não pago)', cancelado_por: 'Agente de IA',
        cancelado_em: new Date().toISOString(), reimprimir: false,
      }).eq('id', p.id).eq('status', 'aguardando_pagamento').select('id').maybeSingle()
      if (!mudou) { if (erroUpd) console.error('[agente-ia] alterar pedido:', erroUpd.message?.slice(0, 160)); return atendente(`Cancelamento do pedido #${p.numero}`) }
      await reverterBeneficiosPedidoCancelado(ctx.admin, ctx.restauranteId, p.id).catch(() => null)
      await auditar(ctx, p, 'pedido.cancelado_ia', { motivo: 'pix_nao_pago' })
      return pronto([`Pronto, cancelei o pedido #${p.numero} e esse Pix não vale mais. Se quiser pedir de novo, é só falar 😊`])
    }
    case 'pix_para_entrega': {
      const c = await cancelarCobrancaPendente(ctx.admin, ctx.restauranteId, p.id)
      if (c === 'paga') return atendente(`Alteração do pedido #${p.numero} (Pix já pago)`)
      if (c === 'erro') return atendente(`Alteração do pedido #${p.numero}`)
      const { data: mudou, error: erroUpd } = await ctx.admin.from('pedidos').update({
        status: 'recebido', pagamento_online: false, pago: false, forma_pagamento: pagamento, cartao_tipo: null, troco_para: troco,
      }).eq('id', p.id).eq('status', 'aguardando_pagamento').select('id').maybeSingle()
      if (!mudou) { if (erroUpd) console.error('[agente-ia] alterar pedido:', erroUpd.message?.slice(0, 160)); return atendente(`Alteração do pedido #${p.numero}`) }
      // Agora entra na cozinha: os mesmos avisos de quando o Pix é confirmado.
      notificarPedido(ctx.admin, p.id, 'recebido').catch(() => null)
      if (!p.agendado_para) avisarPainelPedidoNovo(ctx.admin, ctx.restauranteId, { id: p.id, numero: p.numero, canal: p.tipo }).catch(() => null)
      await auditar(ctx, p, 'pedido.pagamento_alterado', { de: 'Pix online (não pago)', para: rotulo(pagamento!, troco) })
      return pronto([`Pronto! Troquei para *${rotulo(pagamento!, troco)}* e o pedido #${p.numero} já foi pra cozinha 👍`])
    }
    case 'trocar_simples': {
      const { data: mudou, error: erroUpd } = await ctx.admin.from('pedidos').update({
        forma_pagamento: pagamento, cartao_tipo: null, troco_para: troco, pago: pagamento === 'pix', ...(plano.reimprimir ? { reimprimir: true } : {}),
      }).eq('id', p.id).eq('status', 'recebido').eq('pagamento_online', false).select('id').maybeSingle()
      if (!mudou) { if (erroUpd) console.error('[agente-ia] alterar pedido:', erroUpd.message?.slice(0, 160)); return atendente(`Alteração do pedido #${p.numero}`) }
      await auditar(ctx, p, 'pedido.pagamento_alterado', { de: p.forma_pagamento, para: rotulo(pagamento!, troco), reimprimir: plano.reimprimir })
      const msgs = [`Pronto! O pedido #${p.numero} agora é no *${rotulo(pagamento!, troco)}* 👍`]
      if (pagamento === 'pix' && ctx.loja.pixChave) {
        msgs[0] += `\n\nChave Pix (${TIPOS_CHAVE[ctx.loja.pixTipo ?? ''] ?? 'Pix'}) na próxima mensagem 👇`
        msgs.push(ctx.loja.pixChave)
      }
      return pronto(msgs)
    }
    case 'para_pix_online': {
      const { data: mudou, error: erroUpd } = await ctx.admin.from('pedidos').update({ status: 'aguardando_pagamento', pagamento_online: true, pago: false, forma_pagamento: 'pix', cartao_tipo: null, troco_para: null })
        .eq('id', p.id).eq('status', 'recebido').eq('impresso', false).select('id').maybeSingle()
      if (!mudou) { if (erroUpd) console.error('[agente-ia] alterar pedido:', erroUpd.message?.slice(0, 160)); return atendente(`Alteração do pedido #${p.numero}`) }
      try {
        const pix = await criarCobrancaPix(ctx.admin, { restauranteId: ctx.restauranteId, pedidoId: p.id })
        if (!pix.qrCode) throw new Error('sem_qr')
        await auditar(ctx, p, 'pedido.pagamento_alterado', { de: p.forma_pagamento, para: 'Pix online' })
        const ate = new Date(pix.expiraEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
        return pronto([`Pronto! Troquei para Pix. O pedido #${p.numero} vai pra cozinha assim que o Pix for pago (vale até ${ate}). Copie o código abaixo 👇`, pix.qrCode])
      } catch (e) {
        // Não gerou o Pix: o pedido volta como estava (não pode sumir da cozinha).
        console.error('[agente-ia] trocar para Pix online:', (e as Error).message?.slice(0, 120))
        await ctx.admin.from('pedidos').update({ status: 'recebido', pagamento_online: false, forma_pagamento: p.forma_pagamento, pago: p.pago }).eq('id', p.id).eq('status', 'aguardando_pagamento')
        return atendente(`Alteração do pedido #${p.numero}`)
      }
    }
    case 'remontar': {
      const { data: conv } = await ctx.admin.from('whatsapp_conversas').select('ia_carrinho').eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId).maybeSingle()
      const salvo = (conv as { ia_carrinho?: { carrinho?: Carrinho } | null } | null)?.ia_carrinho?.carrinho
      if (!salvo) return { conteudo: 'O pedido anterior não está mais guardado. Monte de novo com consultar_cardapio e montar_pedido.', erro: true }
      const carrinho: Carrinho = { ...salvo, pagamento: pagamento!, trocoPara: troco }
      const resumo = await calcularPedido(ctx, carrinho)
      await ctx.admin.from('whatsapp_conversas').update({ ia_carrinho: { carrinho, hash: resumo.hash }, ia_resumo_em: new Date().toISOString() })
        .eq('id', ctx.conversaId).eq('restaurante_id', ctx.restauranteId)
      return { conteudo: JSON.stringify({ ok: true, total: brl(resumo.total), aviso: 'O sistema enviou o resumo do pedido de novo. Espere o cliente confirmar e então chame criar_pedido.' }), resumo: resumo.texto }
    }
  }
}
