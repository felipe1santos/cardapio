import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAuditoria } from '@/lib/auditoria'
import { enfileirar } from '@/lib/mensageria/fila'
import { corridaAtivaDoPedido } from '@/lib/entregas/queries'
import { clientePodeSolicitar, pedidoEditavel, TEXTO_NAO_EDITAVEL } from '@/lib/pedido-editavel'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { cancelarPedidoDelivery } from './cancelar'
import { EdicaoError, editarPedido, type EdicaoPedido } from './editar'

/**
 * Solicitações do cliente pelo WhatsApp (Fase 2, 18/10): o robô e o Agente de IA registram "quero mudar X" /
 * "quero cancelar"; a loja aplica ou recusa pelo card do Kanban. Decisões Q3/Q4/Q9/Q14/Q15/Q18.
 *  - uma PENDENTE por pedido (índice único): mensagem nova do cliente se acrescenta ao texto;
 *  - cancelamento automático só com o pedido em Recebido e não pago online;
 *  - 5 min sem resposta da loja → a conversa pede atendente (amarela na central) e o cliente é avisado (cron whatsapp);
 *  - aplicar = a MESMA rota de edição (editarPedido) / o mesmo cancelamento do painel (cancelarPedidoDelivery).
 */
export const PRAZO_ATENDENTE_MS = 5 * 60_000
export const TEXTO_SOLICITACAO_ANOTADA = 'Anotei! A loja vai confirmar sua alteração em instantes 🙏'
export const TEXTO_CANCELAMENTO_ANOTADO = 'Anotei o pedido de cancelamento. A loja vai confirmar em instantes 🙏'
export const TEXTO_CANCELADO_AUTOMATICO = (numero: number) => `Pronto, cancelei o pedido #${numero}. Se quiser pedir de novo, é só falar 😊`
export const TEXTO_LOJA_AVISADA_SOLICITACAO = 'Já avisamos a loja, um atendente vai te responder 🙏'
export const TEXTO_NAO_PODE_ALTERAR = (texto: string) => `${texto} Se precisar, fale com a loja.`
export const TEXTO_RECUSADA = (numero: number, motivo: string | null) => `A loja não pôde alterar o pedido #${numero}${motivo ? `: ${motivo}` : '.'}`

export interface SolicitacaoLinha {
  id: string; restauranteId: string; pedidoId: string; origem: 'robo' | 'ia'; tipo: 'alterar' | 'cancelar'; texto: string
  proposta: EdicaoPedido | null; status: string; motivoRecusa: string | null; criadoEm: string; escaladaEm: string | null
}
const SELECT = 'id, restaurante_id, pedido_id, origem, tipo, texto, proposta, status, motivo_recusa, criado_em, escalada_em'
const map = (r: Record<string, unknown>): SolicitacaoLinha => ({
  id: String(r.id), restauranteId: String(r.restaurante_id), pedidoId: String(r.pedido_id), origem: r.origem as 'robo' | 'ia', tipo: r.tipo as 'alterar' | 'cancelar',
  texto: String(r.texto ?? ''), proposta: (r.proposta as EdicaoPedido | null) ?? null, status: String(r.status), motivoRecusa: (r.motivo_recusa as string | null) ?? null,
  criadoEm: String(r.criado_em), escaladaEm: (r.escalada_em as string | null) ?? null,
})

export async function buscarSolicitacao(admin: SupabaseClient, id: string): Promise<SolicitacaoLinha | null> {
  const { data } = await admin.from('pedido_solicitacoes').select(SELECT).eq('id', id).maybeSingle()
  return data ? map(data as Record<string, unknown>) : null
}
export async function solicitacaoPendenteDoPedido(admin: SupabaseClient, pedidoId: string): Promise<SolicitacaoLinha | null> {
  const { data } = await admin.from('pedido_solicitacoes').select(SELECT).eq('pedido_id', pedidoId).eq('status', 'pendente').maybeSingle()
  return data ? map(data as Record<string, unknown>) : null
}

type ResultadoAbrir = { ok: true; modo: 'pendente' | 'cancelado_automatico'; mensagem: string; numero: number } | { ok: false; mensagem: string }

/**
 * Cliente pediu alteração/cancelamento. Decide: cancelamento automático (Recebido, não pago online), pendente para a
 * loja (alarme + push do painel), ou "não dá mais" (despachado etc.). Devolve a mensagem que o SERVIDOR manda ao cliente.
 */
export async function abrirSolicitacao(admin: SupabaseClient, p: {
  restauranteId: string; pedidoId: string; origem: 'robo' | 'ia'; tipo: 'alterar' | 'cancelar'; texto: string; proposta?: EdicaoPedido | null; conversaId?: string | null
}): Promise<ResultadoAbrir> {
  const { data: ped } = await admin.from('pedidos').select('id, numero, status, canal, tipo, entregador_id, saiu_para_entrega_em, origem_canal, pago, pagamento_online')
    .eq('id', p.pedidoId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!ped) return { ok: false, mensagem: 'Não achei esse pedido.' }
  const corrida = await corridaAtivaDoPedido(admin, p.pedidoId).catch(() => null)
  const dados = { status: ped.status, canal: ped.canal, entregadorId: ped.entregador_id, saiuParaEntregaEm: ped.saiu_para_entrega_em, origemCanal: ped.origem_canal }
  const pode = p.tipo === 'cancelar' ? clientePodeSolicitar(dados, !!corrida) : pedidoEditavel(dados, !!corrida)
  if (!pode.ok) return { ok: false, mensagem: TEXTO_NAO_PODE_ALTERAR(pode.texto) }

  // Cancelamento automático: ainda ninguém aceitou e não há dinheiro online no meio (Q3).
  if (p.tipo === 'cancelar' && ped.status === 'recebido' && !(ped.pago && ped.pagamento_online)) {
    const r = await cancelarPedidoDelivery(admin, { restauranteId: p.restauranteId, pedidoId: p.pedidoId, motivo: 'cliente_desistiu', observacao: p.texto.slice(0, 300) || 'Cliente cancelou pelo WhatsApp', por: { id: null, nome: p.origem === 'ia' ? 'Agente de IA (WhatsApp)' : 'Robô (WhatsApp)' }, acao: p.origem === 'ia' ? 'pedido.cancelado_ia' : 'pedido.cancelou', canceladoPor: `Cliente (WhatsApp ${p.origem === 'ia' ? 'IA' : 'robô'})` })
    if (r.ok) return { ok: true, modo: 'cancelado_automatico', mensagem: TEXTO_CANCELADO_AUTOMATICO(ped.numero as number), numero: ped.numero as number }
  }

  const texto = p.texto.trim().slice(0, 1000)
  const pendente = await solicitacaoPendenteDoPedido(admin, p.pedidoId)
  if (pendente) {
    await admin.from('pedido_solicitacoes').update({ texto: `${pendente.texto}\n${texto}`.trim().slice(0, 2000), tipo: p.tipo === 'cancelar' ? 'cancelar' : pendente.tipo, ...(p.proposta ? { proposta: p.proposta } : {}) }).eq('id', pendente.id)
  } else {
    const { error } = await admin.from('pedido_solicitacoes').insert({ restaurante_id: p.restauranteId, pedido_id: p.pedidoId, origem: p.origem, tipo: p.tipo, texto, proposta: p.proposta ?? null })
    if (error && error.code !== '23505') throw error
  }
  await registrarAuditoria(admin, { restauranteId: p.restauranteId, usuarioNome: p.origem === 'ia' ? 'Agente de IA (WhatsApp)' : 'Robô (WhatsApp)', acao: 'pedido.solicitacao_cliente', entidade: 'pedido', entidadeId: p.pedidoId, dados: { numero: ped.numero, tipo: p.tipo, texto } }).catch(() => {})
  // Alarme/push do painel: o mesmo aviso de pedido novo, com o rótulo da solicitação.
  avisarPainelPedidoNovo(admin, p.restauranteId, { id: p.pedidoId, numero: ped.numero as number, canal: ped.tipo as string }).catch(() => null)
  return { ok: true, modo: 'pendente', mensagem: p.tipo === 'cancelar' ? TEXTO_CANCELAMENTO_ANOTADO : TEXTO_SOLICITACAO_ANOTADA, numero: ped.numero as number }
}

async function avisarCliente(admin: SupabaseClient, restauranteId: string, pedidoId: string, chave: string, texto: string) {
  const { data: ped } = await admin.from('pedidos').select('cliente_telefone').eq('id', pedidoId).maybeSingle()
  const tel = String(ped?.cliente_telefone ?? '').replace(/\D/g, '')
  if (!tel) return
  const { data: conv } = await admin.from('whatsapp_conversas').select('id').eq('restaurante_id', restauranteId).in('telefone', [tel, tel.startsWith('55') ? tel : `55${tel}`]).order('ultima_atividade_em', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  await enfileirar(admin, { restauranteId, chave, tipo: 'ia', telefone: tel.startsWith('55') ? tel : `55${tel}`, texto, conversaId: (conv?.id as string | undefined) ?? null, pedidoId }).catch(() => null)
}

/** Loja aplicou: edita (proposta) ou cancela pela mesma regra do painel. Sem proposta estruturada, a loja edita à mão. */
export async function aplicarSolicitacao(admin: SupabaseClient, s: SolicitacaoLinha, por: { id: string | null; nome: string }, edicao?: EdicaoPedido): Promise<{ ok: true; mudancas: string[] } | { ok: false; erro: string; status: number; codigo?: string }> {
  if (s.status !== 'pendente') return { ok: false, erro: 'Esta solicitação já foi decidida.', status: 409 }
  let mudancas: string[] = []
  if (s.tipo === 'cancelar') {
    const r = await cancelarPedidoDelivery(admin, { restauranteId: s.restauranteId, pedidoId: s.pedidoId, motivo: 'cliente_desistiu', observacao: s.texto.slice(0, 300) || 'Cliente pediu pelo WhatsApp', por, acao: 'pedido.cancelou', canceladoPor: `Cliente (WhatsApp ${s.origem === 'ia' ? 'IA' : 'robô'}) · aplicado por ${por.nome}` })
    if (!r.ok) return r
    mudancas = ['Pedido cancelado a pedido do cliente']
  } else {
    const corpo = edicao ?? s.proposta
    if (!corpo) return { ok: false, erro: 'Esta solicitação não tem mudança estruturada: use o lápis para editar o pedido e depois marque como aplicada.', status: 409, codigo: 'sem_proposta' }
    try {
      const r = await editarPedido(admin, { restauranteId: s.restauranteId, pedidoId: s.pedidoId, por, origem: 'solicitacao', via: s.origem, edicao: { ...corpo, reimprimir: corpo.reimprimir ?? true } })
      mudancas = r.mudancas
    } catch (e) {
      if (e instanceof EdicaoError) return { ok: false, erro: e.message, status: e.status, codigo: e.codigo }
      throw e
    }
  }
  await admin.from('pedido_solicitacoes').update({ status: 'aplicada', decidido_por_nome: por.nome, decidido_em: new Date().toISOString() }).eq('id', s.id)
  await registrarAuditoria(admin, { restauranteId: s.restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: 'pedido.solicitacao_aplicada', entidade: 'pedido', entidadeId: s.pedidoId, dados: { tipo: s.tipo, texto: s.texto, mudancas } }).catch(() => {})
  return { ok: true, mudancas }
}

/** Loja marcou como feita à mão (editou pelo lápis) — fecha a solicitação sem mexer no pedido. */
export async function concluirSolicitacao(admin: SupabaseClient, s: SolicitacaoLinha, por: { id: string | null; nome: string }): Promise<void> {
  await admin.from('pedido_solicitacoes').update({ status: 'aplicada', decidido_por_nome: por.nome, decidido_em: new Date().toISOString() }).eq('id', s.id).eq('status', 'pendente')
}

export async function recusarSolicitacao(admin: SupabaseClient, s: SolicitacaoLinha, por: { id: string | null; nome: string }, motivo: string | null): Promise<void> {
  const { data: ped } = await admin.from('pedidos').select('numero').eq('id', s.pedidoId).maybeSingle()
  await admin.from('pedido_solicitacoes').update({ status: 'recusada', motivo_recusa: motivo?.slice(0, 300) ?? null, decidido_por_nome: por.nome, decidido_em: new Date().toISOString() }).eq('id', s.id).eq('status', 'pendente')
  await registrarAuditoria(admin, { restauranteId: s.restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: 'pedido.solicitacao_recusada', entidade: 'pedido', entidadeId: s.pedidoId, dados: { tipo: s.tipo, texto: s.texto, motivo } }).catch(() => {})
  await avisarCliente(admin, s.restauranteId, s.pedidoId, `solicitacao_recusada:${s.id}`, TEXTO_RECUSADA(Number(ped?.numero) || 0, motivo))
}

/**
 * Cron (1 min): solicitação pendente há 5+ min sem decisão → a conversa pede atendente (amarela na central, o mesmo
 * mecanismo da IA) e o cliente recebe "Já avisamos a loja…". Uma vez por solicitação (escalada_em).
 */
export async function escalarSolicitacoesPendentes(admin: SupabaseClient, agora = new Date()): Promise<number> {
  const { data } = await admin.from('pedido_solicitacoes').select('id, restaurante_id, pedido_id, criado_em').eq('status', 'pendente').is('escalada_em', null)
    .lte('criado_em', new Date(agora.getTime() - PRAZO_ATENDENTE_MS).toISOString()).limit(50)
  let n = 0
  for (const s of (data ?? []) as { id: string; restaurante_id: string; pedido_id: string }[]) {
    const { data: marcada } = await admin.from('pedido_solicitacoes').update({ escalada_em: agora.toISOString() }).eq('id', s.id).is('escalada_em', null).select('id').maybeSingle()
    if (!marcada) continue
    const { data: ped } = await admin.from('pedidos').select('numero, cliente_telefone').eq('id', s.pedido_id).maybeSingle()
    const tel = String(ped?.cliente_telefone ?? '').replace(/\D/g, '')
    if (tel) {
      const { data: conv } = await admin.from('whatsapp_conversas').select('id').eq('restaurante_id', s.restaurante_id).in('telefone', [tel, tel.startsWith('55') ? tel : `55${tel}`]).order('ultima_atividade_em', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
      if (conv) {
        await admin.from('whatsapp_conversas').update({ estado: 'silenciada', atendimento: 'aguardando', pediu_atendente_em: agora.toISOString(), pediu_atendente_motivo: `Alteração do pedido #${ped?.numero ?? ''} sem resposta há 5 min`, pediu_atendente_aviso_em: agora.toISOString() }).eq('id', conv.id)
      }
    }
    await avisarCliente(admin, s.restaurante_id, s.pedido_id, `solicitacao_escalada:${s.id}`, TEXTO_LOJA_AVISADA_SOLICITACAO)
    n++
  }
  return n
}

export { TEXTO_NAO_EDITAVEL }
