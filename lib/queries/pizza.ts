import type { SupabaseClient } from '@supabase/supabase-js'
import type { ClienteLeitura } from '@/lib/supabase/vitrine'
import type { RegraPrecoPizza } from '@/lib/pizza-preco'
import { ErroCadastroCardapio, chaveNomeCatalogo, ehViolacaoDeUnicidade, nomeRepetidoNoCatalogo } from '@/lib/nomes-catalogo'

export interface TamanhoPadraoPizza {
  id: string
  nome: string
  fatias: number
  posicao: number
  /** Quantos sabores cabem nesse tamanho. 1 = sem meio a meio. */
  maxSabores: number
}

export interface TamanhoPadraoMarmita {
  id: string
  nome: string
  peso: string
  posicao: number
}

export interface BordaPizza {
  id: string
  nome: string
  preco: number
  posicao: number
}

export interface MassaPizza {
  id: string
  nome: string
  preco: number
  posicao: number
}

// ─── Nome sem repetição (0097) ──────────────────────────────────────────────

type TabelaCatalogo = 'tamanhos_padrao_pizza' | 'tamanhos_padrao_marmita' | 'bordas_pizza' | 'massas_pizza'

const ROTULO: Record<TabelaCatalogo, string> = {
  tamanhos_padrao_pizza: 'um tamanho de pizza',
  tamanhos_padrao_marmita: 'um tamanho de marmita',
  bordas_pizza: 'uma borda',
  massas_pizza: 'uma massa',
}

/**
 * Confere nome vazio e repetido antes de gravar. O índice da 0097 garante o mesmo
 * no banco; aqui é para a mensagem sair em português e antes da ida ao servidor.
 * Na edição, o restaurante vem da própria linha.
 */
async function prepararNome(
  supabase: SupabaseClient,
  tabela: TabelaCatalogo,
  nomeBruto: string,
  alvo: { restauranteId: string } | { id: string },
): Promise<string> {
  const nome = nomeBruto.trim()
  if (!nome) throw new ErroCadastroCardapio('Informe o nome.')
  let restauranteId: string
  if ('restauranteId' in alvo) {
    restauranteId = alvo.restauranteId
  } else {
    const { data, error } = await supabase.from(tabela).select('restaurante_id, nome').eq('id', alvo.id).maybeSingle()
    if (error) throw error
    if (!data) throw new ErroCadastroCardapio('Cadastro não encontrado. Recarregue a página.')
    // Mesmo nome de antes (mudou só fatias, peso ou preço): nada a conferir.
    if (chaveNomeCatalogo(data.nome) === chaveNomeCatalogo(nome)) return nome
    restauranteId = data.restaurante_id
  }
  const { data: existentes, error } = await supabase.from(tabela).select('id, nome').eq('restaurante_id', restauranteId)
  if (error) throw error
  if (nomeRepetidoNoCatalogo(existentes ?? [], nome, 'id' in alvo ? alvo.id : undefined)) {
    throw new ErroCadastroCardapio(`Já existe ${ROTULO[tabela]} chamado "${nome}" nesta loja.`)
  }
  return nome
}

/** Corrida entre duas abas: o índice recusa e a frase é a mesma da checagem. */
function traduzir(erro: unknown, tabela: TabelaCatalogo, nome: string): never {
  if (ehViolacaoDeUnicidade(erro)) throw new ErroCadastroCardapio(`Já existe ${ROTULO[tabela]} chamado "${nome}" nesta loja.`)
  throw erro
}

/**
 * Update/delete que o RLS barra não dá erro — só não muda nenhuma linha. Sem esta
 * conferência a tela dizia "salvo" para quem não tem permissão.
 */
function exigirLinha(data: unknown[] | null) {
  if (!data || data.length === 0) {
    throw new ErroCadastroCardapio('Não foi possível salvar: sem permissão ou cadastro já removido. Peça ao dono ou gerente.')
  }
}

// ─── Regra de preço da pizza multi-sabor ────────────────────────────────────

/** Como a loja calcula o preço da pizza com mais de um sabor. 'media' é o padrão. */
export async function buscarRegraPrecoPizza(supabase: ClienteLeitura, restauranteId: string): Promise<RegraPrecoPizza> {
  const { data, error } = await supabase
    .from('restaurantes')
    .select('pizza_calculo_preco')
    .eq('id', restauranteId)
    .maybeSingle()
  if (error) throw error
  return data?.pizza_calculo_preco === 'maior' ? 'maior' : 'media'
}

// ─── Tamanhos padrão de pizza ──────────────────────────────────────────────

export async function listarTamanhosPadraoPizza(supabase: ClienteLeitura, restauranteId: string): Promise<TamanhoPadraoPizza[]> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .select('id, nome, fatias, posicao, max_sabores')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((t) => ({
    id: t.id,
    nome: t.nome,
    fatias: t.fatias,
    posicao: t.posicao,
    maxSabores: Math.max(1, Number(t.max_sabores ?? 1)),
  }))
}

export async function criarTamanhoPadraoPizza(
  supabase: SupabaseClient,
  restauranteId: string,
  nome: string,
  fatias: number,
  posicao: number,
  maxSabores = 1,
): Promise<TamanhoPadraoPizza> {
  nome = await prepararNome(supabase, 'tamanhos_padrao_pizza', nome, { restauranteId })
  const { data, error } = await supabase
    .from('tamanhos_padrao_pizza')
    .insert({ restaurante_id: restauranteId, nome, fatias, posicao, max_sabores: Math.max(1, maxSabores) })
    .select('id, nome, fatias, posicao, max_sabores')
    .single()
  if (error) traduzir(error, 'tamanhos_padrao_pizza', nome)
  return { id: data.id, nome: data.nome, fatias: data.fatias, posicao: data.posicao, maxSabores: Math.max(1, Number(data.max_sabores ?? 1)) }
}

export async function atualizarTamanhoPadraoPizza(
  supabase: SupabaseClient,
  id: string,
  nome: string,
  fatias: number,
  maxSabores?: number,
) {
  nome = await prepararNome(supabase, 'tamanhos_padrao_pizza', nome, { id })
  const patch: { nome: string; fatias: number; max_sabores?: number } = { nome, fatias }
  if (maxSabores !== undefined) patch.max_sabores = Math.max(1, maxSabores)
  const { data, error } = await supabase.from('tamanhos_padrao_pizza').update(patch).eq('id', id).select('id')
  if (error) traduzir(error, 'tamanhos_padrao_pizza', nome)
  exigirLinha(data)
}

export async function removerTamanhoPadraoPizza(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from('tamanhos_padrao_pizza').delete().eq('id', id).select('id')
  if (error) throw error
  exigirLinha(data)
}

// ─── Tamanhos padrão de marmita ────────────────────────────────────────────

export async function listarTamanhosPadraoMarmita(supabase: SupabaseClient, restauranteId: string): Promise<TamanhoPadraoMarmita[]> {
  const { data, error } = await supabase
    .from('tamanhos_padrao_marmita')
    .select('id, nome, peso, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function criarTamanhoPadraoMarmita(supabase: SupabaseClient, restauranteId: string, nome: string, peso: string, posicao: number): Promise<TamanhoPadraoMarmita> {
  nome = await prepararNome(supabase, 'tamanhos_padrao_marmita', nome, { restauranteId })
  const { data, error } = await supabase
    .from('tamanhos_padrao_marmita')
    .insert({ restaurante_id: restauranteId, nome, peso, posicao })
    .select('id, nome, peso, posicao')
    .single()
  if (error) traduzir(error, 'tamanhos_padrao_marmita', nome)
  return data
}

export async function atualizarTamanhoPadraoMarmita(supabase: SupabaseClient, id: string, nome: string, peso: string) {
  nome = await prepararNome(supabase, 'tamanhos_padrao_marmita', nome, { id })
  const { data, error } = await supabase.from('tamanhos_padrao_marmita').update({ nome, peso }).eq('id', id).select('id')
  if (error) traduzir(error, 'tamanhos_padrao_marmita', nome)
  exigirLinha(data)
}

export async function removerTamanhoPadraoMarmita(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from('tamanhos_padrao_marmita').delete().eq('id', id).select('id')
  if (error) throw error
  exigirLinha(data)
}

// ─── Bordas de pizza ────────────────────────────────────────────────────────

export async function listarBordasPizza(supabase: ClienteLeitura, restauranteId: string): Promise<BordaPizza[]> {
  const { data, error } = await supabase
    .from('bordas_pizza')
    .select('id, nome, preco, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ ...d, preco: Number(d.preco) }))
}

export async function criarBordaPizza(supabase: SupabaseClient, restauranteId: string, nome: string, preco: number, posicao: number): Promise<BordaPizza> {
  nome = await prepararNome(supabase, 'bordas_pizza', nome, { restauranteId })
  const { data, error } = await supabase
    .from('bordas_pizza')
    .insert({ restaurante_id: restauranteId, nome, preco, posicao })
    .select('id, nome, preco, posicao')
    .single()
  if (error) traduzir(error, 'bordas_pizza', nome)
  return { ...data, preco: Number(data.preco) }
}

export async function atualizarBordaPizza(supabase: SupabaseClient, id: string, nome: string, preco: number) {
  nome = await prepararNome(supabase, 'bordas_pizza', nome, { id })
  const { data, error } = await supabase.from('bordas_pizza').update({ nome, preco }).eq('id', id).select('id')
  if (error) traduzir(error, 'bordas_pizza', nome)
  exigirLinha(data)
}

export async function removerBordaPizza(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from('bordas_pizza').delete().eq('id', id).select('id')
  if (error) throw error
  exigirLinha(data)
}

// ─── Massas de pizza ────────────────────────────────────────────────────────

export async function listarMassasPizza(supabase: ClienteLeitura, restauranteId: string): Promise<MassaPizza[]> {
  const { data, error } = await supabase
    .from('massas_pizza')
    .select('id, nome, preco, posicao')
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return (data ?? []).map((d) => ({ ...d, preco: Number(d.preco) }))
}

export async function criarMassaPizza(supabase: SupabaseClient, restauranteId: string, nome: string, preco: number, posicao: number): Promise<MassaPizza> {
  nome = await prepararNome(supabase, 'massas_pizza', nome, { restauranteId })
  const { data, error } = await supabase
    .from('massas_pizza')
    .insert({ restaurante_id: restauranteId, nome, preco, posicao })
    .select('id, nome, preco, posicao')
    .single()
  if (error) traduzir(error, 'massas_pizza', nome)
  return { ...data, preco: Number(data.preco) }
}

export async function atualizarMassaPizza(supabase: SupabaseClient, id: string, nome: string, preco: number) {
  nome = await prepararNome(supabase, 'massas_pizza', nome, { id })
  const { data, error } = await supabase.from('massas_pizza').update({ nome, preco }).eq('id', id).select('id')
  if (error) traduzir(error, 'massas_pizza', nome)
  exigirLinha(data)
}

export async function removerMassaPizza(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from('massas_pizza').delete().eq('id', id).select('id')
  if (error) throw error
  exigirLinha(data)
}
