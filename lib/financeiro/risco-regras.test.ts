import { describe, expect, it } from 'vitest'
import { METRICAS, avaliarRisco, metricaDaAcao, type LinhaRisco } from './risco-regras'

const zero = () => Object.fromEntries(METRICAS.map((k) => [k, 0])) as LinhaRisco['valores']
const p = (nome: string, v: Partial<LinhaRisco['valores']>): LinhaRisco => ({ usuarioId: nome, nome, papel: 'atendente', valores: { ...zero(), ...v }, valorCentavos: zero() })

describe('risco por funcionário', () => {
  it('classifica as ações da auditoria', () => {
    expect(metricaDaAcao('conta.cancelou_item')).toBe('cancelamentos')
    expect(metricaDaAcao('pedido.cancelou')).toBe('cancelamentos')
    expect(metricaDaAcao('conta.desconto')).toBe('descontos')
    expect(metricaDaAcao('conta.estorno')).toBe('estornos')
    expect(metricaDaAcao('conta.reimprimiu')).toBe('reimpressoes')
    expect(metricaDaAcao('fin.reimprimiu_relatorio')).toBe('reimpressoes')
    expect(metricaDaAcao('caixa.perda')).toBe('ajustes')
    expect(metricaDaAcao('conta.pagamento')).toBeNull()
  })
  it('destaca quem passa de 2× a mediana com pelo menos 3', () => {
    const r = avaliarRisco([p('Ana', { cancelamentos: 2 }), p('Bia', { cancelamentos: 1 }), p('Caio', { cancelamentos: 9, descontos: 1 }), p('Duda', { cancelamentos: 2 })])
    expect(r.linhas[0].nome).toBe('Caio')
    expect(r.linhas[0].foraDoPadrao).toEqual(['cancelamentos'])
    expect(r.linhas.filter((l) => l.foraDoPadrao.length).map((l) => l.nome)).toEqual(['Caio'])
  })
  it('poucas ocorrências não acusam ninguém', () => {
    const r = avaliarRisco([p('Ana', { estornos: 2 }), p('Bia', {})])
    expect(r.linhas.every((l) => l.foraDoPadrao.length === 0)).toBe(true)
  })
  it('todos parecidos: ninguém fora do padrão', () => {
    const r = avaliarRisco([p('Ana', { descontos: 5 }), p('Bia', { descontos: 6 }), p('Caio', { descontos: 7 })])
    expect(r.linhas.every((l) => l.foraDoPadrao.length === 0)).toBe(true)
  })
})
