import { describe, expect, it } from 'vitest'
import { chaveFrete, criarCacheFrete, enderecoCompletoParaFrete, ESPERA_FRETE_MS } from './frete-vitrine'

const e = (p: Partial<{ cep: string; rua: string; numero: string; bairro: string; cidade: string }>) => ({ cep: '', rua: '', numero: '', bairro: '', cidade: '', ...p })

describe('frete na vitrine: só com o endereço completo (29/10)', () => {
  it('precisa de rua + número + bairro', () => {
    expect(enderecoCompletoParaFrete(e({ bairro: 'Centro' }))).toBe(false)
    expect(enderecoCompletoParaFrete(e({ rua: 'Rua A', bairro: 'Centro' }))).toBe(false)
    expect(enderecoCompletoParaFrete(e({ rua: 'Rua A', numero: '10', bairro: '  ' }))).toBe(false)
    expect(enderecoCompletoParaFrete(e({ rua: 'Rua A', numero: '10', bairro: 'Centro' }))).toBe(true)
  })
  it('espera ~800 ms depois de parar de digitar', () => { expect(ESPERA_FRETE_MS).toBe(800) })
  it('mesmo endereço (caixa, acento, espaço, CEP com traço) = mesma chave', () => {
    expect(chaveFrete(e({ cep: '29100-000', rua: 'Rua São João ', numero: '10', bairro: 'centro', cidade: 'Vila Velha' })))
      .toBe(chaveFrete(e({ cep: '29100000', rua: 'rua sao joao', numero: ' 10', bairro: 'Centro', cidade: 'vila velha' })))
    expect(chaveFrete(e({ rua: 'Rua A', numero: '10', bairro: 'Centro' }))).not.toBe(chaveFrete(e({ rua: 'Rua A', numero: '11', bairro: 'Centro' })))
  })
  it('cache: o mesmo endereço não consulta de novo; só resposta boa entra', () => {
    const c = criarCacheFrete<{ taxa: number }>()
    const end = e({ rua: 'Rua A', numero: '10', bairro: 'Centro' })
    expect(c.ler('loja', end)).toBeUndefined()
    c.guardar('loja', end, { taxa: 7 })
    expect(c.ler('loja', { ...end, rua: 'RUA A' })).toEqual({ taxa: 7 })
    expect(c.ler('outra-loja', end)).toBeUndefined()
  })
  it('digitando "Rua das Flores 123, Centro" letra por letra: antes ~1 consulta por pausa, agora 1', () => {
    // Antes: bastava o bairro preenchido e cada pausa de digitação na rua/número consultava o servidor.
    const passos: ReturnType<typeof e>[] = []
    for (const r of ['R', 'Ru', 'Rua', 'Rua d', 'Rua das', 'Rua das F', 'Rua das Flores']) passos.push(e({ bairro: 'Centro', rua: r }))
    for (const n of ['1', '12', '123']) passos.push(e({ bairro: 'Centro', rua: 'Rua das Flores', numero: n }))
    const antes = new Set(passos.filter((p) => p.bairro.trim() !== '').map(chaveFrete)).size
    const c = criarCacheFrete<number>()
    let agora = 0
    for (const p of passos) if (enderecoCompletoParaFrete(p) && p.numero === '123' && c.ler('l', p) === undefined) { agora++; c.guardar('l', p, 1) }
    // Volta para o mesmo endereço (ex.: abriu e fechou o checkout): cache, zero consulta.
    if (c.ler('l', passos[passos.length - 1]) === undefined) agora++
    expect(antes).toBe(10)
    expect(agora).toBe(1)
  })
})
