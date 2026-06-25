// lib/queries/estacoes.ts
// Camada de dados das estações de cozinha. CRUD usa a sessão do tenant (RLS);
// lookup por token e heartbeat usam o admin client (acesso público sem login).
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ModoEstacao } from '@/lib/cozinha/modo'

/** Estação online se enviou heartbeat nos últimos 30s. */
const ESTACAO_ONLINE_MS = 30 * 1000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface Estacao {
  id: string
  nome: string
  modo: ModoEstacao
  token: string
  ativo: boolean
  online: boolean
  criadoEm: string
}

export interface EstacaoPortal {
  id: string
  nome: string
  modo: ModoEstacao
  restauranteId: string
  restauranteNome: string
}

export async function listarEstacoes(supabase: SupabaseClient, restauranteId: string): Promise<Estacao[]> {
  const { data, error } = await supabase
    .from('estacoes')
    .select('id, nome, modo, token, ativo, ultimo_visto_em, criado_em')
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: true })
  if (error) throw error

  const agora = Date.now()
  return (data ?? []).map((e) => ({
    id: e.id,
    nome: e.nome,
    modo: e.modo as ModoEstacao,
    token: e.token,
    ativo: e.ativo,
    online: !!e.ultimo_visto_em && agora - new Date(e.ultimo_visto_em).getTime() < ESTACAO_ONLINE_MS,
    criadoEm: e.criado_em,
  }))
}

export async function criarEstacao(supabase: SupabaseClient, restauranteId: string, nome: string, modo: ModoEstacao): Promise<void> {
  const { error } = await supabase.from('estacoes').insert({ restaurante_id: restauranteId, nome: nome.trim(), modo })
  if (error) throw error
}

export async function atualizarEstacao(
  supabase: SupabaseClient,
  id: string,
  dados: { nome?: string; modo?: ModoEstacao; ativo?: boolean }
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (dados.nome !== undefined) patch.nome = dados.nome.trim()
  if (dados.modo !== undefined) patch.modo = dados.modo
  if (dados.ativo !== undefined) patch.ativo = dados.ativo
  const { error } = await supabase.from('estacoes').update(patch).eq('id', id)
  if (error) throw error
}

export async function rotacionarTokenEstacao(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('estacoes').update({ token: crypto.randomUUID() }).eq('id', id)
  if (error) throw error
}

export async function removerEstacao(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('estacoes').delete().eq('id', id)
  if (error) throw error
}

/** Localiza a estação ATIVA pelo token público. Null se não existe ou está desativada. */
export async function buscarEstacaoPorToken(admin: SupabaseClient, token: string): Promise<EstacaoPortal | null> {
  if (!UUID_RE.test(token)) return null
  const { data, error } = await admin
    .from('estacoes')
    .select('id, nome, modo, ativo, restaurante_id, restaurantes ( nome )')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  if (!data || !data.ativo) return null

  const restaurantes = data.restaurantes as unknown as { nome: string } | { nome: string }[] | null
  const restauranteNome = Array.isArray(restaurantes) ? restaurantes[0]?.nome : restaurantes?.nome

  return {
    id: data.id,
    nome: data.nome,
    modo: data.modo as ModoEstacao,
    restauranteId: data.restaurante_id,
    restauranteNome: restauranteNome ?? '',
  }
}

export async function registrarHeartbeatEstacao(admin: SupabaseClient, estacaoId: string): Promise<void> {
  await admin.from('estacoes').update({ ultimo_visto_em: new Date().toISOString() }).eq('id', estacaoId)
}
