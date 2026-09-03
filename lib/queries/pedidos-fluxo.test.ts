import { describe, expect, it } from 'vitest'
import { proximoStatusKanban } from './pedidos'

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
