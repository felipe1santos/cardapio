/**
 * Eventos de conversão da vitrine para o Meta Pixel e o Google tag (2026-10-03).
 *
 * Antes só saía PageView: o Gerenciador de Eventos mostrava 0 carrinho e 0 compra mesmo com
 * pedidos reais vindos do anúncio. Aqui ficam os eventos padrão, sempre em BRL, com os itens e
 * um event_id único — o mesmo que o servidor manda pela API de Conversões no Purchase, para o
 * Meta não contar a compra duas vezes.
 *
 * Funções sem pixel/tag configurado não fazem nada. Nada aqui lê ou manda dados pessoais.
 */

export interface LinhaPixel {
  itemId: string
  nome?: string
  qty: number
  unit: number
}

export interface ParametrosConteudo {
  content_ids: string[]
  contents: { id: string; quantity: number; item_price: number }[]
  content_type: 'product'
  num_items: number
  value: number
  currency: 'BRL'
}

const centavos = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100

/** Itens no formato do Meta (agrupa o mesmo item em linhas diferentes da sacola). */
export function parametrosDoCarrinho(linhas: LinhaPixel[], valor?: number): ParametrosConteudo {
  const porItem = new Map<string, { quantity: number; total: number }>()
  for (const l of linhas) {
    if (!l.itemId || !(l.qty > 0)) continue
    const a = porItem.get(l.itemId) ?? { quantity: 0, total: 0 }
    a.quantity += l.qty
    a.total += l.unit * l.qty
    porItem.set(l.itemId, a)
  }
  const contents = [...porItem].map(([id, a]) => ({ id, quantity: a.quantity, item_price: centavos(a.total / a.quantity) }))
  const soma = contents.reduce((s, c) => s + c.item_price * c.quantity, 0)
  return {
    content_ids: contents.map((c) => c.id),
    contents,
    content_type: 'product',
    num_items: contents.reduce((s, c) => s + c.quantity, 0),
    value: centavos(valor ?? soma),
    currency: 'BRL',
  }
}

/** event_id do Purchase: o mesmo no navegador e no servidor (API de Conversões). */
export const eventIdDoPedido = (pedidoId: string) => `pedido-${pedidoId}`

export type EventoMeta = 'ViewContent' | 'AddToCart' | 'InitiateCheckout' | 'AddPaymentInfo' | 'Purchase'
const GA4: Record<EventoMeta, string> = {
  ViewContent: 'view_item', AddToCart: 'add_to_cart', InitiateCheckout: 'begin_checkout', AddPaymentInfo: 'add_payment_info', Purchase: 'purchase',
}

type Janela = Window & { fbq?: (...a: unknown[]) => void; gtag?: (...a: unknown[]) => void }

/** Purchase já enviado (recarregar a página de confirmação não manda de novo). */
function jaEnviado(chave: string): boolean {
  try {
    if (sessionStorage.getItem(chave)) return true
    sessionStorage.setItem(chave, '1')
  } catch { /* sem storage: segue a guarda em memória */ }
  return false
}
const enviadosNestaPagina = new Set<string>()

/**
 * Manda o evento ao Meta e ao Google (se configurados). `eventId` evita duplicar: o mesmo id
 * não sai duas vezes nesta aba (StrictMode, re-render, clique duplo).
 */
export function rastrearConversao(evento: EventoMeta, p: ParametrosConteudo, eventId: string, extra?: { transactionId?: string; formaPagamento?: string }) {
  if (typeof window === 'undefined') return
  const chave = `mz-pixel:${evento}:${eventId}`
  if (enviadosNestaPagina.has(chave)) return
  enviadosNestaPagina.add(chave)
  if (evento === 'Purchase' && jaEnviado(chave)) return
  const w = window as Janela
  try {
    w.fbq?.('track', evento, { ...p }, { eventID: eventId })
  } catch { /* pixel bloqueado pelo navegador: não atrapalha a compra */ }
  try {
    w.gtag?.('event', GA4[evento], {
      currency: p.currency,
      value: p.value,
      ...(extra?.transactionId ? { transaction_id: extra.transactionId } : {}),
      ...(extra?.formaPagamento ? { payment_type: extra.formaPagamento } : {}),
      items: p.contents.map((c) => ({ item_id: c.id, quantity: c.quantity, price: c.item_price })),
    })
  } catch { /* idem */ }
}

/** Id curto e único por evento (o Purchase usa o id do pedido). */
export function novoEventId(prefixo: string): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefixo}-${r}`
}

/**
 * Identificadores do Meta para a API de Conversões (sem dado pessoal):
 * `_fbp` (cookie do pixel) e `_fbc` (clique do anúncio — do cookie ou do `fbclid` da URL).
 */
export function idsMetaDoNavegador(): { fbp?: string; fbc?: string } {
  if (typeof document === 'undefined') return {}
  const cookie = (n: string) => document.cookie.split('; ').find((c) => c.startsWith(`${n}=`))?.slice(n.length + 1)
  const fbp = cookie('_fbp')
  let fbc = cookie('_fbc')
  if (!fbc) {
    try { fbc = sessionStorage.getItem('mz-fbc') ?? undefined } catch { /* sem storage */ }
  }
  const ok = (v?: string) => (v && /^fb\.\d\.\d+\.[\w.-]{4,500}$/.test(v) ? v : undefined)
  return { fbp: ok(fbp), fbc: ok(fbc) }
}

/** Guarda o clique do anúncio (`fbclid`) da URL de entrada, no formato `_fbc` do Meta. */
export function guardarCliqueDoAnuncio(url: string) {
  try {
    const fbclid = new URL(url).searchParams.get('fbclid')
    if (fbclid && /^[\w.-]{4,500}$/.test(fbclid)) sessionStorage.setItem('mz-fbc', `fb.1.${Date.now()}.${fbclid}`)
  } catch { /* URL inválida ou sem storage */ }
}
