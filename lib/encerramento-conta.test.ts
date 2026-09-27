import { describe, expect, it } from 'vitest'
import { montarResumoEncerramento, type ContaParaResumo } from './encerramento-conta'

const aberta: ContaParaResumo = {
  status: 'aberta',
  totais: { total: 80, pago: 30, restante: 50 },
  pedidos: [{ status: 'preparando' }, { status: 'entregue' }, { status: 'cancelado' }],
}

describe('resumo de encerramento da conta', () => {
  it('cancelada: valores de ANTES (o banco zera o total), motivo, quem e quando', () => {
    const depois: ContaParaResumo = {
      status: 'cancelada',
      totais: { total: 0, pago: 0, restante: 0 },
      pedidos: [{ status: 'cancelado' }, { status: 'cancelado' }, { status: 'cancelado' }],
      canceladaMotivo: 'Mesa esquecida aberta',
      canceladaPorNome: 'Ana',
      canceladaEm: '2026-09-26T22:00:00Z',
    }
    const r = montarResumoEncerramento('cancelada', { ...aberta, totais: { total: 80, pago: 0, restante: 80 } }, depois)
    expect(r).toEqual({
      acao: 'cancelada',
      total: 80,
      pago: 0,
      faltaPagar: 80,
      pendentes: 1,
      cancelados: 3,
      motivo: 'Mesa esquecida aberta',
      usuario: 'Ana',
      horario: '2026-09-26T22:00:00Z',
    })
  })

  it('fechada: valores de DEPOIS (decisões da cozinha e pagamentos do fechamento)', () => {
    const depois: ContaParaResumo = {
      status: 'fechada',
      totais: { total: 60, pago: 60, restante: 0 },
      pedidos: [{ status: 'entregue' }, { status: 'entregue' }, { status: 'cancelado' }],
      fechadaPorNome: 'Caixa 1',
      fechadaEm: '2026-09-26T23:00:00Z',
    }
    const r = montarResumoEncerramento('fechada', aberta, depois)
    expect(r.total).toBe(60)
    expect(r.pago).toBe(60)
    expect(r.faltaPagar).toBe(0)
    expect(r.pendentes).toBe(1)
    expect(r.cancelados).toBe(1)
    expect(r.motivo).toBeNull()
    expect(r.usuario).toBe('Caixa 1')
  })

  it('sem leitura de depois: usa o que a tela sabe (autor e hora locais)', () => {
    const r = montarResumoEncerramento('cancelada', aberta, null, { usuario: 'Eu', motivo: 'Desistiu', horario: 'agora' })
    expect(r.usuario).toBe('Eu')
    expect(r.motivo).toBe('Desistiu')
    expect(r.horario).toBe('agora')
    expect(r.faltaPagar).toBe(50)
  })
})
