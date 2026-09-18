import { describe, it, expect } from 'vitest'
import { itemDisponivelNoCanal, resumoCanais, motivoIndisponivel, type CanalVenda } from './canais-item'

const CANAIS: CanalVenda[] = ['delivery', 'mesa', 'balcao']

describe('disponibilidade por canal', () => {
  it('item marcado nos dois canais vende em todos os canais', () => {
    const item = { disponivelDelivery: true, disponivelSalao: true }
    for (const c of CANAIS) expect(itemDisponivelNoCanal(item, c)).toBe(true)
  })

  it('só delivery: sai do salão e do balcão', () => {
    const item = { disponivelDelivery: true, disponivelSalao: false }
    expect(itemDisponivelNoCanal(item, 'delivery')).toBe(true)
    expect(itemDisponivelNoCanal(item, 'mesa')).toBe(false)
    expect(itemDisponivelNoCanal(item, 'balcao')).toBe(false)
  })

  it('só salão: sai do delivery, mas continua no balcão (presencial é presencial)', () => {
    const item = { disponivelDelivery: false, disponivelSalao: true }
    expect(itemDisponivelNoCanal(item, 'delivery')).toBe(false)
    expect(itemDisponivelNoCanal(item, 'mesa')).toBe(true)
    expect(itemDisponivelNoCanal(item, 'balcao')).toBe(true)
  })

  it('resumoCanais descreve as quatro combinações', () => {
    expect(resumoCanais({ disponivelDelivery: true, disponivelSalao: true })).toBe('Delivery e salão')
    expect(resumoCanais({ disponivelDelivery: true, disponivelSalao: false })).toBe('Só delivery')
    expect(resumoCanais({ disponivelDelivery: false, disponivelSalao: true })).toBe('Só salão')
    expect(resumoCanais({ disponivelDelivery: false, disponivelSalao: false })).toBe('Fora dos dois canais')
  })

  it('motivoIndisponivel nomeia o item e diz o porquê', () => {
    expect(motivoIndisponivel('inexistente', 'X-Tudo')).toContain('não está mais no cardápio')
    expect(motivoIndisponivel('status', 'X-Tudo')).toContain('pausado ou esgotado')
    expect(motivoIndisponivel('dia', 'X-Tudo')).toContain('não é servido hoje')
    expect(motivoIndisponivel('canal', 'X-Tudo')).toContain('não é vendido no salão')
    for (const m of ['inexistente', 'status', 'dia', 'canal'] as const) {
      expect(motivoIndisponivel(m, 'X-Tudo')).toContain('X-Tudo')
    }
  })
})
