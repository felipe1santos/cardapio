import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { conferirAprovacao } from './caixa'
import { criarAlerta } from './alertas'
import { formatarCentavos } from './centavos'
import { registrarAuditoria } from '@/lib/auditoria'
import { controleCaixaAtivo } from './nivel'

/**
 * Estorno e cancelamento depois de enviado à cozinha (plano do financeiro, §5: "sempre").
 * Com o financeiro ligado, só passam com o PIN de OUTRA pessoa que pode aprovar (gerente/dono) —
 * quem pede nunca aprova (o servidor e o banco conferem). O dono não precisa: é quem aprovaria,
 * como na sangria e na troca de forma de pagamento. Feito, vira alerta para o dono.
 *
 * A resposta 409 leva o cabeçalho X-Menuzia-Aprovacao: a janela global de PIN do painel
 * (components/admin/aprovacao-global.tsx) pega, pede o PIN e repete a mesma requisição com
 * `aprovacao` no corpo — nenhuma tela precisa tratar isso sozinha.
 */
export type AcaoSensivel = 'estorno' | 'cancelamento'
export const CABECALHO_APROVACAO = 'X-Menuzia-Aprovacao'

const TITULO: Record<AcaoSensivel, string> = {
  estorno: 'Estorno: outra pessoa precisa aprovar com o PIN',
  cancelamento: 'Cancelar o que já foi para a cozinha: outra pessoa precisa aprovar com o PIN',
}

/** Só o que decide se pede o PIN (puro, testado). */
export function precisaSegundaPessoa(p: { financeiroAtivo: boolean; papel: string }): boolean {
  return p.financeiroAtivo && p.papel !== 'dono'
}

export interface Solicitante { restauranteId: string; userId: string; nome: string; papel: string }
export type Liberacao = { ok: true; aprovadoPor: string | null } | { ok: false; resposta: NextResponse }

export async function exigirSegundaPessoa(admin: SupabaseClient, p: {
  sessao: Solicitante; corpo: unknown; acao: AcaoSensivel; valorCentavos?: number | null; resumo: string; contexto?: Record<string, unknown>
}): Promise<Liberacao> {
  const loja = p.sessao.restauranteId
  // Nível 2 (0167): só o controle de caixa ativo pede o PIN de outra pessoa.
  if (!precisaSegundaPessoa({ financeiroAtivo: await controleCaixaAtivo(admin, loja), papel: p.sessao.papel })) return { ok: true, aprovadoPor: null }

  const a = (p.corpo as { aprovacao?: { aprovadorId?: unknown; pin?: unknown; remotaId?: unknown } } | null)?.aprovacao
  const remotaId = typeof a?.remotaId === 'string' && a.remotaId ? a.remotaId : null
  const valor = p.valorCentavos ?? null
  if (!a || (!remotaId && (typeof a.aprovadorId !== 'string' || typeof a.pin !== 'string'))) {
    return {
      ok: false,
      resposta: NextResponse.json(
        { error: 'Precisa da aprovação de outra pessoa (PIN).', codigo: 'aprovacao_necessaria', titulo: TITULO[p.acao], pedidoRemoto: { acao: p.acao, valorCentavos: valor, motivo: p.resumo } },
        { status: 409, headers: { [CABECALHO_APROVACAO]: '1' } },
      ),
    }
  }
  const ap = await conferirAprovacao(admin, {
    restauranteId: loja, solicitante: { id: p.sessao.userId, nome: p.sessao.nome },
    aprovacao: { aprovadorId: String(a.aprovadorId ?? ''), pin: String(a.pin ?? ''), remotaId },
    acao: p.acao, valorCentavos: valor, motivo: p.resumo, contexto: p.contexto,
  })
  if (!ap.ok) return { ok: false, resposta: NextResponse.json({ error: ap.erro, codigo: ap.codigo }, { status: ap.status, headers: { [CABECALHO_APROVACAO]: '1' } }) }
  // Aprovação pelo celular: vale uma vez só (o banco recusa a segunda).
  if (remotaId && (await admin.rpc('fin_usar_aprovacao', { p_aprovacao: ap.id })).error) {
    return { ok: false, resposta: NextResponse.json({ error: 'Esta aprovação já foi usada. Peça de novo.', codigo: 'usada' }, { status: 409, headers: { [CABECALHO_APROVACAO]: '1' } }) }
  }
  return { ok: true, aprovadoPor: ap.aprovadorNome }
}

/** Depois que a ação deu certo: alerta para o dono (painel do Financeiro › Alertas) + auditoria com quem aprovou. */
export async function avisarDonoSensivel(admin: SupabaseClient, p: {
  sessao: Solicitante; acao: AcaoSensivel; aprovadoPor: string | null; resumo: string; motivo?: string | null; valorCentavos?: number | null; dados?: Record<string, unknown>
}): Promise<void> {
  if (p.sessao.papel === 'dono') return
  const { data: r } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', p.sessao.restauranteId).maybeSingle()
  if (r?.financeiro_ativo !== true) return
  const verbo = p.acao === 'estorno' ? 'estornou' : 'cancelou'
  const valor = p.valorCentavos ? ` (${formatarCentavos(p.valorCentavos)})` : ''
  await registrarAuditoria(admin, {
    restauranteId: p.sessao.restauranteId, usuarioId: p.sessao.userId, usuarioNome: p.sessao.nome,
    acao: p.acao === 'estorno' ? 'fin.estorno_aprovado' : 'fin.cancelamento_aprovado', entidade: 'financeiro', entidadeId: null,
    dados: { ...(p.dados ?? {}), resumo: p.resumo, motivo: p.motivo ?? null, valor_centavos: p.valorCentavos ?? null, aprovado_por: p.aprovadoPor },
  }).catch(() => {})
  await criarAlerta(admin, {
    restauranteId: p.sessao.restauranteId, tipo: p.acao === 'estorno' ? 'estorno_feito' : 'cancelamento_apos_cozinha', gravidade: 'atencao',
    usuario: { id: p.sessao.userId, nome: p.sessao.nome },
    mensagem: `${p.sessao.nome} ${verbo} ${p.resumo}${valor}${p.motivo ? `. Motivo: ${p.motivo}` : ''}${p.aprovadoPor ? ` (aprovado por ${p.aprovadoPor})` : ''}.`,
    dados: { ...(p.dados ?? {}), aprovado_por: p.aprovadoPor },
  })
}

/**
 * Pedido de delivery já foi para a cozinha? Aceito (saiu de "recebido") ou com a ficha impressa.
 * Esperando o Pix online ainda não foi. Pedido de conta (mesa/balcão) conta como enviado ao lançar.
 */
export function foiParaCozinha(p: { status: string; impresso: boolean }): boolean {
  if (p.status === 'aguardando_pagamento') return false
  return p.status !== 'recebido' || p.impresso
}
