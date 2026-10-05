/**
 * Origem das visitas e dos pedidos (item 55, 2026-10-05). Regras puras, testadas em origem-visita.test.ts.
 *
 * 1) CAPTURA (na abertura da vitrine): utm_source/utm_medium/utm_campaign, gclid, fbclid e o domínio de
 *    quem mandou (document.referrer). Os links do próprio Menuzia passam a se marcar: campanhas e robô
 *    (utm_source=whatsapp), QR Code do cardápio (utm_source=qrcode).
 * 2) CANAL: cada origem crua vira um canal — Direto, Instagram, Facebook, Meta (anúncio sem rede definida),
 *    Google Anúncio, Google Busca, WhatsApp (inclui as Campanhas), QR Code, Outros.
 * 3) ATRIBUIÇÃO do pedido: a ÚLTIMA origem NÃO-DIRETA do aparelho nos últimos 7 dias (guardada no
 *    navegador). Sem nenhuma nesse prazo: Direto. Uma visita direta NÃO apaga a origem anterior (quem
 *    veio do anúncio ontem e voltou digitando o endereço hoje conta como anúncio).
 */
export type CanalOrigem = 'direto' | 'instagram' | 'facebook' | 'meta' | 'google_anuncio' | 'google_busca' | 'whatsapp' | 'qrcode' | 'outros'

export const CANAIS: readonly CanalOrigem[] = ['direto', 'instagram', 'facebook', 'meta', 'google_anuncio', 'google_busca', 'whatsapp', 'qrcode', 'outros']

export const ROTULO_CANAL: Record<CanalOrigem, string> = {
  direto: 'Direto', instagram: 'Instagram', facebook: 'Facebook', meta: 'Meta (anúncio)', google_anuncio: 'Google Anúncio',
  google_busca: 'Google Busca', whatsapp: 'WhatsApp', qrcode: 'QR Code', outros: 'Outros',
}

/** Janela da atribuição: a última origem não-direta vale por 7 dias. */
export const JANELA_ATRIBUICAO_MS = 7 * 86_400_000

export interface OrigemBruta {
  /** utm_source, "qrcode" ou o domínio de quem mandou ("l.instagram.com"); null = direto. */
  fonte: string | null
  meio: string | null
  campanha: string | null
  /** Clique de anúncio na URL. */
  clique: 'gclid' | 'fbclid' | null
}

const limpar = (v: string | null | undefined, n = 60) => {
  const t = (v ?? '').trim().toLowerCase().replace(/[^\w.\-+ ]/g, '').slice(0, n)
  return t || null
}

/** Lê a origem desta abertura. Referência do próprio site (navegação interna) não conta. */
export function capturarOrigem(p: { busca: string; referrer: string; hostAtual: string }): OrigemBruta {
  const q = new URLSearchParams(p.busca)
  const clique: OrigemBruta['clique'] = q.get('gclid') || q.get('gbraid') || q.get('wbraid') ? 'gclid' : q.get('fbclid') ? 'fbclid' : null
  let fonte = limpar(q.get('utm_source'), 40)
  if (!fonte && p.referrer) {
    try {
      const host = new URL(p.referrer).hostname.replace(/^www\./, '').toLowerCase()
      if (host && host !== p.hostAtual.replace(/^www\./, '').toLowerCase()) fonte = host.slice(0, 60)
    } catch { /* referrer inválido: sem fonte */ }
  }
  return { fonte, meio: limpar(q.get('utm_medium'), 40), campanha: limpar(q.get('utm_campaign'), 80), clique }
}

export function ehDireta(o: OrigemBruta): boolean {
  return !o.fonte && !o.clique
}

const tem = (s: string, ...partes: string[]) => partes.some((x) => s === x || s.endsWith(`.${x}`) || s.startsWith(`${x}.`))

/** Canal de uma origem crua (também aceita o texto antigo gravado nas visitas: "ig", "l.wl.co", "Direto"…). */
export function canalDaOrigem(o: Pick<OrigemBruta, 'fonte' | 'meio' | 'clique'>): CanalOrigem {
  const f = (o.fonte ?? '').toLowerCase()
  const meio = (o.meio ?? '').toLowerCase()
  const pago = /^(cpc|ppc|paid|pago|ads?|paidsocial|paid_social|cpm)$/.test(meio)
  if (!f || f === 'direto') {
    if (o.clique === 'gclid') return 'google_anuncio'
    if (o.clique === 'fbclid') return 'meta'
    return 'direto'
  }
  if (tem(f, 'ig', 'instagram', 'instagram.com', 'l.instagram.com')) return 'instagram'
  if (tem(f, 'meta', 'an', 'msg', 'adsmanager.facebook.com', 'business.facebook.com', 'threads', 'threads.net', 'messenger.com')) return 'meta'
  if (tem(f, 'fb', 'facebook', 'facebook.com', 'm.facebook.com', 'l.facebook.com', 'lm.facebook.com', 'mbasic.facebook.com')) return 'facebook'
  if (/^google(\.|$)|\.google\.|googleadservices|googlesyndication|doubleclick/.test(f) || f === 'google' || f === 'gads' || f === 'adwords') {
    return pago || o.clique === 'gclid' || /googleadservices|googlesyndication|doubleclick|^gads$|^adwords$/.test(f) ? 'google_anuncio' : 'google_busca'
  }
  if (tem(f, 'whatsapp', 'wa', 'wa.me', 'l.wl.co', 'api.whatsapp.com', 'web.whatsapp.com', 'chat.whatsapp.com', 'whatsapp.com', 'campanha', 'menuzia-campanha')) return 'whatsapp'
  if (tem(f, 'qr', 'qrcode', 'qr-code', 'qr_code')) return 'qrcode'
  if (o.clique === 'gclid') return 'google_anuncio'
  if (o.clique === 'fbclid') return 'meta'
  return 'outros'
}

/** Texto curto gravado na visita (compatível com o que já existe: utm_source ou domínio; "Direto"). */
export function textoDaVisita(o: OrigemBruta): string {
  if (o.fonte) return o.fonte.slice(0, 60)
  if (o.clique === 'gclid') return 'google-ads'
  if (o.clique === 'fbclid') return 'meta-ads'
  return 'Direto'
}

export interface OrigemAtribuida extends OrigemBruta { canal: CanalOrigem; em: number }

/**
 * Atribuição: a origem desta abertura, se não for direta; senão a última não-direta guardada há menos de
 * 7 dias; senão Direto. Devolve também o que guardar (null = manter o guardado).
 */
export function atribuirOrigem(atual: OrigemBruta, guardada: OrigemAtribuida | null, agora: number): { atribuida: OrigemAtribuida; guardar: OrigemAtribuida | null } {
  if (!ehDireta(atual)) {
    const a = { ...atual, canal: canalDaOrigem(atual), em: agora }
    return { atribuida: a, guardar: a }
  }
  if (guardada && agora - guardada.em <= JANELA_ATRIBUICAO_MS && guardada.canal !== 'direto') return { atribuida: guardada, guardar: null }
  return { atribuida: { fonte: null, meio: null, campanha: null, clique: null, canal: 'direto', em: agora }, guardar: null }
}

/** Valida o que a vitrine manda junto do pedido (só análise — nunca decide dinheiro). */
export function origemDoPedido(bruto: unknown): { canal: CanalOrigem; detalhe: { fonte: string | null; meio: string | null; campanha: string | null; clique: string | null } } {
  const o = (bruto ?? {}) as Record<string, unknown>
  const txt = (v: unknown, n: number) => (typeof v === 'string' ? limpar(v, n) : null)
  const det = { fonte: txt(o.fonte, 60), meio: txt(o.meio, 40), campanha: txt(o.campanha, 80), clique: o.clique === 'gclid' || o.clique === 'fbclid' ? (o.clique as string) : null }
  // O canal é recalculado aqui a partir da origem crua (o navegador não escolhe o canal).
  const canal = canalDaOrigem({ fonte: det.fonte, meio: det.meio, clique: det.clique as OrigemBruta['clique'] })
  return { canal, detalhe: det }
}

/** "Instagram (campanha festa)" — dica do card e do painel do pedido. */
export function descreverOrigem(canal: string | null | undefined, detalhe?: { campanha?: string | null; meio?: string | null } | null): string | null {
  if (!canal || !(canal in ROTULO_CANAL)) return null
  const nome = ROTULO_CANAL[canal as CanalOrigem]
  const extra = detalhe?.campanha ? `campanha ${detalhe.campanha}` : detalhe?.meio === 'robo' ? 'robô de atendimento' : null
  return extra ? `${nome} (${extra})` : nome
}
