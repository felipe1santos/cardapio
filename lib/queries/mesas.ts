import type { SupabaseClient } from '@supabase/supabase-js'

export type EstadoMesa = 'livre' | 'aguardando' | 'ocupada' | 'bloqueada' | 'inativa'

export interface Mesa {
  id: string
  nome: string
  ordem: number
  ativa: boolean
  setor: string | null
  capacidade: number | null
  bloqueada: boolean
  tokenGeradoEm: string
  /** QR revogado sem substituto (0071): o link não abre até a gestão gerar outro. */
  qrRevogado: boolean
}

/**
 * O token do QR NÃO faz parte de `Mesa`. Desde a 0071 o navegador não lê a coluna, e as
 * listas de mesas (salão, PDV, Ajustes) não têm por que carregá-lo. Ele sai só por
 * `listarTokensDasMesas`, chamada pela rota do QR com `mesas.gerenciar`.
 */
export interface TokenDaMesa {
  id: string
  nome: string
  setor: string | null
  ativa: boolean
  token: string
  qrRevogado: boolean
}

interface MesaRow {
  id: string
  restaurante_id: string
  nome: string
  ordem: number
  ativa: boolean | null
  criado_em: string
  setor: string | null
  capacidade: number | null
  bloqueada_em: string | null
  token_gerado_em: string
  qr_revogado_em: string | null
}

const MESA_SELECT =
  'id, restaurante_id, nome, ordem, ativa, criado_em, setor, capacidade, bloqueada_em, token_gerado_em, qr_revogado_em'

export function mapMesaRow(row: MesaRow): Mesa {
  return {
    id: row.id,
    nome: row.nome,
    ordem: row.ordem,
    ativa: row.ativa ?? true,
    setor: row.setor ?? null,
    capacidade: row.capacidade ?? null,
    bloqueada: row.bloqueada_em !== null,
    tokenGeradoEm: row.token_gerado_em,
    qrRevogado: (row.qr_revogado_em ?? null) !== null,
  }
}

/**
 * Estado que o mapa do salão e o painel de mesas do PDV mostram.
 *
 * Ordem de precedência pensada para o operador: cadastro vence operação, e operação
 * vence movimento. Uma mesa desativada não deve piscar "ocupada" porque sobrou comanda
 * aberta de ontem — ela sumiu do salão, ponto.
 *
 * `aguardando` é a mesa que abriu comanda e ainda não tem nada lançado: cliente
 * sentado esperando alguém anotar. O PDV já separava esse estado; o salão chamava
 * tudo de "Ocupada", então a mesma mesa tinha dois nomes conforme a tela — e o
 * garçom e o caixa não conseguiam falar da mesma mesa pelo nome do estado. Uma
 * regra só, usada pelas duas telas.
 */
export function estadoDaMesa(
  mesa: Pick<Mesa, 'ativa' | 'bloqueada'>,
  comanda: { aberta: boolean; qtdPedidos: number },
): EstadoMesa {
  if (!mesa.ativa) return 'inativa'
  if (mesa.bloqueada) return 'bloqueada'
  if (!comanda.aberta) return 'livre'
  return comanda.qtdPedidos > 0 ? 'ocupada' : 'aguardando'
}

export const ROTULO_ESTADO: Record<EstadoMesa, string> = {
  livre: 'Livre',
  aguardando: 'Aguardando',
  ocupada: 'Ocupada',
  bloqueada: 'Bloqueada',
  inativa: 'Inativa',
}

/** O que cada estado quer dizer, para a legenda e o `title` do bloco da mesa. */
export const AJUDA_ESTADO: Record<EstadoMesa, string> = {
  livre: 'Sem comanda aberta.',
  aguardando: 'Comanda aberta, nada lançado ainda.',
  ocupada: 'Comanda aberta com pedidos lançados.',
  bloqueada: 'Fora de uso por decisão da gestão.',
  inativa: 'Mesa desativada no cadastro.',
}

/** Monta a URL pública do QR. O token viaja sozinho: não expõe loja nem id da mesa. */
export function urlPublicaDaMesa(origem: string, token: string): string {
  return `${origem.replace(/\/$/, '')}/mesa/${token}`
}

/**
 * Nome sugerido para a próxima mesa: continua a numeração quando o padrão é "Mesa NN",
 * senão cai num contador simples. Regra pura — a tela usa no formulário.
 */
export function proximoNomeDeMesa(existentes: Pick<Mesa, 'nome'>[]): string {
  const numeros = existentes
    .map((m) => /^mesa\s*0*(\d+)$/i.exec(m.nome.trim())?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
  const proximo = numeros.length ? Math.max(...numeros) + 1 : existentes.length + 1
  return `Mesa ${String(proximo).padStart(2, '0')}`
}

export async function listarMesas(supabase: SupabaseClient, restauranteId: string): Promise<Mesa[]> {
  const { data, error } = await supabase
    .from('mesas')
    .select(MESA_SELECT)
    .eq('restaurante_id', restauranteId)
    .order('ordem', { ascending: true })
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as MesaRow[]).map(mapMesaRow)
}

export async function listarMesasAtivas(supabase: SupabaseClient, restauranteId: string): Promise<Mesa[]> {
  return (await listarMesas(supabase, restauranteId)).filter((m) => m.ativa)
}

export interface NovaMesaInput {
  nome: string
  ordem: number
  setor?: string | null
  capacidade?: number | null
}

export async function criarMesa(
  supabase: SupabaseClient,
  restauranteId: string,
  input: NovaMesaInput,
): Promise<Mesa> {
  const { data, error } = await supabase
    .from('mesas')
    .insert({
      restaurante_id: restauranteId,
      nome: input.nome,
      ordem: input.ordem,
      setor: input.setor ?? null,
      capacidade: input.capacidade ?? null,
    })
    .select(MESA_SELECT)
    .single()
  if (error) throw error
  return mapMesaRow(data as MesaRow)
}

export async function atualizarMesa(
  supabase: SupabaseClient,
  id: string,
  patch: Partial<{ nome: string; ordem: number; ativa: boolean; setor: string | null; capacidade: number | null }>,
): Promise<void> {
  const { error } = await supabase.from('mesas').update(patch).eq('id', id)
  if (error) throw error
}

/**
 * Exclusão dura. Existe porque a tela de Ajustes já oferece isso desde o PDV Fase 1.
 *
 * O módulo Mesas e Comandas NÃO usa: mesa com histórico se arquiva (`ativa = false`),
 * para não órfãos de comanda e pedido. A policy da 0062 não concede DELETE ao navegador,
 * então quem chama isto hoje é a tela antiga, com o client do dono.
 */
export async function removerMesa(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('mesas').delete().eq('id', id)
  if (error) throw error
}

/** Tokens do QR, só com service_role e só para a rota do QR (`mesas.gerenciar`). */
export async function listarTokensDasMesas(
  admin: SupabaseClient,
  restauranteId: string,
  mesaId?: string,
): Promise<TokenDaMesa[]> {
  let q = admin
    .from('mesas')
    .select('id, nome, setor, ativa, token, qr_revogado_em')
    .eq('restaurante_id', restauranteId)
    .order('ordem', { ascending: true })
    .order('criado_em', { ascending: true })
  if (mesaId) q = q.eq('id', mesaId)
  const { data, error } = await q
  if (error) throw error
  return ((data ?? []) as { id: string; nome: string; setor: string | null; ativa: boolean | null; token: string; qr_revogado_em: string | null }[]).map(
    (r) => ({ id: r.id, nome: r.nome, setor: r.setor, ativa: r.ativa ?? true, token: r.token, qrRevogado: r.qr_revogado_em !== null }),
  )
}

/**
 * Revoga o QR SEM emitir outro: o token é trocado por um valor que ninguém conhece (o
 * antigo morre na hora) e a mesa fica marcada como sem QR até a gestão gerar um novo.
 */
export async function revogarQrMesa(admin: SupabaseClient, restauranteId: string, id: string): Promise<void> {
  const { error } = await admin
    .from('mesas')
    .update({ token: crypto.randomUUID(), qr_revogado_em: new Date().toISOString() })
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
  if (error) throw error
}

/**
 * Revoga o QR antigo e emite um novo, mantendo o id interno da mesa — histórico,
 * comandas e pedidos continuam ligados a ela. Quem tiver o QR velho recebe 404.
 */
export async function regenerarTokenMesa(
  admin: SupabaseClient,
  restauranteId: string,
  id: string,
): Promise<{ token: string }> {
  const { data, error } = await admin
    .from('mesas')
    .update({ token: crypto.randomUUID(), token_gerado_em: new Date().toISOString(), qr_revogado_em: null })
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .select('token')
    .single()
  if (error) throw error
  return { token: (data as { token: string }).token }
}

/**
 * Resolve o token público da URL. Roda SEMPRE com service_role: `anon` não tem grant em
 * `mesas`. Devolve `null` para token inexistente, mesa inativa, mesa bloqueada, QR revogado
 * ou loja com o módulo desligado — sem distinguir os casos para quem chama de fora, para não
 * virar oráculo de enumeração.
 */
export async function resolverMesaPorToken(
  admin: SupabaseClient,
  token: string,
): Promise<{ mesaId: string; mesaNome: string; restauranteId: string; slug: string } | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) return null

  const { data, error } = await admin
    .from('mesas')
    .select('id, nome, ativa, bloqueada_em, qr_revogado_em, restaurante_id, restaurantes ( slug, modulo_mesas_ativo )')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const row = data as unknown as {
    id: string
    nome: string
    ativa: boolean | null
    bloqueada_em: string | null
    qr_revogado_em: string | null
    restaurante_id: string
    restaurantes: { slug: string; modulo_mesas_ativo: boolean } | null
  }

  if ((row.ativa ?? true) === false) return null
  if (row.bloqueada_em !== null) return null
  if ((row.qr_revogado_em ?? null) !== null) return null
  if (!row.restaurantes?.modulo_mesas_ativo) return null

  return {
    mesaId: row.id,
    mesaNome: row.nome,
    restauranteId: row.restaurante_id,
    slug: row.restaurantes.slug,
  }
}
