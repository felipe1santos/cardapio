/**
 * Aviso em texto da vitrine (2026-10-01): cor do texto, cor do fundo e efeito "pulsar"
 * configuráveis por loja (0123). Nulo = o visual de sempre (cor do tema, sem efeito).
 */
export interface EstiloAviso { corTexto: string | null; corFundo: string | null; pulsar: boolean }

export const AVISO_PADRAO: EstiloAviso = { corTexto: null, corFundo: null, pulsar: false }

/** Cores prontas (da paleta do sistema e da vitrine). */
export const CORES_AVISO_TEXTO = ['#1F2937', '#FFFFFF', '#0369A1', '#16A34A', '#B91C1C', '#B45309', '#7C3AED'] as const
export const CORES_AVISO_FUNDO = ['#F3F4F6', '#FFFFFF', '#E0F2FE', '#DCFCE7', '#FEE2E2', '#FEF3C7', '#111827', '#0688D4', '#16A34A', '#EF4444'] as const

export function hexValido(v: string | null | undefined): v is string {
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v)
}

/** "#abc" / "abcdef" → "#ABCDEF"; inválido → null. */
export function normalizarHex(v: string): string | null {
  let s = v.trim().replace(/^#/, '')
  if (/^[0-9A-Fa-f]{3}$/.test(s)) s = s.split('').map((c) => c + c).join('')
  return /^[0-9A-Fa-f]{6}$/.test(s) ? `#${s.toUpperCase()}` : null
}

function luminancia(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const canal = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * canal((n >> 16) & 255) + 0.7152 * canal((n >> 8) & 255) + 0.0722 * canal(n & 255)
}

/** Contraste WCAG entre duas cores (1 a 21). */
export function contraste(a: string, b: string): number {
  const [l1, l2] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100
}

/** Texto em negrito de 13px: abaixo de 4,5:1 fica difícil de ler (WCAG AA). */
export const CONTRASTE_MINIMO = 4.5

export function contrasteBaixo(e: EstiloAviso): boolean {
  const texto = e.corTexto ?? '#1F2937'
  const fundo = e.corFundo ?? '#F3F4F6'
  return contraste(texto, fundo) < CONTRASTE_MINIMO
}
