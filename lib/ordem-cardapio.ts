/**
 * Ordem do cardápio — a regra ÚNICA que a vitrine (delivery), o QR de visualização e o
 * QR ativo da mesa usam para decidir em que ordem aparecem categorias e itens.
 *
 * Antes cada tela ordenava do seu jeito: a vitrine pela ordem das categorias e pela
 * data de criação dos itens, a mesa por uma ordem própria de categorias. Agora o Gestor
 * de Cardápio define a ordem (0101) e todos os canais leem daqui.
 *
 * Desempate determinístico, sempre o mesmo: posição configurada → criação → id.
 *
 * O que cada canal mostra (status, canal, dia, horário) continua sendo decidido por quem
 * chama — esta regra só ORDENA e agrupa, não esconde nem muda preço.
 */

export interface Ordenavel {
  id: string
  /** Posição configurada. `null`/ausente = depois das configuradas. */
  posicao?: number | null
  /** ISO de criação. Ausente = empata e cai no id. */
  criadoEm?: string | null
}

export function compararOrdem(a: Ordenavel, b: Ordenavel): number {
  const pa = a.posicao ?? null
  const pb = b.posicao ?? null
  if (pa !== pb) {
    if (pa === null) return 1
    if (pb === null) return -1
    return pa - pb
  }
  const ca = a.criadoEm ?? ''
  const cb = b.criadoEm ?? ''
  if (ca !== cb) return ca < cb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function ordenar<T extends Ordenavel>(lista: readonly T[]): T[] {
  return [...lista].sort(compararOrdem)
}

/**
 * Ordem das categorias. `posicaoMesa` só é passada pelo QR: a loja que configurou uma
 * ordem própria para a mesa em Ajustes › Mesas (0074) continua com ela; as categorias
 * sem posição de mesa vêm depois, na ordem do Gestor. Sem nenhuma posição de mesa, o QR
 * segue exatamente a ordem do Gestor.
 */
export function ordenarCategorias<T extends Ordenavel>(grupos: readonly T[], posicaoMesa?: ReadonlyMap<string, number | null>): T[] {
  const base = ordenar(grupos)
  if (!posicaoMesa || ![...posicaoMesa.values()].some((p) => p !== null && p !== undefined)) return base
  return base
    .map((g, indice) => ({ g, indice, p: posicaoMesa.get(g.id) ?? null }))
    .sort((a, b) => {
      if (a.p !== null && b.p !== null) return a.p - b.p || a.indice - b.indice
      if (a.p !== null) return -1
      if (b.p !== null) return 1
      return a.indice - b.indice
    })
    .map((x) => x.g)
}

export interface CategoriaComItens<G, I> {
  grupo: G
  itens: I[]
}

/**
 * Cardápio agrupado e ordenado: categorias na ordem configurada, cada uma com os seus
 * itens na ordem configurada. Categoria que fica sem item visível sai da lista.
 */
export function cardapioOrdenado<G extends Ordenavel, I extends Ordenavel & { grupoId: string | null }>(
  grupos: readonly G[],
  itens: readonly I[],
  opcoes: {
    itemVisivel?: (item: I) => boolean
    grupoVisivel?: (grupo: G) => boolean
    posicaoMesa?: ReadonlyMap<string, number | null>
  } = {},
): CategoriaComItens<G, I>[] {
  const porGrupo = new Map<string, I[]>()
  for (const item of itens) {
    if (!item.grupoId || (opcoes.itemVisivel && !opcoes.itemVisivel(item))) continue
    const lista = porGrupo.get(item.grupoId)
    if (lista) lista.push(item)
    else porGrupo.set(item.grupoId, [item])
  }
  return ordenarCategorias(grupos, opcoes.posicaoMesa)
    .filter((g) => !opcoes.grupoVisivel || opcoes.grupoVisivel(g))
    .map((grupo) => ({ grupo, itens: ordenar(porGrupo.get(grupo.id) ?? []) }))
    .filter((c) => c.itens.length > 0)
}

/**
 * Nova ordem depois de mover `id` para o índice `destino` (0..n-1). Pura: a tela usa
 * para o arraste, os botões e o teclado.
 */
export function moverNaLista(ids: readonly string[], id: string, destino: number): string[] {
  const de = ids.indexOf(id)
  if (de < 0) return [...ids]
  const alvo = Math.max(0, Math.min(ids.length - 1, destino))
  if (alvo === de) return [...ids]
  const nova = ids.filter((x) => x !== id)
  nova.splice(alvo, 0, id)
  return nova
}

/**
 * Lista que o servidor aceita para reordenar: não vazia, só texto, sem repetição e sem
 * nada de fora do conjunto esperado. Conferir se está COMPLETA é do banco, que tranca as
 * linhas antes (0101) — assim duas abas não fazem item sumir.
 */
export function listaDeOrdemValida(bruto: unknown, limite: number): { ok: true; ids: string[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto) || bruto.length === 0 || bruto.length > limite) return { ok: false, erro: 'Ordem inválida.' }
  const vistos = new Set<string>()
  for (const id of bruto) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, erro: 'Ordem inválida.' }
    if (vistos.has(id)) return { ok: false, erro: 'Item repetido na ordem.' }
    vistos.add(id)
  }
  return { ok: true, ids: [...vistos] }
}
