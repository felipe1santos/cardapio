import type { SupabaseClient } from '@supabase/supabase-js'
import { diaSP } from './uso'

/**
 * "Gasto por loja" do Super Admin (12/10/2026): hoje, últimos 7 dias e mês atual de cada loja, por serviço — Agente de IA
 * (Claude, ia_uso_dia/0174, custo REAL em micro-dólares) e Google Maps (api_uso_dia/0173: Geocoding, Directions e mapas
 * carregados, contados por loja desde 10/10). Só leitura; nenhuma chamada paga.
 *
 * Google: preço de TABELA (US$ por 1000, Essentials) antes da cota grátis de 10 mil por API por mês — enquanto o mês do
 * sistema ficar abaixo da cota, o Google cobra R$ 0 (ver docs/REGRAS-DE-CUSTO.md).
 */
export const PRECO_GOOGLE_USD_1000 = { geocoding: 5, directions: 5, maps_js: 7 } as const
export const COTA_GRATIS_GOOGLE_MES = 10_000
export const POR_LOJA_DESDE = '2026-10-10'
const APIS = ['geocoding', 'directions', 'maps_js'] as const
type ApiGoogle = (typeof APIS)[number]

export interface Fatia { iaMicroUsd: number; iaChamadas: number; geocoding: number; directions: number; maps_js: number; googleMicroUsd: number }
export interface GastoLoja { loja: string; hoje: Fatia; semana: Fatia; mes: Fatia }
export interface GastoLojas { dia: string; porLojaDesde: string; lojas: GastoLoja[]; total: Omit<GastoLoja, 'loja'> }

export interface LinhaIaUso { dia: string; escopo: string; chamadas: number; custo_micro_usd: number }
export interface LinhaApiUso { dia: string; escopo: string; api: string; chamadas: number }

export function custoGoogleMicroUsd(c: Record<ApiGoogle, number>): number {
  return APIS.reduce((s, a) => s + Math.round((Number(c[a]) || 0) * PRECO_GOOGLE_USD_1000[a] * 1000), 0)
}

const vazia = (): Fatia => ({ iaMicroUsd: 0, iaChamadas: 0, geocoding: 0, directions: 0, maps_js: 0, googleMicroUsd: 0 })

/** Agrega as linhas do mês (e dos 7 dias) por loja e no total. Pura. `lojas` garante linha zerada para quem não gastou. */
export function agregarGastoLojas(ia: LinhaIaUso[], api: LinhaApiUso[], hoje: string, lojas: string[] = []): GastoLojas {
  const mesIni = `${hoje.slice(0, 8)}01`
  const semanaIni = new Date(Date.parse(`${hoje}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10)
  const por = new Map<string, GastoLoja>()
  const da = (loja: string) => {
    let g = por.get(loja)
    if (!g) { g = { loja, hoje: vazia(), semana: vazia(), mes: vazia() }; por.set(loja, g) }
    return g
  }
  for (const l of lojas) da(l)
  const total = { hoje: vazia(), semana: vazia(), mes: vazia() }
  const fatias = (dia: string, g: Omit<GastoLoja, 'loja'>) => [dia === hoje && g.hoje, dia >= semanaIni && dia <= hoje && g.semana, dia >= mesIni && dia <= hoje && g.mes].filter(Boolean) as Fatia[]
  for (const x of ia) {
    const dia = String(x.dia).slice(0, 10)
    // O total do sistema é a soma das lojas (a linha 'total' da IA também inclui chamadas sem loja; aqui só lojas).
    if (x.escopo === 'total') continue
    for (const alvo of [da(x.escopo), total]) for (const f of fatias(dia, alvo)) { f.iaMicroUsd += Number(x.custo_micro_usd) || 0; f.iaChamadas += Number(x.chamadas) || 0 }
  }
  for (const x of api) {
    if (x.escopo === 'total' || !(APIS as readonly string[]).includes(x.api)) continue
    const dia = String(x.dia).slice(0, 10)
    for (const alvo of [da(x.escopo), total]) for (const f of fatias(dia, alvo)) f[x.api as ApiGoogle] += Number(x.chamadas) || 0
  }
  for (const g of [...por.values(), total]) for (const f of [g.hoje, g.semana, g.mes]) f.googleMicroUsd = custoGoogleMicroUsd(f)
  const ordenadas = [...por.values()].sort((a, b) => b.mes.iaMicroUsd + b.mes.googleMicroUsd - (a.mes.iaMicroUsd + a.mes.googleMicroUsd))
  return { dia: hoje, porLojaDesde: POR_LOJA_DESDE, lojas: ordenadas, total }
}

/** Lê o mês (ou os 7 dias, se começarem antes do mês) e agrega. */
export async function lerGastoLojas(admin: SupabaseClient, lojas: string[], agora = new Date()): Promise<GastoLojas> {
  const hoje = diaSP(agora)
  const mesIni = `${hoje.slice(0, 8)}01`
  const semanaIni = new Date(Date.parse(`${hoje}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10)
  const desde = semanaIni < mesIni ? semanaIni : mesIni
  const [{ data: ia }, { data: api }] = await Promise.all([
    admin.from('ia_uso_dia').select('dia, escopo, chamadas, custo_micro_usd').gte('dia', desde).limit(20000),
    admin.from('api_uso_dia').select('dia, escopo, api, chamadas').in('api', [...APIS]).gte('dia', desde).limit(20000),
  ])
  return agregarGastoLojas((ia ?? []) as LinhaIaUso[], (api ?? []) as LinhaApiUso[], hoje, lojas)
}

/** Cotação do dólar para mostrar em reais: a do Super Admin (plataforma_config, 0187) ou COTACAO_DOLAR, padrão 5,50. */
export async function lerCotacao(admin: SupabaseClient, env: Record<string, string | undefined> = process.env): Promise<number> {
  const { data } = await admin.from('plataforma_config').select('valor').eq('chave', 'cotacao_dolar').maybeSingle()
  const v = Number((data as { valor?: unknown } | null)?.valor)
  if (Number.isFinite(v) && v > 0) return v
  const e = Number(env.COTACAO_DOLAR)
  return Number.isFinite(e) && e > 0 ? e : 5.5
}
