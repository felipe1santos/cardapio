/**
 * Catálogo do painel do garçom — regra pura, testável sem tela.
 *
 * É o MESMO catálogo do delivery e da mesa pública: as mesmas linhas de
 * `itens_cardapio`, com os mesmos filtros (status, canal do salão, dia da semana,
 * horário da categoria). Aqui mora só o que é específico do lançamento manual:
 *
 *  - quais categorias o garçom enxerga AGORA (só as que têm item lançável) e qual abre
 *    primeiro — antes a tela abria na primeira categoria cadastrada, mesmo vazia, e
 *    mostrava "Nenhum item aqui" com Bebidas disponível logo ao lado;
 *  - o que falta escolher num item (tamanho, sabor, opções obrigatórias);
 *  - como um item da seleção do cliente vira linha de lançamento — só por ação do
 *    garçom, com preço atual e sem furar disponibilidade.
 *
 * Nada aqui é autoridade: o servidor revalida e reprecifica tudo no envio.
 */

import type { GrupoCardapio, ItemCardapio } from '@/lib/queries/cardapio'
import { categoriaNoHorario, itemDisponivelNoCanal } from '@/lib/canais-item'
import { validarOpcoes, type GrupoOpcoesRegra } from '@/lib/opcoes-item'

export interface Relogio {
  /** Item vendido hoje (dia da semana em São Paulo). */
  disponivelHoje: (dias: number[]) => boolean
  /** Categoria dentro da sua janela de horário agora. */
  categoriaAtiva: (g: { horarioAtivoInicio: string | null; horarioAtivoFim: string | null }) => boolean
}

export type MotivoIndisponivel = 'inexistente' | 'status' | 'canal' | 'dia' | 'horario' | 'sem_categoria'

export const TEXTO_MOTIVO: Record<MotivoIndisponivel, string> = {
  inexistente: 'saiu do cardápio',
  status: 'está pausado ou esgotado',
  canal: 'não é vendido no salão',
  dia: 'não é servido hoje',
  horario: 'é de uma categoria fora do horário agora',
  sem_categoria: 'está sem categoria no cardápio',
}

/** Por que o item não pode ser lançado agora. Null = pode. */
export function motivoIndisponivel(
  item: ItemCardapio | undefined,
  categorias: GrupoCardapio[],
  relogio: Relogio,
): MotivoIndisponivel | null {
  if (!item) return 'inexistente'
  if (item.status !== 'disponivel') return 'status'
  if (!itemDisponivelNoCanal(item, 'mesa')) return 'canal'
  if (!relogio.disponivelHoje(item.diasDisponiveis)) return 'dia'
  // Mesma regra da vitrine: item sem categoria não aparece em canal nenhum.
  if (!item.grupoId || !categorias.some((g) => g.id === item.grupoId)) return 'sem_categoria'
  if (!categoriaNoHorario(item, categorias, relogio.categoriaAtiva)) return 'horario'
  return null
}

/** Itens que o garçom pode lançar agora. */
export function itensLancaveis(itens: ItemCardapio[], categorias: GrupoCardapio[], relogio: Relogio): ItemCardapio[] {
  return itens.filter((i) => motivoIndisponivel(i, categorias, relogio) === null)
}

/**
 * Categorias com pelo menos um item lançável, na ordem do cardápio. Categoria vazia,
 * pausada ou fora do horário simplesmente não aparece como chip.
 */
export function categoriasComItens(categorias: GrupoCardapio[], lancaveis: ItemCardapio[]): GrupoCardapio[] {
  const comItem = new Set(lancaveis.map((i) => i.grupoId))
  return [...categorias].sort((a, b) => a.posicao - b.posicao).filter((g) => comItem.has(g.id))
}

/**
 * Categoria aberta: a atual se ainda tem item; senão a primeira que tem. Cobre a abertura
 * da tela e a categoria que fecha (horário, pausa) com a tela aberta.
 */
export function categoriaAtivaValida(atual: string | null, disponiveis: GrupoCardapio[]): string | null {
  if (atual && disponiveis.some((g) => g.id === atual)) return atual
  return disponiveis[0]?.id ?? null
}

/** Busca por nome ou descrição em TODAS as categorias disponíveis. */
export function buscarItens(lancaveis: ItemCardapio[], termo: string): ItemCardapio[] {
  const t = normalizar(termo)
  if (!t) return []
  return lancaveis.filter((i) => normalizar(i.nome).includes(t) || normalizar(i.descricao ?? '').includes(t))
}

function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** Por que a tela está vazia — para a mensagem não ser genérica. */
export function resumoIndisponibilidade(
  itens: ItemCardapio[],
  categorias: GrupoCardapio[],
  relogio: Relogio,
): { pausados: number; foraDoHorario: number; foraDoDia: number; semCategoria: number } {
  const r = { pausados: 0, foraDoHorario: 0, foraDoDia: 0, semCategoria: 0 }
  for (const i of itens) {
    const m = motivoIndisponivel(i, categorias, relogio)
    if (m === 'status') r.pausados++
    else if (m === 'horario') r.foraDoHorario++
    else if (m === 'dia') r.foraDoDia++
    else if (m === 'sem_categoria') r.semCategoria++
  }
  return r
}

// ── configuração do item ─────────────────────────────────────────────────────

/** Grupos de opções com pelo menos uma opção ativa — são os que viram escolha. */
export function gruposComOpcao(item: ItemCardapio) {
  return item.grupos
    .map((g) => ({ ...g, complementos: g.complementos.filter((c) => !c.pausado) }))
    .filter((g) => g.complementos.length > 0)
    .sort((a, b) => a.posicao - b.posicao)
}

export function regrasDoItem(item: ItemCardapio): GrupoOpcoesRegra[] {
  return gruposComOpcao(item).map((g) => ({
    nome: g.nome,
    obrigatorio: g.obrigatorio,
    minEscolhas: g.minEscolhas,
    maxEscolhas: g.maxEscolhas,
    opcoes: g.complementos.map((c) => c.nome),
  }))
}

/** Pizza precisa de tamanho e sabor; item com tamanhos precisa de tamanho. */
export function precisaTamanho(item: ItemCardapio): boolean {
  return item.tipoItem === 'pizza' || item.tamanhos.length > 0
}

/** Item que entra direto com um toque (sem nenhuma escolha a fazer). */
export function itemSimples(item: ItemCardapio): boolean {
  return !precisaTamanho(item) && gruposComOpcao(item).length === 0
}

/** Tem escolha obrigatória? (para o selo "opções obrigatórias" no card) */
export function temObrigatorio(item: ItemCardapio): boolean {
  return precisaTamanho(item) || regrasDoItem(item).some((r) => r.obrigatorio || r.minEscolhas > 0)
}

/** Preço de vitrine: "a partir de" quando depende de tamanho. */
export function precoDeVitrine(item: ItemCardapio): { valor: number; aPartirDe: boolean } {
  if (item.tamanhos.length > 0) {
    return { valor: Math.min(...item.tamanhos.map((t) => t.preco)), aPartirDe: true }
  }
  if (item.tipoItem === 'pizza') {
    const precos = item.sabores.filter((s) => s.status === 'disponivel').flatMap((s) => s.precos.map((p) => p.preco))
    return { valor: precos.length ? Math.min(...precos) : item.preco, aPartirDe: true }
  }
  return { valor: item.promocaoPreco ?? item.preco, aPartirDe: false }
}

// ── linha de lançamento ──────────────────────────────────────────────────────

export interface EscolhaItem {
  complementos: { nome: string; preco: number }[]
  tamanhoNome?: string
  saborNome?: string
  bordaNome?: string
  massaNome?: string
  quantidade: number
  observacao: string
}

export interface LinhaLancamento extends EscolhaItem {
  chave: string
  itemId: string
  nome: string
  /** Unitário estimado com as opções — só para exibir; o servidor reprecifica. */
  preco: number
  /** Motivo pelo qual o servidor recusou esta linha no último envio. */
  indisponivel?: string | null
  /** Chave da linha da seleção do cliente que originou esta, quando veio de lá. */
  origemSelecao?: string | null
}

/** Unitário estimado de uma escolha simples (sem pizza): base (ou tamanho) + opções. */
export function precoEstimado(item: ItemCardapio, escolha: Pick<EscolhaItem, 'complementos' | 'tamanhoNome'>): number {
  const tamanho = escolha.tamanhoNome ? item.tamanhos.find((t) => t.nome === escolha.tamanhoNome) : undefined
  const base = tamanho ? tamanho.preco : (item.promocaoPreco ?? item.preco)
  return base + escolha.complementos.reduce((s, c) => s + c.preco, 0)
}

/** Assinatura que junta toques repetidos no mesmo item com as mesmas escolhas. */
export function assinatura(l: Pick<LinhaLancamento, 'itemId' | 'complementos' | 'tamanhoNome' | 'saborNome' | 'bordaNome' | 'massaNome' | 'observacao'>): string {
  return [
    l.itemId,
    [...l.complementos.map((c) => c.nome)].sort().join('|'),
    l.tamanhoNome ?? '',
    l.saborNome ?? '',
    l.bordaNome ?? '',
    l.massaNome ?? '',
    l.observacao.trim(),
  ].join('§')
}

/** Adiciona ao lançamento juntando na linha igual (mesmo item, mesmas escolhas). */
export function adicionarAoLancamento(atual: LinhaLancamento[], nova: LinhaLancamento): LinhaLancamento[] {
  const chave = assinatura(nova)
  const existente = atual.find((l) => assinatura(l) === chave && !l.indisponivel)
  if (existente) {
    return atual.map((l) =>
      l === existente
        ? { ...l, quantidade: Math.min(99, l.quantidade + nova.quantidade), origemSelecao: l.origemSelecao ?? nova.origemSelecao }
        : l,
    )
  }
  return [...atual, nova]
}

export function totalDoLancamento(linhas: LinhaLancamento[]): { itens: number; total: number } {
  return linhas.reduce(
    (acc, l) => ({ itens: acc.itens + l.quantidade, total: acc.total + l.preco * l.quantidade }),
    { itens: 0, total: 0 },
  )
}

/** Por que o envio está bloqueado. Null = pode enviar. */
export function bloqueioDoEnvio(linhas: LinhaLancamento[], enviando: boolean): string | null {
  if (enviando) return 'Enviando…'
  if (linhas.length === 0) return 'Adicione pelo menos um item.'
  if (linhas.some((l) => l.indisponivel)) return 'Há item indisponível: troque ou remova antes de enviar.'
  if (linhas.some((l) => l.quantidade < 1 || l.quantidade > 99)) return 'Quantidade inválida.'
  return null
}

// ── seleção do cliente → lançamento, só por ação do garçom ───────────────────

export interface LinhaSelecao {
  /** Chave estável da linha na tela (seleção + posição). */
  chave: string
  itemId: string | null
  nome: string
  quantidade: number
  precoUnitario: number
  observacao: string
  opcoes: { grupo: string; escolha: string; preco: number }[]
}

export type ResultadoSelecao =
  | { tipo: 'pronto'; linha: LinhaLancamento; precoMudou: boolean }
  | { tipo: 'configurar'; item: ItemCardapio; preescolha: Partial<EscolhaItem>; motivo: string }
  | { tipo: 'indisponivel'; motivo: string }

/**
 * Converte uma linha da seleção do cliente numa linha de lançamento.
 *
 * Nunca importa às cegas: item fora do ar é recusado com o motivo; opção que não existe
 * mais ou obrigatório sem resposta abre o configurador já preenchido; o preço é sempre o
 * do catálogo agora (e avisa se mudou desde que o cliente marcou).
 */
export function resolverDaSelecao(
  sel: LinhaSelecao,
  todos: ItemCardapio[],
  categorias: GrupoCardapio[],
  relogio: Relogio,
): ResultadoSelecao {
  const item = sel.itemId ? todos.find((i) => i.id === sel.itemId) : undefined
  const motivo = motivoIndisponivel(item, categorias, relogio)
  if (motivo || !item) return { tipo: 'indisponivel', motivo: `"${sel.nome}" ${TEXTO_MOTIVO[motivo ?? 'inexistente']}.` }

  // Pizza e tamanho: o cliente escolhe no celular, mas o garçom confirma no configurador.
  if (precisaTamanho(item)) {
    return {
      tipo: 'configurar', item, motivo: 'Confirme tamanho e sabor com o cliente.',
      preescolha: { quantidade: sel.quantidade, observacao: sel.observacao },
    }
  }

  const grupos = gruposComOpcao(item)
  const opcoesAtivas = new Map(grupos.flatMap((g) => g.complementos.map((c) => [c.nome, c.preco] as const)))
  const escolhidas = sel.opcoes.map((o) => o.escolha)
  const sumiu = escolhidas.filter((n) => !opcoesAtivas.has(n))
  const complementos = escolhidas.filter((n) => opcoesAtivas.has(n)).map((n) => ({ nome: n, preco: opcoesAtivas.get(n)! }))
  const erros = validarOpcoes(regrasDoItem(item), complementos.map((c) => c.nome))

  if (sumiu.length > 0 || erros.length > 0) {
    return {
      tipo: 'configurar', item,
      motivo: sumiu.length > 0 ? `Opção fora do cardápio: ${sumiu.join(', ')}.` : erros[0]!,
      preescolha: { complementos, quantidade: sel.quantidade, observacao: sel.observacao },
    }
  }

  const preco = precoEstimado(item, { complementos })
  const precoCliente = sel.precoUnitario + sel.opcoes.reduce((s, o) => s + (Number.isFinite(o.preco) ? o.preco : 0), 0)
  return {
    tipo: 'pronto',
    precoMudou: Math.abs(precoCliente - preco) > 0.004,
    linha: {
      chave: crypto.randomUUID(),
      itemId: item.id,
      nome: item.nome,
      preco,
      quantidade: Math.max(1, Math.min(99, Math.floor(sel.quantidade) || 1)),
      observacao: (sel.observacao ?? '').slice(0, 200),
      complementos,
      origemSelecao: sel.chave,
    },
  }
}
