import { describe, expect, it } from 'vitest'
import { agregarGastoLojas, custoGoogleMicroUsd, PRECO_GOOGLE_USD_1000 } from './gasto-lojas'

const hoje = '2026-10-12'
const ia = (dia: string, escopo: string, custo: number, chamadas = 1) => ({ dia, escopo, modelo: 'claude-haiku-5-5', chamadas, tokens_entrada: 0, tokens_saida: 0, custo_micro_usd: custo })
const api = (dia: string, escopo: string, a: string, chamadas: number) => ({ dia, escopo, api: a, chamadas })

describe('gasto por loja no Super Admin', () => {
  it('preço de tabela do Google (US$ por 1000, antes da cota grátis)', () => {
    expect(PRECO_GOOGLE_USD_1000).toMatchObject({ geocoding: 5, directions: 5, maps_js: 7 })
    expect(custoGoogleMicroUsd({ geocoding: 1000, directions: 0, maps_js: 0 })).toBe(5_000_000)
    expect(custoGoogleMicroUsd({ geocoding: 1, directions: 1, maps_js: 1 })).toBe(5000 + 5000 + 7000)
  })

  it('hoje / 7 dias / mês por loja, separado por serviço; total do sistema; ordena pelo mês', () => {
    const r = agregarGastoLojas(
      [ia(hoje, 'A', 300), ia('2026-10-08', 'A', 200), ia('2026-10-01', 'A', 100000), ia('2026-09-30', 'A', 9999), ia(hoje, 'total', 300), ia(hoje, 'B', 50)],
      [api(hoje, 'B', 'geocoding', 10), api('2026-10-06', 'B', 'geocoding', 5), api(hoje, 'A', 'maps_js', 2), api(hoje, 'total', 'geocoding', 10), api(hoje, 'B', 'geocoding:bloqueada', 3)],
      hoje,
    )
    const A = r.lojas.find((l) => l.loja === 'A')!
    const B = r.lojas.find((l) => l.loja === 'B')!
    expect(A.hoje.iaMicroUsd).toBe(300)
    expect(A.semana.iaMicroUsd).toBe(500) // 12/10 e 08/10 (06–12)
    expect(A.mes.iaMicroUsd).toBe(100500) // 01–12/10; setembro fora
    expect(A.hoje.maps_js).toBe(2)
    expect(B.hoje.geocoding).toBe(10)
    expect(B.semana.geocoding).toBe(15)
    expect(B.mes.googleMicroUsd).toBe(custoGoogleMicroUsd({ geocoding: 15, directions: 0, maps_js: 0 }))
    expect(B.hoje.geocoding).not.toBe(13) // bloqueadas não contam como gasto
    expect(r.lojas[0].loja).toBe('A') // mais gasto no mês primeiro
    expect(r.total.mes.iaMicroUsd).toBe(100550)
    expect(r.total.mes.geocoding).toBe(15)
  })

  it('loja sem uso nenhum aparece zerada; datas por loja só existem desde 10/10', () => {
    const r = agregarGastoLojas([], [], hoje, ['C'])
    expect(r.lojas).toEqual([expect.objectContaining({ loja: 'C', mes: expect.objectContaining({ iaMicroUsd: 0, googleMicroUsd: 0 }) })])
    expect(r.porLojaDesde).toBe('2026-10-10')
  })
})
