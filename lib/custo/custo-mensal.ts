import type { SupabaseClient } from '@supabase/supabase-js'
import { COTA_GRATIS_GOOGLE_MES, PRECO_GOOGLE_USD_1000 } from './gasto-lojas'
import { diaSP } from './uso'
import { lerTodas } from '@/lib/queries/ler-todas'

/**
 * Custo do sistema por mês (03/11/2026, pedido do dono): quanto a Menuzia paga para funcionar.
 *  · Fixos (Super Admin › Gastos de API › "Custos fixos"): Supabase Pro em US$ (padrão 25), VPS e outros em R$.
 *  · Google: só o que passa da cota grátis de 10 mil chamadas por serviço no mês (preço de tabela); a conta "de tabela"
 *    (antes da cota) fica à parte, para conferir com o faturamento do Google.
 *  · IA (Claude/áudio): custo real registrado em ia_uso_dia.
 * O mês atual é parcial. Nenhuma chamada paga: só leitura das tabelas de uso.
 */
export interface CustoFixo { supabaseUsd: number; vpsBrl: number; outrosBrl: number }
export const CUSTO_FIXO_PADRAO: CustoFixo = { supabaseUsd: 25, vpsBrl: 0, outrosBrl: 0 }
export const CHAVE_CUSTO_FIXO = 'custo_fixo'

export interface CustoMes {
  mes: string
  parcial: boolean
  fixoBrl: number
  supabaseBrl: number
  vpsBrl: number
  outrosBrl: number
  iaBrl: number
  iaChamadas: number
  googleBrl: number
  googleTabelaBrl: number
  googleChamadas: Record<'geocoding' | 'directions' | 'maps_js', number>
  totalBrl: number
}

const APIS = ['geocoding', 'directions', 'maps_js'] as const
type ApiGoogle = (typeof APIS)[number]

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/** Lê o JSON de plataforma_config › custo_fixo. Inválido ou ausente → padrão. Pura. */
export function lerCustoFixo(valor: unknown): CustoFixo {
  if (!valor || typeof valor !== 'object') return { ...CUSTO_FIXO_PADRAO }
  const v = valor as Record<string, unknown>
  return { supabaseUsd: num(v.supabaseUsd), vpsBrl: num(v.vpsBrl), outrosBrl: num(v.outrosBrl) }
}

/** Um mês por linha, do mais recente para o mais antigo; sempre inclui o mês de `hoje`. Pura. */
export function agregarCustoMensal(
  ia: { dia: string; custo_micro_usd: number; chamadas: number }[],
  api: { dia: string; api: string; chamadas: number }[],
  fixo: CustoFixo, cotacao: number, hoje: string,
): CustoMes[] {
  const mesAtual = hoje.slice(0, 7)
  const meses = new Map<string, CustoMes>()
  const de = (mes: string): CustoMes => {
    let m = meses.get(mes)
    if (!m) {
      const supabaseBrl = fixo.supabaseUsd * cotacao
      m = { mes, parcial: mes === mesAtual, fixoBrl: supabaseBrl + fixo.vpsBrl + fixo.outrosBrl, supabaseBrl, vpsBrl: fixo.vpsBrl, outrosBrl: fixo.outrosBrl,
        iaBrl: 0, iaChamadas: 0, googleBrl: 0, googleTabelaBrl: 0, googleChamadas: { geocoding: 0, directions: 0, maps_js: 0 }, totalBrl: 0 }
      meses.set(mes, m)
    }
    return m
  }
  de(mesAtual)
  for (const l of ia) {
    const m = de(String(l.dia).slice(0, 7))
    m.iaBrl += ((Number(l.custo_micro_usd) || 0) / 1e6) * cotacao
    m.iaChamadas += Number(l.chamadas) || 0
  }
  for (const l of api) {
    if (!(APIS as readonly string[]).includes(l.api)) continue
    de(String(l.dia).slice(0, 7)).googleChamadas[l.api as ApiGoogle] += Number(l.chamadas) || 0
  }
  for (const m of meses.values()) {
    for (const a of APIS) {
      const n = m.googleChamadas[a]
      m.googleTabelaBrl += (n * PRECO_GOOGLE_USD_1000[a] / 1000) * cotacao
      m.googleBrl += (Math.max(0, n - COTA_GRATIS_GOOGLE_MES) * PRECO_GOOGLE_USD_1000[a] / 1000) * cotacao
    }
    m.totalBrl = m.fixoBrl + m.iaBrl + m.googleBrl
  }
  return [...meses.values()].sort((a, b) => (a.mes < b.mes ? 1 : -1))
}

/**
 * Faixa da cota grátis do Google (03/11, pedido do dono): "grátis" só com MARGEM — a contagem do painel e a do Google
 * podem diferir em algumas unidades. Abaixo de 70% da cota = grátis (selo verde); 70–100% = perto; acima = cobrado. Pura.
 */
export type FaixaGoogle = 'gratis' | 'perto' | 'cobrado'
export const MARGEM_GRATIS_GOOGLE = 0.7
export function faixaGoogle(chamadas: number, cota = COTA_GRATIS_GOOGLE_MES): FaixaGoogle {
  if (chamadas > cota) return 'cobrado'
  if (chamadas >= cota * MARGEM_GRATIS_GOOGLE) return 'perto'
  return 'gratis'
}

const PESO: Record<FaixaGoogle, number> = { gratis: 0, perto: 1, cobrado: 2 }
/** A pior faixa entre os três serviços do mês e qual serviço pesa (null quando tudo está grátis). Pura. */
export function situacaoGoogleDoMes(chamadas: Record<ApiGoogle, number>): { faixa: FaixaGoogle; pior: { api: ApiGoogle; chamadas: number } | null } {
  let faixa: FaixaGoogle = 'gratis'
  let pior: { api: ApiGoogle; chamadas: number } | null = null
  for (const api of APIS) {
    const f = faixaGoogle(chamadas[api])
    if (PESO[f] > PESO[faixa] || (f !== 'gratis' && PESO[f] === PESO[faixa] && pior && chamadas[api] > pior.chamadas)) { faixa = f; pior = { api, chamadas: chamadas[api] } }
    else if (f !== 'gratis' && !pior) pior = { api, chamadas: chamadas[api] }
  }
  return { faixa, pior: faixa === 'gratis' ? null : pior }
}

export async function lerCustoFixoConfig(admin: SupabaseClient): Promise<CustoFixo> {
  const { data } = await admin.from('plataforma_config').select('valor').eq('chave', CHAVE_CUSTO_FIXO).maybeSingle()
  return lerCustoFixo((data as { valor?: unknown } | null)?.valor)
}

/** Todos os meses com uso registrado (escopo total), mais o atual. De 1.000 em 1.000 (corte do PostgREST). */
export async function lerCustoMensal(admin: SupabaseClient, cotacao: number, agora = new Date()): Promise<{ meses: CustoMes[]; fixo: CustoFixo }> {
  const [ia, api, fixo] = await Promise.all([
    lerTodas<{ dia: string; custo_micro_usd: number; chamadas: number }>((de, ate) => admin.from('ia_uso_dia').select('dia, custo_micro_usd, chamadas').eq('escopo', 'total').order('dia').order('modelo').range(de, ate)),
    lerTodas<{ dia: string; api: string; chamadas: number }>((de, ate) => admin.from('api_uso_dia').select('dia, api, chamadas').eq('escopo', 'total').in('api', [...APIS]).order('api').order('dia').range(de, ate)),
    lerCustoFixoConfig(admin),
  ])
  return { meses: agregarCustoMensal(ia, api, fixo, cotacao, diaSP(agora)), fixo }
}
