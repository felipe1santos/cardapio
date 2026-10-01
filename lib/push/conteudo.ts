/**
 * Conteúdo das notificações push (2026-10-01): o que vai no payload que o service worker da
 * vitrine mostra. Sempre da loja dona da assinatura — título, ícone, badge e link.
 */
import type { TipoAutomacao } from './regras'

export const LIMITE_TITULO = 60
export const LIMITE_TEXTO = 140

export interface PayloadPush {
  title: string
  body: string
  icon: string
  badge: string
  image?: string
  tag: string
  data: { url: string; envio?: string; loja: string }
}

/** Corta no limite com "…" (sem deixar espaço antes das reticências). */
export function cortar(texto: string, limite: number): string {
  const t = texto.replace(/\s+/g, ' ').trim()
  if (t.length <= limite) return t
  return t.slice(0, limite - 1).trimEnd() + '…'
}

/** Troca {nome}, {loja}, {produto}, {cupom}, {desconto}… Variável sem valor some (e o espaço junto). */
export function aplicarVariaveis(texto: string, vars: Record<string, string | undefined>): string {
  return texto
    // Variável vazia leva junto a vírgula/espaço antes dela ("Bateu a fome, {nome}?" → "Bateu a fome?").
    .replace(/(,?\s*)\{(\w+)\}/g, (_, antes: string, k: string) => {
      const v = (vars[k] ?? '').trim()
      return v ? antes + v : ''
    })
    .replace(/\s+([,.!?…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/** Primeiro nome, para "{nome}". */
export function primeiroNome(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0] ?? ''
}

/**
 * Link de destino dentro da loja, com o parâmetro de origem (`push=<envio>`) para medir clique e
 * pedido. `destino` vem sem domínio: "" (cardápio), "?item=<id>", "?cupom=X", "?aba=pedidos".
 */
export function linkDaLoja(slug: string, destino: string, envioId?: string): string {
  const base = `/loja/${slug}`
  const [caminhoExtra, query = ''] = destino.startsWith('?') ? ['', destino.slice(1)] : destino.split('?')
  const params = new URLSearchParams(query)
  if (envioId) params.set('push', envioId)
  const q = params.toString()
  return `${base}${caminhoExtra}${q ? `?${q}` : ''}`
}

export function montarPayload(p: {
  slug: string
  lojaNome: string
  versaoIcone: string
  titulo?: string | null
  texto: string
  destino: string
  envioId?: string
  tipo: TipoAutomacao | 'avulsa' | 'teste'
  imagem?: string | null
}): PayloadPush {
  const titulo = cortar((p.titulo ?? '').trim() || p.lojaNome, LIMITE_TITULO)
  const payload: PayloadPush = {
    title: titulo,
    body: cortar(p.texto, LIMITE_TEXTO),
    icon: `/api/loja/${p.slug}/icone/192?v=${p.versaoIcone}`,
    badge: `/api/loja/${p.slug}/push/badge?v=${p.versaoIcone}`,
    // Mesma "tag" substitui a anterior do mesmo tipo (status do pedido não empilha).
    tag: `${p.slug}:${p.tipo}`,
    data: { url: linkDaLoja(p.slug, p.destino, p.envioId), envio: p.envioId, loja: p.slug },
  }
  if (p.imagem) payload.image = p.imagem
  return payload
}

/** Textos padrão de cada automação (a loja edita). */
export const TEXTOS_PADRAO: Record<TipoAutomacao, { titulo: string; texto: string; params?: Record<string, number> }> = {
  loja_abriu: { titulo: '{loja}', texto: 'Abrimos! 🍔 Hoje tem {desconto}' },
  recompra: { titulo: '{loja}', texto: 'Bateu a fome, {nome}? Peça de novo seu {produto}.', params: { dias: 3 } },
  inativo: { titulo: '{loja}', texto: 'Sentimos sua falta, {nome}! Dá uma olhada no cardápio de hoje.', params: { dias: 6, repetir_dias: 14 } },
  item_novo: { titulo: '{loja}', texto: 'Novidade no cardápio: {produto}. Vem experimentar!' },
  cupom_novo: { titulo: '{loja}', texto: 'Cupom novo para você: {cupom} — {desconto}.' },
  frete_gratis: { titulo: '{loja}', texto: 'Frete grátis {desconto}! Aproveite, {nome}.' },
  fidelidade: { titulo: '{loja}', texto: 'Faltam {faltam} para o seu prêmio, {nome}! 🎁' },
  // Transacional: textos fixos (textoStatusPedido); a loja só liga/desliga.
  status_pedido: { titulo: '{loja}', texto: '' },
}

/** Fidelidade: texto do prêmio liberado (params.texto_premio da automação). */
export const TEXTO_PREMIO_PADRAO = 'Seu prêmio está liberado, {nome}! Resgate no próximo pedido. 🎉'

/** Variáveis aceitas em cada automação (o painel lista e valida). */
export const VARIAVEIS_DO_TIPO: Record<TipoAutomacao, string[]> = {
  loja_abriu: ['nome', 'loja', 'produto', 'desconto'],
  recompra: ['nome', 'loja', 'produto'],
  inativo: ['nome', 'loja'],
  item_novo: ['nome', 'loja', 'produto'],
  cupom_novo: ['nome', 'loja', 'cupom', 'desconto'],
  frete_gratis: ['nome', 'loja', 'desconto'],
  fidelidade: ['nome', 'loja', 'faltam'],
  status_pedido: [],
}

/** Textos fixos do status do pedido (transacional). */
export function textoStatusPedido(status: string, tipoEntrega: string, numero: number | string): string | null {
  if (status === 'preparando') return `Pedido #${numero} aceito! Já estamos preparando.`
  if (status === 'em_rota') return `Pedido #${numero} saiu para entrega! 🛵`
  if (status === 'pronto' && tipoEntrega === 'retirada') return `Pedido #${numero} pronto para retirada!`
  return null
}
