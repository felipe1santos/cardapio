import { describe, expect, it } from 'vitest'
import { decidirFrete, normalizarBairro } from './frete'

const bairros = [
  { bairro: 'Jardim Colorado', taxa: 5 },
  { bairro: 'Jardim Marilandia', taxa: 7 },
  { bairro: 'São Geraldo', taxa: 6 },
]
const raios = [
  { ateKm: 3, taxa: 4 },
  { ateKm: 6, taxa: 8 },
]

describe('decidirFrete', () => {
  it('bairro cadastrado resolve com a taxa do bairro (case-insensitive, com espaços)', () => {
    const r = decidirFrete({ bairroCliente: '  jardim colorado ', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r).toEqual({ entregavel: true, taxa: 5, fonte: 'bairro', distanciaKm: null })
  })

  it('lista fechada (só bairros): bairro fora da lista bloqueia — não cai na taxa padrão', () => {
    const r = decidirFrete({ bairroCliente: 'Centro', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(false)
    expect(r.taxa).toBe(0)
    expect(r.fonte).toBe('bairro')
    expect(r.motivo).toBeTruthy()
  })

  it('lista fechada (só bairros): bairro vazio bloqueia', () => {
    const r = decidirFrete({ bairroCliente: '', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(false)
  })

  it('bairros + raio: sem match de bairro, dentro da faixa → taxa da faixa', () => {
    const r = decidirFrete({ bairroCliente: 'Centro', bairros, raios, taxaPadrao: 10, distanciaKm: 4.26 })
    expect(r).toEqual({ entregavel: true, taxa: 8, fonte: 'raio', distanciaKm: 4.3 })
  })

  it('bairros + raio: match de bairro tem prioridade sobre a distância', () => {
    const r = decidirFrete({ bairroCliente: 'Jardim Marilandia', bairros, raios, taxaPadrao: 10, distanciaKm: 99 })
    expect(r).toEqual({ entregavel: true, taxa: 7, fonte: 'bairro', distanciaKm: null })
  })

  it('raio: fora de todas as faixas bloqueia com motivo de distância', () => {
    const r = decidirFrete({ bairroCliente: '', bairros: [], raios, taxaPadrao: 10, distanciaKm: 9.14 })
    expect(r.entregavel).toBe(false)
    expect(r.fonte).toBe('raio')
    expect(r.distanciaKm).toBe(9.1)
    expect(r.motivo).toContain('9.1')
  })

  it('raio configurado mas geocode falhou (distanciaKm null) bloqueia', () => {
    const r = decidirFrete({ bairroCliente: 'Centro', bairros: [], raios, taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(false)
    expect(r.fonte).toBe('raio')
    expect(r.motivo).toBeTruthy()
  })

  it('nada cadastrado: taxa padrão, aceita qualquer endereço', () => {
    const r = decidirFrete({ bairroCliente: 'Qualquer', bairros: [], raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r).toEqual({ entregavel: true, taxa: 10, fonte: 'padrao', distanciaKm: null })
  })

  it('bairro digitado sem acento resolve bairro cadastrado com acento', () => {
    const r = decidirFrete({ bairroCliente: 'sao geraldo', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r).toEqual({ entregavel: true, taxa: 6, fonte: 'bairro', distanciaKm: null })
  })

  it('bairro digitado com acento resolve bairro cadastrado sem acento', () => {
    const r = decidirFrete({ bairroCliente: 'Jardim Marilândia', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r).toEqual({ entregavel: true, taxa: 7, fonte: 'bairro', distanciaKm: null })
  })

  it('espaços duplicados no meio não impedem o match', () => {
    const r = decidirFrete({ bairroCliente: 'Jardim  Colorado', bairros, raios: [], taxaPadrao: 10, distanciaKm: null })
    expect(r.entregavel).toBe(true)
    expect(r.taxa).toBe(5)
  })
})

describe('normalizarBairro', () => {
  it('remove acentos, caixa e espaços extras', () => {
    expect(normalizarBairro('  São  José ')).toBe('sao jose')
    expect(normalizarBairro('JARDIM MARILÂNDIA')).toBe('jardim marilandia')
    expect(normalizarBairro('')).toBe('')
  })
})
