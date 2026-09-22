import { describe, it, expect } from 'vitest'
import { avisoDePedidosParados, pedidoParado, PEDIDO_PARADO_MS, tempoParado } from './pedido-parado'

const AGORA = Date.parse('2026-09-22T12:00:00Z')
const hAtras = (h: number) => new Date(AGORA - h * 3_600_000).toISOString()

describe('pedidoParado', () => {
  it('pedido recente não é pedido parado', () => {
    expect(pedidoParado({ status: 'em_rota', criadoEm: hAtras(2) }, AGORA)).toBe(false)
  })

  it('acusa o pedido aberto além do corte', () => {
    expect(pedidoParado({ status: 'em_rota', criadoEm: hAtras(30) }, AGORA)).toBe(true)
  })

  it('vale para qualquer status que ainda espera alguém da loja', () => {
    for (const status of ['recebido', 'preparando', 'pronto', 'em_rota']) {
      expect(pedidoParado({ status, criadoEm: hAtras(48) }, AGORA)).toBe(true)
    }
  })

  /** Pedido resolvido é assunto encerrado, por mais antigo que seja. */
  it('não acusa pedido entregue nem cancelado', () => {
    expect(pedidoParado({ status: 'entregue', criadoEm: hAtras(900) }, AGORA)).toBe(false)
    expect(pedidoParado({ status: 'cancelado', criadoEm: hAtras(900) }, AGORA)).toBe(false)
  })

  it('o corte é exatamente 12 horas', () => {
    const noLimite = new Date(AGORA - PEDIDO_PARADO_MS).toISOString()
    const umPouquinhoAntes = new Date(AGORA - PEDIDO_PARADO_MS + 1000).toISOString()
    expect(pedidoParado({ status: 'pronto', criadoEm: noLimite }, AGORA)).toBe(true)
    expect(pedidoParado({ status: 'pronto', criadoEm: umPouquinhoAntes }, AGORA)).toBe(false)
  })

  it('data ilegível não vira alarme', () => {
    expect(pedidoParado({ status: 'em_rota', criadoEm: 'ontem' }, AGORA)).toBe(false)
  })
})

describe('tempoParado', () => {
  it('conta em horas no primeiro dia', () => {
    expect(tempoParado(hAtras(13), AGORA)).toBe('13h')
  })

  it('vira dias depois de 24 horas', () => {
    expect(tempoParado(hAtras(25), AGORA)).toBe('1 dia')
    expect(tempoParado(hAtras(24 * 63), AGORA)).toBe('63 dias')
  })

  it('devolve vazio para data impossível', () => {
    expect(tempoParado('ontem', AGORA)).toBe('')
    expect(tempoParado(new Date(AGORA + 3_600_000).toISOString(), AGORA)).toBe('')
  })
})

describe('avisoDePedidosParados', () => {
  it('sem nada parado, não há aviso', () => {
    expect(avisoDePedidosParados([{ status: 'em_rota', criadoEm: hAtras(1) }], AGORA)).toBeNull()
  })

  it('fala no singular com um só', () => {
    const aviso = avisoDePedidosParados([{ status: 'em_rota', criadoEm: hAtras(40) }], AGORA)
    expect(aviso).toContain('1 pedido está aberto')
  })

  it('conta quantos são e diz o que fazer', () => {
    const aviso = avisoDePedidosParados(
      [
        { status: 'em_rota', criadoEm: hAtras(40) },
        { status: 'pronto', criadoEm: hAtras(72) },
        { status: 'entregue', criadoEm: hAtras(900) },
      ],
      AGORA,
    )
    expect(aviso).toContain('2 pedidos')
    expect(aviso).toContain('cancele')
  })
})
