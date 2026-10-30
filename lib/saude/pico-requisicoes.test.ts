import { describe, expect, it } from 'vitest'
import { picoMedioDiario } from './pico-requisicoes'

// 12:00 UTC = 09:00 em São Paulo; 23:00 UTC = 20:00.
const hora = (dia: string, utc: string, req: number | null) => ({ em: `${dia}T${utc}:00Z`, req })
const tres = (dia: string, hh: string, req: number) => [hora(dia, `${hh}:05`, req), hora(dia, `${hh}:25`, req), hora(dia, `${hh}:45`, req)]
const agora = new Date('2026-10-30T12:00:00Z')

describe('picoMedioDiario', () => {
  it('média da hora mais movimentada de cada dia', () => {
    const r = picoMedioDiario([...tres('2026-10-28', '12', 100), ...tres('2026-10-28', '23', 400), ...tres('2026-10-29', '23', 600)], agora)
    expect(r).toEqual({ media: 500, dias: 2 })
  })

  it('ignora hoje, que ainda não terminou', () => {
    const r = picoMedioDiario([...tres('2026-10-29', '23', 600), ...tres('2026-10-30', '11', 9000)], agora)
    expect(r).toEqual({ media: 600, dias: 1 })
  })

  it('ignora dias fora da janela de 7 dias', () => {
    const r = picoMedioDiario([...tres('2026-10-22', '23', 9000), ...tres('2026-10-23', '23', 200)], agora)
    expect(r).toEqual({ media: 200, dias: 1 })
  })

  it('hora com menos de 3 leituras não vira pico (reinício ou salto isolado)', () => {
    const r = picoMedioDiario([hora('2026-10-29', '12:05', 90000), ...tres('2026-10-29', '23', 500)], agora)
    expect(r).toEqual({ media: 500, dias: 1 })
  })

  it('agrupa pelo dia de São Paulo, não pelo UTC', () => {
    // 01:00 UTC do dia 30 ainda é 22:00 do dia 29 em São Paulo.
    const r = picoMedioDiario([...tres('2026-10-29', '23', 300), ...tres('2026-10-30', '01', 700)], agora)
    expect(r).toEqual({ media: 700, dias: 1 })
  })

  it('leitura vazia não conta e sem dados devolve null', () => {
    expect(picoMedioDiario([hora('2026-10-29', '23:05', null)], agora)).toBeNull()
    expect(picoMedioDiario([], agora)).toBeNull()
  })
})
