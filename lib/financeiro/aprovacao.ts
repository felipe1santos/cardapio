import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarAcessos } from '@/lib/acessos'
import { registrarAuditoria } from '@/lib/auditoria'
import { podeFin } from './permissoes'
import { criarAlerta } from './alertas'

/**
 * Aprovação do gerente/dono (dupla autorização, 0132). O aprovador digita o PIN DELE no mesmo
 * terminal; o servidor confere: (1) é outra pessoa — ninguém aprova a própria ação; (2) é da mesma
 * loja, está ativo e tem a permissão "aprovar"; (3) o PIN confere (5 erros bloqueiam 15 min).
 * A aprovação fica gravada (imutável) e vai no lançamento.
 */
export interface PedidoAprovacao {
  restauranteId: string
  solicitante: { id: string; nome: string }
  aprovadorId: string
  pin: string
  acao: string
  valorCentavos?: number | null
  motivo?: string | null
  contexto?: Record<string, unknown>
}

export type ResultadoAprovacao =
  | { ok: true; id: string; aprovadorNome: string }
  | { ok: false; erro: string; codigo: 'propria' | 'sem_permissao' | 'pin_errado' | 'pin_bloqueado' | 'sem_pin' | 'inativo' | 'invalido'; status: number }

export async function verificarAprovador(admin: SupabaseClient, p: Omit<PedidoAprovacao, 'acao'>): Promise<{ ok: true; nome: string } | Extract<ResultadoAprovacao, { ok: false }>> {
  if (!/^[0-9a-f-]{36}$/i.test(p.aprovadorId)) return { ok: false, erro: 'Escolha quem vai aprovar.', codigo: 'invalido', status: 400 }
  if (p.aprovadorId === p.solicitante.id) return { ok: false, erro: 'Você não pode aprovar a sua própria ação. Chame o gerente ou o dono.', codigo: 'propria', status: 403 }
  const { data: apr } = await admin.from('usuarios').select('id, nome, papel, acessos, desativado_em, restaurante_id').eq('id', p.aprovadorId).eq('restaurante_id', p.restauranteId).maybeSingle()
  if (!apr || apr.desativado_em) return { ok: false, erro: 'Aprovador não encontrado nesta loja.', codigo: 'inativo', status: 403 }
  if (!podeFin(apr.papel as string, normalizarAcessos((apr as { acessos?: unknown }).acessos), 'aprovar')) {
    return { ok: false, erro: `${apr.nome} não tem permissão para aprovar.`, codigo: 'sem_permissao', status: 403 }
  }
  const { data: r, error } = await admin.rpc('usuario_verificar_pin', { p_restaurante: p.restauranteId, p_usuario: p.aprovadorId, p_pin: String(p.pin ?? '') })
  if (error) throw error
  if (r === 'ok') return { ok: true, nome: apr.nome as string }
  await registrarAuditoria(admin, {
    restauranteId: p.restauranteId, usuarioId: p.solicitante.id, usuarioNome: p.solicitante.nome,
    acao: 'fin.pin_recusado', entidade: 'usuario', entidadeId: p.aprovadorId, dados: { aprovador: apr.nome, motivo: r },
  })
  if (r === 'bloqueado') {
    await criarAlerta(admin, { restauranteId: p.restauranteId, tipo: 'pin_bloqueado', gravidade: 'atencao',
      mensagem: `PIN de ${apr.nome} bloqueado por 15 min após 5 tentativas erradas (pedido por ${p.solicitante.nome}).`, usuario: p.solicitante })
    return { ok: false, erro: 'PIN bloqueado por 15 minutos depois de 5 tentativas erradas.', codigo: 'pin_bloqueado', status: 423 }
  }
  if (r === 'sem_pin') return { ok: false, erro: `${apr.nome} ainda não cadastrou o PIN (Equipe › Editar usuário).`, codigo: 'sem_pin', status: 409 }
  if (r === 'inativo') return { ok: false, erro: 'Aprovador inativo.', codigo: 'inativo', status: 403 }
  return { ok: false, erro: 'PIN incorreto.', codigo: 'pin_errado', status: 403 }
}

/** Confere e GRAVA a aprovação. Use dentro da ação que precisa dela, antes de mexer no dinheiro. */
export async function aprovar(admin: SupabaseClient, p: PedidoAprovacao): Promise<ResultadoAprovacao> {
  const v = await verificarAprovador(admin, p)
  if (!v.ok) return v
  const { data, error } = await admin.from('fin_aprovacoes').insert({
    restaurante_id: p.restauranteId, acao: p.acao.slice(0, 60),
    solicitante_id: p.solicitante.id, solicitante_nome: p.solicitante.nome,
    aprovador_id: p.aprovadorId, aprovador_nome: v.nome,
    valor_centavos: p.valorCentavos ?? null, motivo: p.motivo?.slice(0, 500) ?? null, contexto: p.contexto ?? null,
  }).select('id').single()
  if (error) throw error
  await registrarAuditoria(admin, {
    restauranteId: p.restauranteId, usuarioId: p.aprovadorId, usuarioNome: v.nome,
    acao: 'fin.aprovou', entidade: 'aprovacao', entidadeId: data.id,
    dados: { acao: p.acao, solicitante: p.solicitante.nome, valor_centavos: p.valorCentavos ?? null, motivo: p.motivo ?? null },
  })
  return { ok: true, id: data.id as string, aprovadorNome: v.nome }
}
