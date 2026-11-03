import { describe, expect, it } from 'vitest'
import { agregarCustoMensal, CUSTO_FIXO_PADRAO, faixaGoogle, lerCustoFixo, MARGEM_GRATIS_GOOGLE, situacaoGoogleDoMes, type CustoFixo } from './custo-mensal'

/**
 * Custo do sistema por mês (03/11/2026, pedido do dono): o que a Menuzia paga para funcionar — Supabase e VPS (fixos,
 * configurados no Super Admin), Google (só o que passa da cota grátis de 10 mil/serviço) e IA (custo real). Pura.
 */
const fixo: CustoFixo = { supabaseUsd: 25, vpsBrl: 60, outrosBrl: 10 }
const ia = (dia: string, usd: number, chamadas = 1) => ({ dia, custo_micro_usd: Math.round(usd * 1e6), chamadas })
const api = (dia: string, a: string, chamadas: number) => ({ dia, api: a, chamadas })

describe('agregarCustoMensal', () => {
  it('um mês por linha, do mais recente para o mais antigo; o mês atual é parcial', () => {
    const r = agregarCustoMensal([ia('2026-10-05', 0.10), ia('2026-11-02', 0.004)], [api('2026-10-12', 'maps_js', 249)], fixo, 5.5, '2026-11-03')
    expect(r.map((m) => [m.mes, m.parcial])).toEqual([['2026-11', true], ['2026-10', false]])
  })
  it('fixos em reais (Supabase convertido pela cotação) + IA real + Google só acima da cota grátis', () => {
    const [nov, out] = agregarCustoMensal([ia('2026-10-05', 0.10), ia('2026-11-02', 0.004)], [api('2026-10-12', 'maps_js', 249), api('2026-10-13', 'geocoding', 12_000)], fixo, 5.5, '2026-11-03')
    expect(out.fixoBrl).toBeCloseTo(25 * 5.5 + 60 + 10, 6)
    expect(out.iaBrl).toBeCloseTo(0.10 * 5.5, 6)
    // geocoding: 2.000 acima dos 10 mil grátis × US$ 5/mil = US$ 10; maps_js 249 dentro da cota = 0.
    expect(out.googleBrl).toBeCloseTo(10 * 5.5, 6)
    expect(out.googleTabelaBrl).toBeCloseTo(((12_000 * 5 + 249 * 7) / 1000) * 5.5, 6)
    expect(out.totalBrl).toBeCloseTo(out.fixoBrl + out.iaBrl + out.googleBrl, 6)
    expect(nov.googleBrl).toBe(0)
  })
  it('sem uso nenhum ainda assim lista o mês atual com os fixos', () => {
    const r = agregarCustoMensal([], [], fixo, 5.5, '2026-11-03')
    expect(r).toHaveLength(1)
    expect(r[0].totalBrl).toBeCloseTo(25 * 5.5 + 70, 6)
  })
})

describe('lerCustoFixo (plataforma_config › custo_fixo)', () => {
  it('lê o JSON salvo; ausente ou inválido → padrão (Supabase Pro US$ 25, VPS e outros em branco)', () => {
    expect(lerCustoFixo({ supabaseUsd: 25, vpsBrl: '59,90', outrosBrl: null })).toEqual({ supabaseUsd: 25, vpsBrl: 59.9, outrosBrl: 0 })
    expect(lerCustoFixo(null)).toEqual(CUSTO_FIXO_PADRAO)
    expect(lerCustoFixo('lixo')).toEqual(CUSTO_FIXO_PADRAO)
    expect(CUSTO_FIXO_PADRAO).toEqual({ supabaseUsd: 25, vpsBrl: 0, outrosBrl: 0 })
  })
})

/**
 * 03/11/2026 (pedido do dono): selo verde "grátis este mês" no Google só com MARGEM — a contagem do painel e a do Google
 * podem diferir em algumas unidades, então "grátis" é abaixo de 70% da cota (7.000 de 10.000 por serviço); entre 70% e
 * 100% é "perto da cota"; acima, cobrado.
 */
describe('faixa da cota grátis do Google', () => {
  it('faixaGoogle: grátis < 70%, perto entre 70% e 100%, cobrado acima', () => {
    expect(faixaGoogle(0)).toBe('gratis')
    expect(faixaGoogle(6_999)).toBe('gratis')
    expect(faixaGoogle(7_000)).toBe('perto')
    expect(faixaGoogle(10_000)).toBe('perto')
    expect(faixaGoogle(10_001)).toBe('cobrado')
    expect(MARGEM_GRATIS_GOOGLE).toBe(0.7)
  })
  it('situacaoGoogleDoMes: a pior faixa entre os três serviços, com o serviço que pesa', () => {
    expect(situacaoGoogleDoMes({ geocoding: 12, directions: 0, maps_js: 249 })).toEqual({ faixa: 'gratis', pior: null })
    expect(situacaoGoogleDoMes({ geocoding: 8_000, directions: 0, maps_js: 249 })).toEqual({ faixa: 'perto', pior: { api: 'geocoding', chamadas: 8_000 } })
    expect(situacaoGoogleDoMes({ geocoding: 8_000, directions: 11_000, maps_js: 249 })).toEqual({ faixa: 'cobrado', pior: { api: 'directions', chamadas: 11_000 } })
  })
})
