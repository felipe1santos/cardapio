import type { SupabaseClient } from '@supabase/supabase-js'
import type { Acessos } from '@/lib/acessos'

/**
 * MOTOBOY = UM usuário (cargo Motoboy, papel `entregador`) ligado a UM registro de entregador (10/10/2026).
 *
 * Antes, criar pela Equipe com o cargo Motoboy fazia um usuário `logistica` COM permissões de painel e SEM entregador;
 * o login do app exige o entregador e respondia "acesso pausado". Agora tudo que mexe num lado reflete no outro:
 *   · Equipe cria/edita/pausa/desativa/exclui → entregador criado/renomeado/desativado (garantirEntregador, refletir*);
 *   · Entregadores cria/desativa/reativa → usuário da Equipe criado/pausado/reativado (já era assim + refletirNoUsuario).
 * Motoboy não tem NENHUMA permissão do painel: só o app (/motoboy). O middleware barra /admin e /api/admin.
 */
export const ACESSOS_MOTOBOY: Acessos = { areas: [], sensiveis: [] }

/** É motoboy? Papel `entregador` ou cargo Motoboy (inclusive os antigos, criados com papel logistica). */
export function ehMotoboy(u: { papel?: string | null; cargo?: string | null } | null | undefined): boolean {
  return !!u && (u.papel === 'entregador' || u.cargo === 'motoboy')
}

/**
 * Entregador ligado ao usuário (cria se faltar, reativa se estava desativado com o usuário ativo).
 * Devolve o id do entregador ou null se o usuário não é desta loja.
 */
export async function garantirEntregador(admin: SupabaseClient, restauranteId: string, usuarioId: string): Promise<string | null> {
  const { data: u } = await admin.from('usuarios').select('nome, telefone, desativado_em').eq('id', usuarioId).eq('restaurante_id', restauranteId).maybeSingle()
  if (!u) return null
  const { data: ja } = await admin.from('entregadores').select('id, desativado_em').eq('usuario_id', usuarioId).eq('restaurante_id', restauranteId)
    .order('desativado_em', { ascending: true, nullsFirst: true }).limit(1).maybeSingle()
  const ativo = !(u as { desativado_em?: string | null }).desativado_em
  if (ja) {
    if (ativo && (ja as { desativado_em?: string | null }).desativado_em) await admin.from('entregadores').update({ desativado_em: null }).eq('id', ja.id)
    return ja.id as string
  }
  const { data: novo, error } = await admin.from('entregadores')
    .insert({ restaurante_id: restauranteId, nome: (u.nome as string) || 'Motoboy', telefone: (u.telefone as string | null) ?? '', status: 'online', veiculo: '', placa: '', usuario_id: usuarioId, desativado_em: ativo ? null : new Date().toISOString() })
    .select('id').single()
  if (error) { console.error('[motoboy] não criou o entregador do usuário', error.message); return null }
  return novo.id as string
}

/** Equipe → Entregadores: nome/telefone e situação (ativo ou cortado). Cortar troca o token do link mágico. */
export async function refletirNoEntregador(admin: SupabaseClient, restauranteId: string, usuarioId: string, m: { nome?: string; telefone?: string; ativo?: boolean }) {
  const patch: Record<string, unknown> = {}
  if (m.nome) patch.nome = m.nome
  if (m.telefone !== undefined) patch.telefone = m.telefone
  if (m.ativo === false) Object.assign(patch, { desativado_em: new Date().toISOString(), status: 'offline', token: crypto.randomUUID() })
  if (m.ativo === true) patch.desativado_em = null
  if (!Object.keys(patch).length) return
  await admin.from('entregadores').update(patch).eq('usuario_id', usuarioId).eq('restaurante_id', restauranteId)
}

/** Entregadores → Equipe: desativar/reativar o motoboy reflete no usuário (situação pausado ↔ ativo). */
export async function refletirNoUsuario(admin: SupabaseClient, restauranteId: string, usuarioId: string, ativo: boolean) {
  await admin.from('usuarios').update(ativo ? { desativado_em: null, situacao: null } : { desativado_em: new Date().toISOString(), situacao: 'pausado' })
    .eq('id', usuarioId).eq('restaurante_id', restauranteId)
}
