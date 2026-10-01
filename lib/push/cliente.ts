'use client'

/**
 * Lado do navegador das notificações push da vitrine (0127). Um service worker por loja
 * (/sw-loja.js com escopo /loja/<slug>) → uma assinatura por loja, mesmo no mesmo domínio.
 *
 * iPhone/iPad: só existe push com o site ADICIONADO À TELA DE INÍCIO (iOS 16.4+) e aberto por lá;
 * a permissão tem que ser pedida no toque do usuário — por isso `ativarPush` chama
 * `Notification.requestPermission()` ANTES de qualquer outra espera.
 */
import type { CategoriaPush } from './regras'

export const TODAS_CATEGORIAS: CategoriaPush[] = ['pedido', 'promocoes', 'novidades', 'fidelidade']
const DIAS_SEM_PERGUNTAR = 30

export type Plataforma = 'android' | 'ios' | 'desktop' | 'outro'

export function plataformaAtual(): Plataforma {
  if (typeof navigator === 'undefined') return 'outro'
  const ua = navigator.userAgent
  // iPad moderno se apresenta como Mac com toque.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop'
  return 'outro'
}

export function navegadorAtual(): string {
  if (typeof navigator === 'undefined') return ''
  const ua = navigator.userAgent
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet'
  if (/Firefox|FxiOS/.test(ua)) return 'Firefox'
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/CriOS|Chrome/.test(ua)) return 'Chrome'
  if (/Safari/.test(ua)) return 'Safari'
  return 'outro'
}

export function instaladoComoApp(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function suportaPush(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

/** iPhone fora do app instalado: em vez de pedir, ensinar a instalar. */
export function precisaInstalarNoIphone(): boolean {
  return plataformaAtual() === 'ios' && !instaladoComoApp()
}

export function permissaoAtual(): NotificationPermission | 'indisponivel' {
  return typeof Notification === 'undefined' ? 'indisponivel' : Notification.permission
}

// ── memória local por loja ──────────────────────────────────────────────────
interface Memoria { recusadoEm?: number; categorias?: CategoriaPush[]; endpoint?: string }
const chaveMem = (slug: string) => `menuzia_push_${slug}`
function ler(slug: string): Memoria {
  try { return JSON.parse(localStorage.getItem(chaveMem(slug)) ?? '{}') as Memoria } catch { return {} }
}
function gravar(slug: string, m: Memoria) {
  try { localStorage.setItem(chaveMem(slug), JSON.stringify({ ...ler(slug), ...m })) } catch { /* modo privado */ }
}

/** "Agora não": não perguntar de novo por 30 dias. */
export function registrarRecusa(slug: string) {
  gravar(slug, { recusadoEm: Date.now() })
}

export function recusouRecentemente(slug: string, agora = Date.now()): boolean {
  const r = ler(slug).recusadoEm
  return Boolean(r && agora - r < DIAS_SEM_PERGUNTAR * 24 * 3600_000)
}

export function categoriasSalvas(slug: string): CategoriaPush[] {
  return ler(slug).categorias ?? TODAS_CATEGORIAS
}

// ── servidor ────────────────────────────────────────────────────────────────
export async function configDaLoja(slug: string): Promise<{ ativo: boolean; chavePublica?: string }> {
  try {
    const r = await fetch(`/api/loja/${slug}/push/config`, { cache: 'no-store' })
    return r.ok ? await r.json() : { ativo: false }
  } catch {
    return { ativo: false }
  }
}

function chaveParaBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Registro do service worker DESTA loja, já ativo (subscribe exige worker ativo). */
export async function registroDaLoja(slug: string): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register('/sw-loja.js', { scope: `/loja/${slug}` })
  if (reg.active) return reg
  const w = reg.installing ?? reg.waiting
  if (w) {
    await new Promise<void>((ok) => {
      const ver = () => { if (w.state === 'activated') { w.removeEventListener('statechange', ver); ok() } }
      w.addEventListener('statechange', ver)
      ver()
      setTimeout(ok, 8000)
    })
  }
  return reg
}

export async function assinaturaAtual(slug: string): Promise<PushSubscription | null> {
  if (!suportaPush()) return null
  try {
    const reg = await navigator.serviceWorker.getRegistration(`/loja/${slug}`)
    // Registro de outra loja com prefixo parecido (/loja/pizza × /loja/pizza-do-rosa) não serve.
    if (!reg || new URL(reg.scope).pathname.replace(/\/$/, '') !== `/loja/${slug}`) return null
    return await reg.pushManager.getSubscription()
  } catch {
    return null
  }
}

export type ResultadoAtivar = { ok: true } | { ok: false; motivo: 'negado' | 'fechado' | 'sem_suporte' | 'instalar_iphone' | 'indisponivel' | 'erro' }

/**
 * Pede a permissão (no toque) e assina. `vinculo`: sessão do cliente ou o id do pedido recém-feito,
 * para o servidor ligar a assinatura ao telefone (status do pedido, recompra, fidelidade).
 */
export async function ativarPush(slug: string, vinculo: { telefone?: string; token?: string; pedidoId?: string }, categorias: CategoriaPush[] = TODAS_CATEGORIAS): Promise<ResultadoAtivar> {
  if (precisaInstalarNoIphone()) return { ok: false, motivo: 'instalar_iphone' }
  if (!suportaPush()) return { ok: false, motivo: 'sem_suporte' }
  // Primeiro a permissão, ainda dentro do toque (iOS recusa se houver espera antes).
  const permissao = await Notification.requestPermission()
  if (permissao === 'denied') return { ok: false, motivo: 'negado' }
  if (permissao !== 'granted') return { ok: false, motivo: 'fechado' }
  try {
    const cfg = await configDaLoja(slug)
    if (!cfg.ativo || !cfg.chavePublica) return { ok: false, motivo: 'indisponivel' }
    const reg = await registroDaLoja(slug)
    const sub = (await reg.pushManager.getSubscription())
      ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveParaBytes(cfg.chavePublica) as BufferSource }))
    const r = await fetch(`/api/loja/${slug}/push/assinar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscription: sub.toJSON(),
        categorias,
        plataforma: plataformaAtual(),
        navegador: navegadorAtual(),
        instalado: instaladoComoApp(),
        ...vinculo,
      }),
    })
    if (!r.ok) return { ok: false, motivo: 'erro' }
    gravar(slug, { categorias, endpoint: sub.endpoint, recusadoEm: undefined })
    return { ok: true }
  } catch {
    return { ok: false, motivo: 'erro' }
  }
}

export async function salvarCategorias(slug: string, categorias: CategoriaPush[]): Promise<boolean> {
  const sub = await assinaturaAtual(slug)
  if (!sub) return false
  const r = await fetch(`/api/loja/${slug}/push/assinar`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint, categorias }),
  }).catch(() => null)
  if (r?.ok) gravar(slug, { categorias })
  return Boolean(r?.ok)
}

export async function desativarPush(slug: string): Promise<void> {
  const sub = await assinaturaAtual(slug)
  if (!sub) return
  await fetch(`/api/loja/${slug}/push/assinar`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => null)
  await sub.unsubscribe().catch(() => false)
}

// ── origem (clique na notificação → pedido em até 48 h) ─────────────────────
const chaveOrigem = (slug: string) => `menuzia_push_origem_${slug}`

export function registrarCliqueDaUrl(slug: string): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const envio = url.searchParams.get('push')
  if (!envio) return
  try { localStorage.setItem(chaveOrigem(slug), JSON.stringify({ envio, em: Date.now() })) } catch { /* sem storage */ }
  void fetch(`/api/loja/${slug}/push/clique`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envio }), keepalive: true }).catch(() => null)
}

/** Id do envio cujo clique trouxe o cliente, se foi há menos de 48 h. */
export function origemPushRecente(slug: string, agora = Date.now()): string | null {
  try {
    const o = JSON.parse(localStorage.getItem(chaveOrigem(slug)) ?? 'null') as { envio: string; em: number } | null
    return o && agora - o.em < 48 * 3600_000 ? o.envio : null
  } catch {
    return null
  }
}

export function limparOrigemPush(slug: string) {
  try { localStorage.removeItem(chaveOrigem(slug)) } catch { /* sem storage */ }
}
