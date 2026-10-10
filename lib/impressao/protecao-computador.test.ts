import { describe, expect, it } from 'vitest'
import { computadorAtualAtivo, ehOUnicoAtivo, type AgenteSinal } from './protecao-computador'

const AGORA = Date.parse('2026-10-09T21:00:00Z')
const a = (id: string, minAtras: number | null, revogado = false): AgenteSinal => ({ id, nome: id.toUpperCase(), vistoEm: minAtras === null ? null : new Date(AGORA - minAtras * 60_000).toISOString(), revogado })

describe('desconectar o único computador que imprime', () => {
  it('único ativo → pede confirmação', () => { expect(ehOUnicoAtivo([a('pc', 0.1)], 'pc', AGORA)).toBe(true) })
  it('há outro ativo → não pede', () => { expect(ehOUnicoAtivo([a('pc', 0.1), a('caixa', 1)], 'pc', AGORA)).toBe(false) })
  it('o outro está revogado ou parado há 30 min → continua sendo o único', () => {
    expect(ehOUnicoAtivo([a('pc', 0.1), a('velho', 1, true), a('parado', 30)], 'pc', AGORA)).toBe(true)
  })
  it('computador já parado (não imprime há 30 min) → não pede', () => { expect(ehOUnicoAtivo([a('pc', 30)], 'pc', AGORA)).toBe(false) })
})

describe('outro computador assumindo Cozinha/Caixa', () => {
  it('função num computador ativo e o novo dispositivo é de outro computador → pergunta com o nome do atual', () => {
    expect(computadorAtualAtivo(a('pc-principal', 0.2), 'desktop', AGORA)).toBe('PC-PRINCIPAL')
  })
  it('mesmo computador, atual revogado ou parado → não pergunta', () => {
    expect(computadorAtualAtivo(a('pc', 0.2), 'pc', AGORA)).toBeNull()
    expect(computadorAtualAtivo(a('pc', 0.2, true), 'desktop', AGORA)).toBeNull()
    expect(computadorAtualAtivo(a('pc', 45), 'desktop', AGORA)).toBeNull()
    expect(computadorAtualAtivo(null, 'desktop', AGORA)).toBeNull()
  })
})
