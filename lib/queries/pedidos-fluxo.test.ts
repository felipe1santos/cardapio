import { describe, expect, it } from 'vitest'
import { proximoStatusKanban, canalDoPedido } from './pedidos'

describe('proximoStatusKanban', () => {
  describe('com o módulo de Logística ligado (comportamento histórico)', () => {
    const com = (status: Parameters<typeof proximoStatusKanban>[0], tipo: Parameters<typeof proximoStatusKanban>[1]) =>
      proximoStatusKanban(status, tipo, true)

    it('recebido avança para preparando', () => {
      expect(com('recebido', 'entrega')).toBe('preparando')
      expect(com('recebido', 'retirada')).toBe('preparando')
    })

    it('preparando avança para pronto', () => {
      expect(com('preparando', 'entrega')).toBe('pronto')
    })

    it('retirada pronta é entregue no balcão', () => {
      expect(com('pronto', 'retirada')).toBe('entregue')
    })

    it('entrega pronta NÃO avança pelo Kanban — quem despacha é a Logística', () => {
      expect(com('pronto', 'entrega')).toBeNull()
    })

    it('pedido em rota não é fechado pelo Kanban', () => {
      expect(com('em_rota', 'entrega')).toBeNull()
    })
  })

  describe('com o módulo de Logística desligado (loja sem entregador)', () => {
    const sem = (status: Parameters<typeof proximoStatusKanban>[0], tipo: Parameters<typeof proximoStatusKanban>[1]) =>
      proximoStatusKanban(status, tipo, false)

    it('entrega pronta sai para entrega direto do Kanban', () => {
      expect(sem('pronto', 'entrega')).toBe('em_rota')
    })

    it('pedido em rota é fechado no próprio Kanban', () => {
      expect(sem('em_rota', 'entrega')).toBe('entregue')
    })

    it('o começo do fluxo não muda', () => {
      expect(sem('recebido', 'entrega')).toBe('preparando')
      expect(sem('preparando', 'entrega')).toBe('pronto')
      expect(sem('pronto', 'retirada')).toBe('entregue')
    })
  })

  it('status terminais não avançam mais, com ou sem Logística', () => {
    for (const usaLogistica of [true, false]) {
      expect(proximoStatusKanban('entregue', 'entrega', usaLogistica)).toBeNull()
      expect(proximoStatusKanban('cancelado', 'entrega', usaLogistica)).toBeNull()
    }
  })
})

describe('canalDoPedido — a fronteira entre salão e delivery', () => {
  it('pedido de PDV com comanda é de mesa', () => {
    expect(canalDoPedido({ origem: 'pdv', comandaId: 'c1' })).toBe('mesa')
  })

  it('pedido de PDV sem comanda é de balcão', () => {
    expect(canalDoPedido({ origem: 'pdv' })).toBe('balcao')
  })

  it('o resto é delivery', () => {
    expect(canalDoPedido({ origem: 'cardapio' })).toBe('delivery')
    expect(canalDoPedido({})).toBe('delivery')
    // Comanda sem origem pdv NÃO vira mesa: é o caso do pedido legado/forjado.
    expect(canalDoPedido({ origem: 'cardapio', comandaId: 'c1' })).toBe('delivery')
  })

  it('canal explícito vence — é como o painel do garçom lança', () => {
    expect(canalDoPedido({ origem: 'pdv', canal: 'mesa' })).toBe('mesa')
    expect(canalDoPedido({ origem: 'cardapio', canal: 'mesa', comandaId: 'c1' })).toBe('mesa')
  })
})
