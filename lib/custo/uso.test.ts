import { describe, expect, it } from 'vitest'
import { agregarDias, corDoUso, diaSP, limiteDoPainel, type LinhaUso } from './uso'

describe('contador do Super Admin: barra', () => {
  it('verde até 50%, amarela até 80%, vermelha acima', () => {
    expect(corDoUso(0, 300)).toEqual({ pct: 0, cor: 'verde' })
    expect(corDoUso(150, 300)).toEqual({ pct: 50, cor: 'verde' })
    expect(corDoUso(151, 300).cor).toBe('amarela')
    expect(corDoUso(240, 300)).toEqual({ pct: 80, cor: 'amarela' })
    expect(corDoUso(241, 300).cor).toBe('vermelha')
    expect(corDoUso(900, 300)).toEqual({ pct: 100, cor: 'vermelha' }) // passou do limite: barra cheia
  })
  it('limite zero: qualquer chamada é vermelha', () => {
    expect(corDoUso(1, 0).cor).toBe('vermelha')
    expect(corDoUso(0, 0).cor).toBe('verde')
  })
  it('limites: Maps JS 150 por padrão; Geocoding/Directions da guarda', () => {
    expect(limiteDoPainel('maps_js', {})).toBe(150)
    expect(limiteDoPainel('maps_js', { LIMITE_MAPS_JS_DIA: '80' })).toBe(80)
    expect(limiteDoPainel('geocoding', {})).toBe(300)
  })
})

describe('contador do Super Admin: últimos 7 dias', () => {
  it('7 dias do mais antigo a hoje, só o escopo total, zero nos dias sem uso', () => {
    const l: LinhaUso[] = [
      { api: 'geocoding', escopo: 'total', dia: '2026-10-10', chamadas: 45 },
      { api: 'geocoding', escopo: 'loja-1', dia: '2026-10-10', chamadas: 45 }, // por loja não soma de novo
      { api: 'maps_js', escopo: 'total', dia: '2026-10-08', chamadas: 30 },
      { api: 'geocoding:bloqueada', escopo: 'total', dia: '2026-10-10', chamadas: 9 }, // não é API do gráfico
      { api: 'directions', escopo: 'total', dia: '2026-10-01', chamadas: 99 }, // fora da janela
    ]
    const d = agregarDias(l, '2026-10-10')
    expect(d.map((x) => x.dia)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'])
    expect(d[6]).toEqual({ dia: '2026-10-10', geocoding: 45, directions: 0, maps_js: 0 })
    expect(d[4].maps_js).toBe(30)
    expect(d.reduce((s, x) => s + x.directions, 0)).toBe(0)
  })
  it('dia de São Paulo (00:30 de Brasília ainda é o dia certo)', () => {
    expect(diaSP(new Date('2026-10-10T03:30:00Z'))).toBe('2026-10-10')
    expect(diaSP(new Date('2026-10-10T02:30:00Z'))).toBe('2026-10-09')
  })
})
