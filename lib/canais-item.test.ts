import { describe, it, expect } from 'vitest'
import { itemDisponivelNoCanal, resumoCanais, motivoIndisponivel, type CanalVenda, categoriaNoHorario } from './canais-item'
import { grupoEstaAtivoAgora } from './timezone'

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
    expect(motivoIndisponivel('horario', 'X-Tudo')).toContain('fora do horário')
    for (const m of ['inexistente', 'status', 'dia', 'horario', 'canal'] as const) {
      expect(motivoIndisponivel(m, 'X-Tudo')).toContain('X-Tudo')
    }
  })
})

describe('categoriaNoHorario — a mesma janela da vitrine vale no salão', () => {
  const almoco = { id: 'g1', horarioAtivoInicio: '11:40', horarioAtivoFim: '14:00' }
  const semJanela = { id: 'g2', horarioAtivoInicio: null, horarioAtivoFim: null }
  const dentro = () => true
  const fora = (g: { horarioAtivoInicio: string | null }) => g.horarioAtivoInicio === null

  it('item de categoria com janela some fora do horário', () => {
    expect(categoriaNoHorario({ grupoId: 'g1' }, [almoco, semJanela], fora)).toBe(false)
    expect(categoriaNoHorario({ grupoId: 'g1' }, [almoco, semJanela], dentro)).toBe(true)
  })

  it('categoria sem janela e item sem categoria não são afetados', () => {
    expect(categoriaNoHorario({ grupoId: 'g2' }, [almoco, semJanela], fora)).toBe(true)
    expect(categoriaNoHorario({ grupoId: null }, [almoco], fora)).toBe(true)
  })

  it('usa a regra real de horário (grupoEstaAtivoAgora) sem inventar outra', () => {
    expect(categoriaNoHorario({ grupoId: 'g2' }, [semJanela], grupoEstaAtivoAgora)).toBe(true)
  })
})
