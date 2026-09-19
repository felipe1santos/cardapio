/**
 * Personalização do cardápio da mesa (QR) pela gestão: carrossel do topo, texto do aviso
 * da seleção e ordem dos itens. Regra pura — a rota usa para validar, a página usa para
 * ordenar e para o texto padrão.
 */

export const MESA_CARROSSEL_MAX = 8
export const MESA_MENSAGEM_MAX = 280
export const MESA_MENSAGEM_PADRAO =
  'Esta é apenas a sua seleção. Mostre-a ao garçom para realizar o pedido. Nada foi enviado para a cozinha.'

/**
 * Só imagens do próprio armazenamento da loja entram no carrossel (bucket `cardapio`,
 * pasta da loja). Evita virar vitrine de imagem externa ou de outra loja.
 */
export function carrosselValido(
  bruto: unknown,
  base: { supabaseUrl: string; restauranteId: string },
): { ok: true; urls: string[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto)) return { ok: false, erro: 'Carrossel inválido.' }
  if (bruto.length > MESA_CARROSSEL_MAX) return { ok: false, erro: `No máximo ${MESA_CARROSSEL_MAX} imagens no carrossel.` }
  const prefixo = `${base.supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/cardapio/${base.restauranteId}/`
  const urls: string[] = []
  for (const u of bruto) {
    if (typeof u !== 'string' || u.length > 600 || !u.startsWith(prefixo) || /\.\.|[\s"'<>]/.test(u.slice(prefixo.length))) {
      return { ok: false, erro: 'Imagem do carrossel inválida.' }
    }
    if (!urls.includes(u)) urls.push(u)
  }
  return { ok: true, urls }
}

/** Texto do aviso: vazio volta ao padrão (null); acima do limite é recusado. */
export function mensagemValida(bruto: unknown): { ok: true; texto: string | null } | { ok: false; erro: string } {
  if (bruto === null || bruto === undefined) return { ok: true, texto: null }
  if (typeof bruto !== 'string') return { ok: false, erro: 'Mensagem inválida.' }
  const texto = bruto.replace(/\s+/g, ' ').trim()
  if (texto.length > MESA_MENSAGEM_MAX) return { ok: false, erro: `A mensagem pode ter até ${MESA_MENSAGEM_MAX} caracteres.` }
  return { ok: true, texto: texto || null }
}

/**
 * Ordem enviada pela tela: lista de ids na ordem desejada (por categoria ou de tudo).
 * Devolve só os ids desta loja, sem repetição, com a posição 1..n.
 */
export function ordemValida(bruto: unknown, idsDaLoja: Set<string>): { ok: true; posicoes: { id: string; posicao: number }[] } | { ok: false; erro: string } {
  if (!Array.isArray(bruto) || bruto.length > 2000) return { ok: false, erro: 'Ordem inválida.' }
  const vistos = new Set<string>()
  const posicoes: { id: string; posicao: number }[] = []
  for (const id of bruto) {
    if (typeof id !== 'string' || !idsDaLoja.has(id)) return { ok: false, erro: 'Categoria fora desta loja na ordem.' }
    if (vistos.has(id)) continue
    vistos.add(id)
    posicoes.push({ id, posicao: posicoes.length + 1 })
  }
  return { ok: true, posicoes }
}

/**
 * Ordena os itens do cardápio da mesa: primeiro os que têm posição definida (menor
 * antes), depois os sem posição, na ordem em que já vinham. Estável.
 */
export function ordenarParaMesa<T extends { id: string }>(itens: T[], posicao: Map<string, number | null>): T[] {
  return itens
    .map((item, indice) => ({ item, indice, p: posicao.get(item.id) ?? null }))
    .sort((a, b) => {
      if (a.p !== null && b.p !== null) return a.p - b.p || a.indice - b.indice
      if (a.p !== null) return -1
      if (b.p !== null) return 1
      return a.indice - b.indice
    })
    .map((x) => x.item)
}
