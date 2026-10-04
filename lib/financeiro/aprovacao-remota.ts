import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarAcessos } from '@/lib/acessos'
import { registrarAuditoria } from '@/lib/auditoria'
import type { ContextoFin } from './contexto'
import { podeFin } from './permissoes'
import { verificarAprovador } from './aprovacao'
import { criarAlerta } from './alertas'
import { formatarCentavos } from './centavos'

/**
 * Aprovação pelo celular (Fase 6, 0144). Em vez de chamar o gerente até o terminal, o funcionário PEDE a
 * aprovação; o gerente/dono vê o pedido no painel (no celular) e aprova ou recusa com o PIN DELE.
 *
 * Segurança:
 *  - quem aprova é a sessão do aprovador + o PIN dele (5 erros bloqueiam), nunca quem pediu;
 *  - ninguém aprova o próprio pedido (CHECK no banco + servidor);
 *  - a aprovação vale UMA vez, para a MESMA ação, o MESMO valor e a MESMA pessoa, por 10 minutos;
 *  - tudo auditado (pedido, decisão, uso).
 * Push do PWA ainda não existe: o aviso é no painel (faixa de pedidos de aprovação). Ponto de troca: avisarAprovadores().
 */
type Falha = { ok: false; erro: string; status: number; codigo?: string }
const UUID = /^[0-9a-f-]{36}$/i
export const VALIDADE_MIN = 10

const ROTULO_ACAO: Record<string, string> = {
  sangria: 'Sangria', retirada: 'Retirada', despesa: 'Despesa do caixa', perda: 'Perda no caixa', fechar_caixa_divergente: 'Fechar o caixa com diferença',
  fechar_caixa: 'Fechar o caixa com pendências', conta_paga: 'Pagar conta', conta_estorno: 'Estornar baixa de conta', compra_paga: 'Pagar compra de insumos',
  venda_avulsa_suspeita: 'Lançar venda parecida com pedido do sistema', estorno: 'Estornar pagamento', pagamento_entrega: 'Pagamento de entrega',
}
export const rotuloAcao = (a: string) => ROTULO_ACAO[a] ?? a

export async function pedirAprovacao(c: ContextoFin, p: { acao: string; valorCentavos?: number | null; motivo?: string | null; contexto?: Record<string, unknown> | null }):
  Promise<{ ok: true; id: string; expiraEm: string } | Falha> {
  const acao = String(p.acao ?? '').slice(0, 60)
  if (acao.length < 3) return { ok: false, erro: 'Ação inválida.', status: 400 }
  const valor = p.valorCentavos === null || p.valorCentavos === undefined ? null : Number(p.valorCentavos)
  if (valor !== null && !Number.isSafeInteger(valor)) return { ok: false, erro: 'Valor inválido.', status: 400 }
  // Um pedido pendente por pessoa e ação: pedir de novo devolve o mesmo (sem encher o celular do dono).
  const { data: ja } = await c.admin.from('fin_aprovacao_pedidos').select('id, expira_em, valor_centavos').eq('restaurante_id', c.sessao.restauranteId)
    .eq('solicitante_id', c.sessao.userId).eq('acao', acao).eq('status', 'pendente').gt('expira_em', new Date().toISOString())
    .order('criado_em', { ascending: false }).limit(1).maybeSingle()
  if (ja && (ja.valor_centavos === null ? null : Number(ja.valor_centavos)) === valor) {
    return { ok: true, id: ja.id as string, expiraEm: ja.expira_em as string }
  }
  const { data, error } = await c.admin.from('fin_aprovacao_pedidos').insert({
    restaurante_id: c.sessao.restauranteId, acao, valor_centavos: valor, motivo: p.motivo?.toString().trim().slice(0, 500) || null,
    contexto: p.contexto ?? null, solicitante_id: c.sessao.userId, solicitante_nome: c.sessao.nome, dispositivo: c.dispositivo.slice(0, 200),
    expira_em: new Date(Date.now() + VALIDADE_MIN * 60_000).toISOString(),
  }).select('id, expira_em').single()
  if (error) throw error
  await registrarAuditoria(c.admin, {
    restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'fin.pediu_aprovacao', entidade: 'aprovacao_pedido',
    entidadeId: data.id as string, dados: { acao, valor_centavos: valor, motivo: p.motivo ?? null, dispositivo: c.dispositivo },
  })
  await avisarAprovadores(c.admin, c.sessao.restauranteId, `${c.sessao.nome} pede aprovação: ${rotuloAcao(acao)}${valor !== null ? ` — ${formatarCentavos(valor)}` : ''}.`, data.id as string)
  return { ok: true, id: data.id as string, expiraEm: data.expira_em as string }
}

/** Ponto de troca para o push do painel (quando existir). Hoje: aviso no painel (alerta "info", sem WhatsApp). */
async function avisarAprovadores(admin: SupabaseClient, loja: string, mensagem: string, pedidoId: string) {
  await criarAlerta(admin, { restauranteId: loja, tipo: 'aprovacao_pedida', gravidade: 'info', mensagem, dados: { pedido: pedidoId } })
}

/** Pedidos que ESTA pessoa pode decidir (tem "aprovar", não é quem pediu, ainda valem). */
export async function pendentesParaMim(admin: SupabaseClient, loja: string, usuarioId: string) {
  const { data } = await admin.from('fin_aprovacao_pedidos').select('id, acao, valor_centavos, motivo, solicitante_id, solicitante_nome, dispositivo, criado_em, expira_em')
    .eq('restaurante_id', loja).eq('status', 'pendente').gt('expira_em', new Date().toISOString()).neq('solicitante_id', usuarioId).order('criado_em').limit(20)
  return (data ?? []).map((x) => ({ ...x, rotulo: rotuloAcao(x.acao as string) }))
}

export async function situacaoDoPedido(admin: SupabaseClient, loja: string, usuarioId: string, id: string) {
  if (!UUID.test(id)) return null
  const { data } = await admin.from('fin_aprovacao_pedidos').select('id, status, aprovador_nome, recusa_motivo, expira_em, decidido_em')
    .eq('id', id).eq('restaurante_id', loja).eq('solicitante_id', usuarioId).maybeSingle()
  if (!data) return null
  const expirado = data.status === 'pendente' && Date.parse(data.expira_em as string) < Date.now()
  return { ...data, status: expirado ? 'expirado' : data.status }
}

/** O aprovador decide no celular, com o PIN dele. */
export async function decidirPedido(c: ContextoFin, id: string, p: { decisao: 'aprovar' | 'recusar'; pin: string; motivo?: string | null }): Promise<{ ok: true } | Falha> {
  const loja = c.sessao.restauranteId
  if (!UUID.test(id)) return { ok: false, erro: 'Pedido não encontrado.', status: 404 }
  const { data: ped } = await c.admin.from('fin_aprovacao_pedidos').select('*').eq('id', id).eq('restaurante_id', loja).maybeSingle()
  if (!ped) return { ok: false, erro: 'Pedido não encontrado.', status: 404 }
  if (ped.solicitante_id === c.sessao.userId) return { ok: false, erro: 'Você não pode aprovar o seu próprio pedido.', status: 403, codigo: 'propria' }
  if (!podeFin(c.sessao.papel, c.acessos, 'aprovar')) return { ok: false, erro: 'Você não tem permissão para aprovar.', status: 403, codigo: 'sem_permissao' }
  if (ped.status !== 'pendente') return { ok: false, erro: 'Este pedido já foi decidido.', status: 409, codigo: 'decidido' }
  if (Date.parse(ped.expira_em) < Date.now()) return { ok: false, erro: 'O pedido expirou (10 minutos). Peça de novo.', status: 409, codigo: 'expirado' }
  // PIN DO APROVADOR (a sessão diz quem é; o PIN prova que é ele mesmo, no celular dele).
  const v = await verificarAprovador(c.admin, { restauranteId: loja, solicitante: { id: ped.solicitante_id, nome: ped.solicitante_nome }, aprovadorId: c.sessao.userId, pin: p.pin })
  if (!v.ok) return { ok: false, erro: v.erro, status: v.status, codigo: v.codigo }
  if (p.decisao === 'recusar') {
    const { error } = await c.admin.from('fin_aprovacao_pedidos').update({ status: 'recusado', aprovador_id: c.sessao.userId, aprovador_nome: v.nome, decidido_em: new Date().toISOString(), recusa_motivo: p.motivo?.trim().slice(0, 300) || null })
      .eq('id', id).eq('status', 'pendente')
    if (error) throw error
    await registrarAuditoria(c.admin, { restauranteId: loja, usuarioId: c.sessao.userId, usuarioNome: v.nome, acao: 'fin.recusou_aprovacao', entidade: 'aprovacao_pedido', entidadeId: id,
      dados: { acao: ped.acao, solicitante: ped.solicitante_nome, valor_centavos: ped.valor_centavos, motivo: p.motivo ?? null, dispositivo: c.dispositivo } })
    return { ok: true }
  }
  const { data: apr, error: e1 } = await c.admin.from('fin_aprovacoes').insert({
    restaurante_id: loja, acao: ped.acao, solicitante_id: ped.solicitante_id, solicitante_nome: ped.solicitante_nome, aprovador_id: c.sessao.userId, aprovador_nome: v.nome,
    valor_centavos: ped.valor_centavos, motivo: ped.motivo, contexto: { ...(ped.contexto ?? {}), remota: true, pedido: id, dispositivo_aprovador: c.dispositivo },
  }).select('id').single()
  if (e1) throw e1
  const { data: upd, error: e2 } = await c.admin.from('fin_aprovacao_pedidos').update({ status: 'aprovado', aprovador_id: c.sessao.userId, aprovador_nome: v.nome, aprovacao_id: apr.id, decidido_em: new Date().toISOString() })
    .eq('id', id).eq('status', 'pendente').select('id')
  if (e2) throw e2
  if (!upd?.length) return { ok: false, erro: 'Este pedido já foi decidido.', status: 409, codigo: 'decidido' }
  await registrarAuditoria(c.admin, { restauranteId: loja, usuarioId: c.sessao.userId, usuarioNome: v.nome, acao: 'fin.aprovou', entidade: 'aprovacao', entidadeId: apr.id as string,
    dados: { acao: ped.acao, solicitante: ped.solicitante_nome, valor_centavos: ped.valor_centavos, motivo: ped.motivo, remota: true, dispositivo: c.dispositivo } })
  return { ok: true }
}

/**
 * Usa (uma vez) a aprovação remota dentro da ação. Confere loja, quem pediu, ação, valor e validade, e marca
 * como usada na mesma operação (corrida: só uma requisição consegue).
 */
export async function usarAprovacaoRemota(admin: SupabaseClient, p: { restauranteId: string; solicitanteId: string; acao: string; valorCentavos?: number | null; remotaId: string }):
  Promise<{ ok: true; id: string; aprovadorNome: string } | Falha> {
  if (!UUID.test(p.remotaId)) return { ok: false, erro: 'Aprovação inválida.', status: 400, codigo: 'invalido' }
  const { data: ped } = await admin.from('fin_aprovacao_pedidos').select('*').eq('id', p.remotaId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!ped || ped.solicitante_id !== p.solicitanteId) return { ok: false, erro: 'Aprovação não encontrada.', status: 404, codigo: 'invalido' }
  if (ped.status === 'usado') return { ok: false, erro: 'Esta aprovação já foi usada. Peça de novo.', status: 409, codigo: 'usada' }
  if (ped.status !== 'aprovado') return { ok: false, erro: ped.status === 'recusado' ? 'O pedido foi recusado.' : 'Ainda não aprovado.', status: 409, codigo: 'nao_aprovado' }
  if (Date.parse(ped.expira_em) < Date.now()) return { ok: false, erro: 'A aprovação expirou (10 minutos). Peça de novo.', status: 409, codigo: 'expirado' }
  if (ped.acao !== p.acao) return { ok: false, erro: 'A aprovação foi para outra ação.', status: 409, codigo: 'outra_acao' }
  const valor = p.valorCentavos === null || p.valorCentavos === undefined ? null : Number(p.valorCentavos)
  if (ped.valor_centavos !== null && valor !== null && Number(ped.valor_centavos) !== valor) return { ok: false, erro: 'O valor mudou depois da aprovação. Peça de novo.', status: 409, codigo: 'outro_valor' }
  const { data: upd, error } = await admin.from('fin_aprovacao_pedidos').update({ status: 'usado', usado_em: new Date().toISOString() }).eq('id', p.remotaId).eq('status', 'aprovado').select('id')
  if (error) throw error
  if (!upd?.length) return { ok: false, erro: 'Esta aprovação já foi usada. Peça de novo.', status: 409, codigo: 'usada' }
  // Aprovador ainda ativo e com permissão no momento do uso.
  const { data: apr } = await admin.from('usuarios').select('papel, acessos, desativado_em').eq('id', ped.aprovador_id).maybeSingle()
  if (!apr || apr.desativado_em || !podeFin(apr.papel as string, normalizarAcessos((apr as { acessos?: unknown }).acessos), 'aprovar')) {
    return { ok: false, erro: 'Quem aprovou não pode mais aprovar.', status: 403, codigo: 'sem_permissao' }
  }
  return { ok: true, id: ped.aprovacao_id as string, aprovadorNome: ped.aprovador_nome as string }
}
