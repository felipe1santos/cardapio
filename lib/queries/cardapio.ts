import type { SupabaseClient } from '@supabase/supabase-js'

export type StatusItem = 'disponivel' | 'pausado' | 'esgotado'
export type TipoItem = 'simples' | 'pizza' | 'marmita'

/** Etiquetas de destaque que a loja pode marcar num item (exibidas na vitrine). */
export type TagItem = 'mais_pedido' | 'edicao_limitada' | 'novo' | 'promocao' | 'favorito'

export const TAGS_ITEM: { id: TagItem; label: string }[] = [
  { id: 'mais_pedido', label: 'Mais pedido' },
  { id: 'edicao_limitada', label: 'Edição limitada' },
  { id: 'novo', label: 'Novo' },
  { id: 'favorito', label: 'Favorito da casa' },
  { id: 'promocao', label: 'Promoção' },
]

export interface GrupoCardapio {
  id: string
  nome: string
  posicao: number
}

export interface ComplementoItem {
  id: string
  nome: string
  preco: number
  presetOrigemId: string | null
}

export interface GrupoItemComplementos {
  id: string
  nome: string
  obrigatorio: boolean
  minEscolhas: number
  maxEscolhas: number
  posicao: number
  complementos: ComplementoItem[]
}

export interface TamanhoItem {
  id: string
  nome: string
  preco: number
  posicao: number
}

export interface PrecoSaborTamanho {
  tamanhoPadraoId: string
  preco: number
}

export interface PizzaSabor {
  id: string
  nome: string
  descricao: string
  imagemUrl: string | null
  status: StatusItem
  posicao: number
  precos: PrecoSaborTamanho[]
}

export interface ItemCardapio {
  id: string
  grupoId: string | null
  nome: string
  descricao: string
  preco: number
  imagemUrl: string | null
  status: StatusItem
  diasDisponiveis: number[]
  promocaoPreco: number | null
  maisVendido: boolean
  /** Etiqueta de destaque exibida na vitrine (ex.: 'mais_pedido'). Null = sem tag. */
  tag: TagItem | null
  tipoItem: TipoItem
  grupos: GrupoItemComplementos[]
  complementos: ComplementoItem[]
  tamanhos: TamanhoItem[]
  sabores: PizzaSabor[]
}

export interface PresetComplementos {
  id: string
  nome: string
  obrigatorio: boolean
  minEscolhas: number
  maxEscolhas: number
  itens: { id: string; nome: string; preco: number }[]
}

interface ItemRow {
  id: string
  grupo_id: string | null
  nome: string
  descricao: string
  preco: number
  imagem_url: string | null
  status: StatusItem
  dias_disponiveis: number[]
  promocao_preco: number | null
  mais_vendido: boolean
  tag: TagItem | null
  tipo_item: TipoItem
  item_complementos: { id: string; nome: string; preco: number; grupo_id: string | null; preset_origem_id: string | null }[]
  grupos_item_complementos: { id: string; nome: string; obrigatorio: boolean; min_escolhas: number; max_escolhas: number; posicao: number }[]
  tamanhos_item: { id: string; nome: string; preco: number; posicao: number }[]
  pizza_sabores: {
    id: string
    nome: string
    descricao: string
    imagem_url: string | null
    status: StatusItem
    posicao: number
    pizza_sabor_precos: { tamanho_padrao_id: string; preco: number }[]
  }[]
}

function mapItem(row: ItemRow): ItemCardapio {
  const grupos: GrupoItemComplementos[] = (row.grupos_item_complementos ?? [])
    .sort((a, b) => a.posicao - b.posicao)
    .map((g) => ({
      id: g.id,
      nome: g.nome,
      obrigatorio: g.obrigatorio,
      minEscolhas: g.min_escolhas,
      maxEscolhas: g.max_escolhas,
      posicao: g.posicao,
      complementos: (row.item_complementos ?? [])
        .filter((c) => c.grupo_id === g.id)
        .map((c) => ({ id: c.id, nome: c.nome, preco: Number(c.preco), presetOrigemId: c.preset_origem_id })),
    }))

  return {
    id: row.id,
    grupoId: row.grupo_id,
    nome: row.nome,
    descricao: row.descricao,
    preco: Number(row.preco),
    imagemUrl: row.imagem_url,
    status: row.status,
    diasDisponiveis: row.dias_disponiveis ?? [],
    promocaoPreco: row.promocao_preco === null ? null : Number(row.promocao_preco),
    maisVendido: row.mais_vendido,
    tag: row.tag ?? null,
    tipoItem: row.tipo_item ?? 'simples',
    grupos,
    complementos: (row.item_complementos ?? [])
      .filter((c) => !c.grupo_id)
      .map((c) => ({ id: c.id, nome: c.nome, preco: Number(c.preco), presetOrigemId: c.preset_origem_id })),
    tamanhos: (row.tamanhos_item ?? [])
      .sort((a, b) => a.posicao - b.posicao)
      .map((t) => ({ id: t.id, nome: t.nome, preco: Number(t.preco), posicao: t.posicao })),
    sabores: (row.pizza_sabores ?? [])
      .sort((a, b) => a.posicao - b.posicao)
      .map((s) => ({
        id: s.id,
        nome: s.nome,
        descricao: s.descricao,
        imagemUrl: s.imagem_url,
        status: s.status,
        posicao: s.posicao,
        precos: (s.pizza_sabor_precos ?? []).map((p) => ({ tamanhoPadraoId: p.tamanho_padrao_id, preco: Number(p.preco) })),
      })),
  }
}

/** Resolves the tenant id for the currently authenticated admin user. */
export async function buscarRestauranteIdDoUsuario(supabase: SupabaseClient): Promise<string | null> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null

  const { data, error } = await supabase
    .from('usuarios')
    .select('restaurante_id')
    .eq('id', auth.user.id)
    .single()

  if (error || !data) return null
  return data.restaurante_id as string
}

export async function listarGrupos(supabase: SupabaseClient, restauranteId: string): Promise<GrupoCardapio[]> {
  const { data, error } = await supabase
    .from('grupos_cardapio')
    .select('id, nome, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function criarGrupo(supabase: SupabaseClient, restauranteId: string, nome: string, posicao: number) {
  const { data, error } = await supabase
    .from('grupos_cardapio')
    .insert({ restaurante_id: restauranteId, nome, posicao })
    .select('id, nome, posicao')
    .single()

  if (error) throw error
  return data as GrupoCardapio
}

export async function atualizarGrupo(supabase: SupabaseClient, grupoId: string, nome: string) {
  const { data, error } = await supabase
    .from('grupos_cardapio')
    .update({ nome })
    .eq('id', grupoId)
    .select('id, nome, posicao')
    .single()

  if (error) throw error
  return data as GrupoCardapio
}

/** Deleting a category does not delete its items — `grupo_id` is set to null (FK ON DELETE SET NULL). */
export async function removerGrupo(supabase: SupabaseClient, grupoId: string) {
  const { error } = await supabase.from('grupos_cardapio').delete().eq('id', grupoId)
  if (error) throw error
}

const ITEM_SELECT = `
  id, grupo_id, nome, descricao, preco, imagem_url, status, dias_disponiveis, promocao_preco, mais_vendido, tag, tipo_item,
  item_complementos ( id, nome, preco, grupo_id, preset_origem_id ),
  grupos_item_complementos ( id, nome, obrigatorio, min_escolhas, max_escolhas, posicao ),
  tamanhos_item ( id, nome, preco, posicao ),
  pizza_sabores ( id, nome, descricao, imagem_url, status, posicao, pizza_sabor_precos ( tamanho_padrao_id, preco ) )
`

export async function listarItens(supabase: SupabaseClient, restauranteId: string): Promise<ItemCardapio[]> {
  const { data, error } = await supabase
    .from('itens_cardapio')
    .select(ITEM_SELECT)
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as ItemRow[]).map(mapItem)
}

export interface NovoItemInput {
  grupoId: string | null
  nome: string
  descricao: string
  preco: number
  status: StatusItem
  diasDisponiveis: number[]
  promocaoPreco: number | null
  maisVendido: boolean
  tag: TagItem | null
  tipoItem: TipoItem
}

export async function criarItem(supabase: SupabaseClient, restauranteId: string, input: NovoItemInput): Promise<ItemCardapio> {
  const { data, error } = await supabase
    .from('itens_cardapio')
    .insert({
      restaurante_id: restauranteId,
      grupo_id: input.grupoId,
      nome: input.nome,
      descricao: input.descricao,
      preco: input.preco,
      status: input.status,
      dias_disponiveis: input.diasDisponiveis,
      promocao_preco: input.promocaoPreco,
      mais_vendido: input.maisVendido,
      tag: input.tag,
      tipo_item: input.tipoItem,
    })
    .select(ITEM_SELECT)
    .single()

  if (error) throw error
  return mapItem(data as unknown as ItemRow)
}

export interface AtualizarItemInput {
  grupoId: string | null
  nome: string
  descricao: string
  preco: number
  status: StatusItem
  diasDisponiveis: number[]
  imagemUrl: string | null
  promocaoPreco: number | null
  maisVendido: boolean
  tag: TagItem | null
  tipoItem: TipoItem
}

export async function atualizarItem(supabase: SupabaseClient, itemId: string, input: AtualizarItemInput): Promise<ItemCardapio> {
  const { data, error } = await supabase
    .from('itens_cardapio')
    .update({
      grupo_id: input.grupoId,
      nome: input.nome,
      descricao: input.descricao,
      preco: input.preco,
      status: input.status,
      dias_disponiveis: input.diasDisponiveis,
      imagem_url: input.imagemUrl,
      promocao_preco: input.promocaoPreco,
      mais_vendido: input.maisVendido,
      tag: input.tag,
      tipo_item: input.tipoItem,
    })
    .eq('id', itemId)
    .select(ITEM_SELECT)
    .single()

  if (error) throw error
  return mapItem(data as unknown as ItemRow)
}

export async function definirStatusEmLote(supabase: SupabaseClient, itemIds: string[], status: StatusItem) {
  const { error } = await supabase.from('itens_cardapio').update({ status }).in('id', itemIds)
  if (error) throw error
}

export async function excluirItens(supabase: SupabaseClient, itemIds: string[]) {
  const { error } = await supabase.from('itens_cardapio').delete().in('id', itemIds)
  if (error) throw error
}

/** Uploads a menu photo to the tenant-scoped folder of the public `cardapio` bucket and returns its public URL. */
export async function enviarImagemItem(supabase: SupabaseClient, restauranteId: string, file: File): Promise<string> {
  const extensao = file.name.split('.').pop() ?? 'jpg'
  const caminho = `${restauranteId}/${crypto.randomUUID()}.${extensao}`

  const { error } = await supabase.storage.from('cardapio').upload(caminho, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error

  const { data } = supabase.storage.from('cardapio').getPublicUrl(caminho)
  return data.publicUrl
}

// ─── Complement groups per item ───────────────────────────────────────────────

export async function criarGrupoItem(
  supabase: SupabaseClient,
  itemId: string,
  nome: string,
  obrigatorio: boolean,
  minEscolhas: number,
  maxEscolhas: number,
  posicao: number
): Promise<GrupoItemComplementos> {
  const { data, error } = await supabase
    .from('grupos_item_complementos')
    .insert({ item_id: itemId, nome, obrigatorio, min_escolhas: minEscolhas, max_escolhas: maxEscolhas, posicao })
    .select('id, nome, obrigatorio, min_escolhas, max_escolhas, posicao')
    .single()
  if (error) throw error
  return {
    id: data.id,
    nome: data.nome,
    obrigatorio: data.obrigatorio,
    minEscolhas: data.min_escolhas,
    maxEscolhas: data.max_escolhas,
    posicao: data.posicao,
    complementos: [],
  }
}

export async function atualizarGrupoItem(
  supabase: SupabaseClient,
  grupoId: string,
  nome: string,
  obrigatorio: boolean,
  minEscolhas: number,
  maxEscolhas: number
) {
  const { error } = await supabase
    .from('grupos_item_complementos')
    .update({ nome, obrigatorio, min_escolhas: minEscolhas, max_escolhas: maxEscolhas })
    .eq('id', grupoId)
  if (error) throw error
}

export async function removerGrupoItem(supabase: SupabaseClient, grupoId: string) {
  const { error } = await supabase.from('grupos_item_complementos').delete().eq('id', grupoId)
  if (error) throw error
}

// ─── Tamanhos do item (ex.: marmitex P/M/G) ───────────────────────────────────

export async function criarTamanho(
  supabase: SupabaseClient,
  itemId: string,
  nome: string,
  preco: number,
  posicao: number
): Promise<TamanhoItem> {
  const { data, error } = await supabase
    .from('tamanhos_item')
    .insert({ item_id: itemId, nome, preco, posicao })
    .select('id, nome, preco, posicao')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, preco: Number(data.preco), posicao: data.posicao }
}

export async function atualizarTamanho(supabase: SupabaseClient, tamanhoId: string, nome: string, preco: number) {
  const { error } = await supabase.from('tamanhos_item').update({ nome, preco }).eq('id', tamanhoId)
  if (error) throw error
}

export async function removerTamanho(supabase: SupabaseClient, tamanhoId: string) {
  const { error } = await supabase.from('tamanhos_item').delete().eq('id', tamanhoId)
  if (error) throw error
}

// ─── Sabores de pizza (item de tipo 'pizza') ──────────────────────────────────

export async function criarSabor(supabase: SupabaseClient, itemId: string, nome: string, posicao: number): Promise<PizzaSabor> {
  const { data, error } = await supabase
    .from('pizza_sabores')
    .insert({ item_id: itemId, nome, posicao })
    .select('id, nome, descricao, imagem_url, status, posicao')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, descricao: data.descricao, imagemUrl: data.imagem_url, status: data.status, posicao: data.posicao, precos: [] }
}

export interface AtualizarSaborInput {
  nome: string
  descricao: string
  status: StatusItem
  imagemUrl: string | null
}

export async function atualizarSabor(supabase: SupabaseClient, saborId: string, input: AtualizarSaborInput) {
  const { error } = await supabase
    .from('pizza_sabores')
    .update({ nome: input.nome, descricao: input.descricao, status: input.status, imagem_url: input.imagemUrl })
    .eq('id', saborId)
  if (error) throw error
}

export async function removerSabor(supabase: SupabaseClient, saborId: string) {
  const { error } = await supabase.from('pizza_sabores').delete().eq('id', saborId)
  if (error) throw error
}

/** Define (cria ou atualiza) o preço do sabor pra um tamanho padrão de pizza da loja. */
export async function definirPrecoSabor(supabase: SupabaseClient, saborId: string, tamanhoPadraoId: string, preco: number) {
  const { error } = await supabase
    .from('pizza_sabor_precos')
    .upsert({ sabor_id: saborId, tamanho_padrao_id: tamanhoPadraoId, preco }, { onConflict: 'sabor_id,tamanho_padrao_id' })
  if (error) throw error
}

// ─── Preset complement groups ─────────────────────────────────────────────────

export async function listarPresets(supabase: SupabaseClient, restauranteId: string): Promise<PresetComplementos[]> {
  const { data, error } = await supabase
    .from('presets_complementos')
    .select('id, nome, obrigatorio, min_escolhas, max_escolhas, preset_complemento_itens ( id, nome, preco )')
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: true })

  if (error) throw error
  return (data ?? []).map((preset) => ({
    id: preset.id,
    nome: preset.nome,
    obrigatorio: preset.obrigatorio,
    minEscolhas: preset.min_escolhas,
    maxEscolhas: preset.max_escolhas,
    itens: (preset.preset_complemento_itens ?? []).map((item: { id: string; nome: string; preco: number }) => ({
      id: item.id,
      nome: item.nome,
      preco: Number(item.preco),
    })),
  }))
}

export async function criarPreset(supabase: SupabaseClient, restauranteId: string, nome: string): Promise<PresetComplementos> {
  const { data, error } = await supabase
    .from('presets_complementos')
    .insert({ restaurante_id: restauranteId, nome })
    .select('id, nome, obrigatorio, min_escolhas, max_escolhas')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, obrigatorio: data.obrigatorio, minEscolhas: data.min_escolhas, maxEscolhas: data.max_escolhas, itens: [] }
}

export async function renomearPreset(supabase: SupabaseClient, presetId: string, nome: string) {
  const { error } = await supabase.from('presets_complementos').update({ nome }).eq('id', presetId)
  if (error) throw error
}

export async function atualizarRegrasPreset(
  supabase: SupabaseClient,
  presetId: string,
  obrigatorio: boolean,
  minEscolhas: number,
  maxEscolhas: number
) {
  const { error } = await supabase
    .from('presets_complementos')
    .update({ obrigatorio, min_escolhas: minEscolhas, max_escolhas: maxEscolhas })
    .eq('id', presetId)
  if (error) throw error
}

export async function removerPreset(supabase: SupabaseClient, presetId: string) {
  const { error } = await supabase.from('presets_complementos').delete().eq('id', presetId)
  if (error) throw error
}

export async function adicionarItemPreset(
  supabase: SupabaseClient,
  presetId: string,
  nome: string,
  preco: number,
  posicao: number
): Promise<{ id: string; nome: string; preco: number }> {
  const { data, error } = await supabase
    .from('preset_complemento_itens')
    .insert({ preset_id: presetId, nome, preco, posicao })
    .select('id, nome, preco')
    .single()
  if (error) throw error
  return { id: data.id, nome: data.nome, preco: Number(data.preco) }
}

export async function atualizarItemPreset(supabase: SupabaseClient, itemId: string, nome: string, preco: number) {
  const { error } = await supabase.from('preset_complemento_itens').update({ nome, preco }).eq('id', itemId)
  if (error) throw error
}

export async function removerItemPreset(supabase: SupabaseClient, itemId: string) {
  const { error } = await supabase.from('preset_complemento_itens').delete().eq('id', itemId)
  if (error) throw error
}

/** Copies a preset as a new complement group on the item (one-click import). Adds to existing groups, does not replace. */
export async function importarPresetNoItem(supabase: SupabaseClient, itemId: string, preset: PresetComplementos, posicao: number) {
  const { data: grupoData, error: grupoError } = await supabase
    .from('grupos_item_complementos')
    .insert({
      item_id: itemId,
      preset_origem_id: preset.id,
      nome: preset.nome,
      obrigatorio: preset.obrigatorio,
      min_escolhas: preset.minEscolhas,
      max_escolhas: preset.maxEscolhas,
      posicao,
    })
    .select('id')
    .single()
  if (grupoError) throw grupoError

  if (preset.itens.length === 0) return

  const { error } = await supabase.from('item_complementos').insert(
    preset.itens.map((item, index) => ({
      item_id: itemId,
      grupo_id: grupoData.id,
      nome: item.nome,
      preco: item.preco,
      posicao: index,
      preset_origem_id: preset.id,
    }))
  )
  if (error) throw error
}

export async function adicionarComplemento(
  supabase: SupabaseClient,
  itemId: string,
  nome: string,
  preco: number,
  posicao: number,
  grupoId?: string | null
): Promise<ComplementoItem> {
  const { data, error } = await supabase
    .from('item_complementos')
    .insert({ item_id: itemId, nome, preco, posicao, grupo_id: grupoId ?? null })
    .select('id, nome, preco, preset_origem_id')
    .single()

  if (error) throw error
  return { id: data.id, nome: data.nome, preco: Number(data.preco), presetOrigemId: data.preset_origem_id }
}

export async function removerComplemento(supabase: SupabaseClient, complementoId: string) {
  const { error } = await supabase.from('item_complementos').delete().eq('id', complementoId)
  if (error) throw error
}

// --- Public storefront -------------------------------------------------

export type LayoutCardapio = 'categoria' | 'lista'

export interface RestauranteVitrine {
  id: string
  nome: string
  slug: string
  logoUrl: string | null
  bannerUrl: string | null
  telefone: string
  endereco: string
  taxaEntregaPadrao: number
  facebookPixelId: string | null
  googleTagId: string | null
  orderBumpMax: number
  layoutCardapio: LayoutCardapio
  corTema: string
  imagemGrande: boolean
}

export async function buscarRestaurantePorSlug(supabase: SupabaseClient, slug: string): Promise<RestauranteVitrine | null> {
  const { data, error } = await supabase
    .from('restaurantes')
    .select('id, nome, slug, logo_url, banner_url, telefone, endereco, taxa_entrega_padrao, facebook_pixel_id, google_tag_id, order_bump_max, layout_cardapio, cor_tema, imagem_grande')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    id: data.id,
    nome: data.nome,
    slug: data.slug,
    logoUrl: data.logo_url,
    bannerUrl: data.banner_url,
    telefone: data.telefone,
    endereco: data.endereco,
    taxaEntregaPadrao: Number(data.taxa_entrega_padrao),
    facebookPixelId: data.facebook_pixel_id,
    googleTagId: data.google_tag_id,
    orderBumpMax: Number(data.order_bump_max ?? 4),
    layoutCardapio: (data.layout_cardapio as LayoutCardapio) ?? 'categoria',
    corTema: (data.cor_tema as string) ?? 'azul',
    imagemGrande: Boolean(data.imagem_grande),
  }
}

export async function listarBairrosVitrine(supabase: SupabaseClient, restauranteId: string): Promise<{ bairro: string; taxa: number }[]> {
  const { data, error } = await supabase
    .from('taxas_entrega_bairro')
    .select('bairro, taxa')
    .eq('restaurante_id', restauranteId)
    .order('bairro', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ bairro: d.bairro, taxa: Number(d.taxa) }))
}

export interface GrupoComItens extends GrupoCardapio {
  itens: ItemCardapio[]
}

/** Loads the public menu (groups + available items + complementos) for the storefront. */
export async function listarCardapioPublico(supabase: SupabaseClient, restauranteId: string): Promise<GrupoComItens[]> {
  const [grupos, itens] = await Promise.all([
    listarGrupos(supabase, restauranteId),
    listarItens(supabase, restauranteId),
  ])

  return grupos
    .map((grupo) => ({
      ...grupo,
      itens: itens.filter((item) => item.grupoId === grupo.id && item.status === 'disponivel'),
    }))
    .filter((grupo) => grupo.itens.length > 0)
}

// --- Order bumps -------------------------------------------------------

export interface OrderBumpEntry {
  id: string
  itemId: string
  posicao: number
  ativo: boolean
}

export async function listarOrderBumps(supabase: SupabaseClient, restauranteId: string): Promise<OrderBumpEntry[]> {
  const { data, error } = await supabase
    .from('order_bumps')
    .select('id, item_id, posicao, ativo')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ id: d.id, itemId: d.item_id, posicao: d.posicao, ativo: d.ativo }))
}

export async function buscarOrderBumpConfig(supabase: SupabaseClient, restauranteId: string): Promise<{ max: number }> {
  const { data, error } = await supabase
    .from('restaurantes')
    .select('order_bump_max')
    .eq('id', restauranteId)
    .single()
  if (error) throw error
  return { max: Number(data?.order_bump_max ?? 4) }
}

export async function adicionarOrderBump(
  supabase: SupabaseClient,
  restauranteId: string,
  itemId: string,
  posicao: number
): Promise<OrderBumpEntry> {
  const { data, error } = await supabase
    .from('order_bumps')
    .insert({ restaurante_id: restauranteId, item_id: itemId, posicao, ativo: true })
    .select('id, item_id, posicao, ativo')
    .single()
  if (error) throw error
  return { id: data.id, itemId: data.item_id, posicao: data.posicao, ativo: data.ativo }
}

export async function removerOrderBump(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from('order_bumps').delete().eq('id', id)
  if (error) throw error
}

export async function toggleOrderBumpAtivo(supabase: SupabaseClient, id: string, ativo: boolean): Promise<void> {
  const { error } = await supabase.from('order_bumps').update({ ativo }).eq('id', id)
  if (error) throw error
}

export async function reordenarOrderBumps(
  supabase: SupabaseClient,
  entries: { id: string; posicao: number }[]
): Promise<void> {
  await Promise.all(entries.map((e) => supabase.from('order_bumps').update({ posicao: e.posicao }).eq('id', e.id)))
}

export async function atualizarOrderBumpMax(supabase: SupabaseClient, restauranteId: string, max: number): Promise<void> {
  const { error } = await supabase.from('restaurantes').update({ order_bump_max: max }).eq('id', restauranteId)
  if (error) throw error
}

export async function listarOrderBumpsPublico(
  supabase: SupabaseClient,
  restauranteId: string,
  max: number
): Promise<ItemCardapio[]> {
  const { data: bumps, error: bumpsError } = await supabase
    .from('order_bumps')
    .select('item_id, posicao')
    .eq('restaurante_id', restauranteId)
    .eq('ativo', true)
    .order('posicao', { ascending: true })
    .limit(max)
  if (bumpsError) throw bumpsError
  if (!bumps || bumps.length === 0) return []

  const itemIds = bumps.map((b) => b.item_id)
  const { data, error } = await supabase
    .from('itens_cardapio')
    .select(ITEM_SELECT)
    .in('id', itemIds)
  if (error) throw error

  const itemMap = new Map(((data ?? []) as unknown as ItemRow[]).map((d) => [d.id, mapItem(d)]))
  return bumps
    .map((b) => itemMap.get(b.item_id))
    .filter((item): item is ItemCardapio => item !== undefined && item.status === 'disponivel')
}
