import { describe, it, expect } from 'vitest'
import { montarHistorico } from './conta'

const L1 = { id: 'p1', numero: 101, criadoEm: '2026-09-19T10:00:00+00:00', criadoPorNome: 'Garçom A' }
const L2 = { id: 'p2', numero: 102, criadoEm: '2026-09-19T11:00:00+00:00', criadoPorNome: 'Garçom B' }

describe('histórico da conta: cada envio à cozinha abre o lançamento', () => {
  it('o evento de envio aponta para o lançamento e traz o número', () => {
    const h = montarHistorico(
      [{ acao: 'mesa.enviou_cozinha', usuario_nome: 'Garçom A', criado_em: L1.criadoEm, dados: { numero: 101, itens: 2 }, entidade_id: 'p1' }],
      [L1],
    )
    expect(h).toEqual([{ quando: L1.criadoEm, quem: 'Garçom A', oQue: 'Enviou o lançamento #101 para a cozinha', pedidoId: 'p1', acao: 'mesa.enviou_cozinha' }])
  })

  it('lançamento sem evento (anterior ao histórico) ganha uma linha própria, sem duplicar os que têm', () => {
    const h = montarHistorico(
      [{ acao: 'mesa.enviou_cozinha', usuario_nome: 'Garçom B', criado_em: L2.criadoEm, dados: { numero: 102 }, entidade_id: 'p2' }],
      [L1, L2],
    )
    expect(h.map((e) => e.pedidoId)).toEqual(['p2', 'p1'])
    expect(h[1]).toEqual({ quando: L1.criadoEm, quem: 'Garçom A', oQue: 'Lançamento #101 enviado para a cozinha', pedidoId: 'p1', acao: 'mesa.enviou_cozinha' })
  })

  it('evento da comanda (pagamento etc.) não vira lançamento clicável', () => {
    const h = montarHistorico(
      [{ acao: 'conta.pagamento', usuario_nome: 'Caixa', criado_em: '2026-09-19T12:00:00+00:00', dados: { resumo: 'Pix R$ 10,00' }, entidade_id: 'comanda-1' }],
      [],
    )
    expect(h[0]!.pedidoId).toBeNull()
    expect(h[0]!.oQue).toContain('Pix R$ 10,00')
  })

  it('cancelamento de item do lançamento também abre o lançamento', () => {
    const h = montarHistorico(
      [{ acao: 'conta.cancelou_item', usuario_nome: 'Gerente', criado_em: '2026-09-19T12:30:00+00:00', dados: { motivo: 'errado' }, entidade_id: 'p1' }],
      [L1],
    )
    expect(h.find((e) => e.oQue.startsWith('Cancelou'))!.pedidoId).toBe('p1')
  })
})
