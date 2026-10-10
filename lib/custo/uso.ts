import type { SupabaseClient } from '@supabase/supabase-js'
import { limiteDiario } from './guarda'

/**
 * Contador das APIs pagas no Super Admin (10/10/2026, docs/REGRAS-DE-CUSTO.md) — lê api_uso_dia (0173).
 *   · geocoding / directions: contados pela guarda (chamarApiPaga) antes de chamar o Google;
 *   · maps_js: carregamento do Maps JavaScript no navegador (é o que o Google cobra), contado por
 *     /api/mapa/carregou — só conta, não chama nada pago;
 *   · '<api>:bloqueada': chamadas que a guarda NÃO deixou passar (limite ou disparo).
 */
export const APIS_PAINEL = ['geocoding', 'directions', 'maps_js'] as const
export type ApiPainel = (typeof APIS_PAINEL)[number]

export const ROTULO_API: Record<ApiPainel, string> = { geocoding: 'Geocoding', directions: 'Directions', maps_js: 'Mapas carregados' }

export function limiteDoPainel(api: ApiPainel, env: Record<string, string | undefined> = process.env): number {
  if (api === 'maps_js') {
    const v = Number(env.LIMITE_MAPS_JS_DIA)
    return Number.isInteger(v) && v >= 0 ? v : 150
  }
  return limiteDiario(api, env)
}

/** Dia de São Paulo "AAAA-MM-DD". */
export function diaSP(agora = new Date()): string {
  return agora.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
}

export type CorUso = 'verde' | 'amarela' | 'vermelha'
/** Barra: verde até 50%, amarela até 80%, vermelha acima. Pura. */
export function corDoUso(chamadas: number, limite: number): { pct: number; cor: CorUso } {
  const pct = limite > 0 ? Math.min(100, Math.round((chamadas / limite) * 1000) / 10) : chamadas > 0 ? 100 : 0
  return { pct, cor: pct <= 50 ? 'verde' : pct <= 80 ? 'amarela' : 'vermelha' }
}

export interface LinhaUso { api: string; escopo: string; dia: string; chamadas: number }
export type DiaUso = { dia: string } & Record<ApiPainel, number>

/** Últimos `n` dias (do mais antigo para hoje), total por API, com zero nos dias sem uso. Pura. */
export function agregarDias(linhas: LinhaUso[], hoje: string, n = 7): DiaUso[] {
  const base = Date.parse(`${hoje}T12:00:00Z`)
  const dias: DiaUso[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base - i * 86_400_000).toISOString().slice(0, 10)
    dias.push({ dia: d, geocoding: 0, directions: 0, maps_js: 0 })
  }
  const porDia = new Map(dias.map((d) => [d.dia, d]))
  for (const l of linhas) {
    if (l.escopo !== 'total' || !(APIS_PAINEL as readonly string[]).includes(l.api)) continue
    const d = porDia.get(String(l.dia).slice(0, 10))
    if (d) d[l.api as ApiPainel] += Number(l.chamadas) || 0
  }
  return dias
}

export interface UsoApis {
  dia: string
  limites: Record<ApiPainel, number>
  total: Record<ApiPainel, number>
  porLoja: Record<string, Record<ApiPainel, number>>
  bloqueadas: number
  disparos: number
  ultimos7: DiaUso[]
}

const zerado = (): Record<ApiPainel, number> => ({ geocoding: 0, directions: 0, maps_js: 0 })

export async function lerUsoApis(admin: SupabaseClient, agora = new Date()): Promise<UsoApis> {
  const hoje = diaSP(agora)
  const desde = new Date(Date.parse(`${hoje}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10)
  const inicioDia = new Date(`${hoje}T00:00:00-03:00`).toISOString()
  const [{ data: linhas }, { data: alertas }] = await Promise.all([
    admin.from('api_uso_dia').select('api, escopo, dia, chamadas').gte('dia', desde).limit(5000),
    admin.from('api_alertas').select('nivel').gte('criado_em', inicioDia).limit(5000),
  ])
  const ls = ((linhas ?? []) as LinhaUso[])
  const total = zerado()
  const porLoja: Record<string, Record<ApiPainel, number>> = {}
  let bloqueadas = 0
  for (const l of ls) {
    if (String(l.dia).slice(0, 10) !== hoje) continue
    if (l.api.endsWith(':bloqueada')) { if (l.escopo === 'total') bloqueadas += Number(l.chamadas) || 0; continue }
    if (!(APIS_PAINEL as readonly string[]).includes(l.api)) continue
    const api = l.api as ApiPainel
    if (l.escopo === 'total') total[api] += Number(l.chamadas) || 0
    else (porLoja[l.escopo] ??= zerado())[api] += Number(l.chamadas) || 0
  }
  return {
    dia: hoje,
    limites: { geocoding: limiteDoPainel('geocoding'), directions: limiteDoPainel('directions'), maps_js: limiteDoPainel('maps_js') },
    total, porLoja, bloqueadas,
    disparos: ((alertas ?? []) as { nivel: string }[]).filter((a) => a.nivel === 'disparo').length,
    ultimos7: agregarDias(ls, hoje),
  }
}

/**
 * Soma 1 em api_uso_dia SEM trava (contagem de exibição: mapas carregados e chamadas bloqueadas). Ler e gravar não é
 * atômico — num empate raro perde 1 na contagem, o que não importa para um contador; a trava de verdade é api_uso_contar.
 */
export async function contarSemTrava(admin: SupabaseClient, api: string, loja: string | null): Promise<void> {
  const dia = diaSP()
  for (const escopo of loja ? ['total', loja] : ['total']) {
    try {
      const { data } = await admin.from('api_uso_dia').select('chamadas').eq('api', api).eq('escopo', escopo).eq('dia', dia).maybeSingle()
      if (data) await admin.from('api_uso_dia').update({ chamadas: Number(data.chamadas) + 1, atualizado_em: new Date().toISOString() }).eq('api', api).eq('escopo', escopo).eq('dia', dia)
      else await admin.from('api_uso_dia').insert({ api, escopo, dia, chamadas: 1 })
    } catch { /* contador de exibição: nunca derruba nada */ }
  }
}
