/** Utilidades de tela do PDV v2 (formatação e chamadas às rotas). */

export function formatBRL(valor: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
}

export function horaCurta(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}

export function minutosDesde(iso: string | null | undefined, agora = Date.now()): number {
  if (!iso) return 0
  return Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000))
}

export function tempoCurto(iso: string | null | undefined, agora = Date.now()): string {
  const min = minutosDesde(iso, agora)
  if (min < 1) return 'agora'
  if (min < 60) return `${min}min`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`
}

export function novaChave(): string {
  return crypto.randomUUID()
}

export interface RespostaApi<T> {
  ok: boolean
  status: number
  dados: T | null
  erro: string | null
  codigo: string | null
  corpo: Record<string, unknown> | null
}

/** fetch JSON com erro de rede/servidor virando frase, nunca exceção solta na tela. */
export async function chamar<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<RespostaApi<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    })
    const corpo = (await res.json().catch(() => null)) as Record<string, unknown> | null
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        dados: null,
        erro: (corpo?.error as string) ?? 'Não foi possível concluir a operação.',
        codigo: (corpo?.codigo as string) ?? null,
        corpo,
      }
    }
    return { ok: true, status: res.status, dados: corpo as T, erro: null, codigo: null, corpo }
  } catch {
    return { ok: false, status: 0, dados: null, erro: 'Sem conexão com o servidor. Tente de novo.', codigo: 'rede', corpo: null }
  }
}

/** Máscara leve de telefone enquanto digita: (27) 99999-8888. */
export function mascararTelefone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d.length ? `(${d}` : ''
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/** Valor digitado ("64,90", "1.234,5") para número. */
export function lerValor(texto: string): number {
  const limpo = texto.replace(/\s/g, '').replace(/\./g, '').replace(',', '.')
  const n = Number(limpo)
  return Number.isFinite(n) ? n : NaN
}
