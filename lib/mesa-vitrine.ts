/**
 * Personalização do cardápio da mesa (QR) pela gestão: carrossel do topo, texto do aviso
 * da seleção. Regra pura — a rota usa para validar, a página usa para o texto padrão.
 */

export const MESA_CARROSSEL_MAX = 8
export const MESA_MENSAGEM_MAX = 280
export const MESA_MENSAGEM_PADRAO =
  'Esta é apenas a sua seleção. Mostre-a ao garçom para realizar o pedido. Nada foi enviado para a cozinha.'

/**
 * Em "somente visualização" não existe seleção para mostrar ao garçom, então o texto
 * padrão não pode falar dela. O recado da loja (quando houver) continua valendo nos
 * dois modos — este padrão só entra quando ela não escreveu nada.
 */
export const MESA_MENSAGEM_PADRAO_VISUALIZACAO =
  'Este cardápio é só para consultar. Para pedir, chame o garçom.'

export function mensagemPadraoDaMesa(somenteVisualizacao: boolean): string {
  return somenteVisualizacao ? MESA_MENSAGEM_PADRAO_VISUALIZACAO : MESA_MENSAGEM_PADRAO
}

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

// A ordem própria da mesa (0073/0074) saiu: categorias e itens seguem o Gestor de
// Cardápio em todos os canais (0101, lib/ordem-cardapio.ts).
