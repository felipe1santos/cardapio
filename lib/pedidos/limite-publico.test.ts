import { describe, expect, it } from 'vitest'
import { criarLimitePedidoPublico } from './limite-publico'

describe('limite do pedido público da vitrine', () => {
  it('o 16º pedido do mesmo IP na mesma loja em 1 min é recusado; depois de 1 min volta', () => {
    const l = criarLimitePedidoPublico()
    for (let i = 0; i < 15; i++) expect(l.permitir('1.2.3.4', 'menuzia', 1000 + i)).toBe(true)
    expect(l.permitir('1.2.3.4', 'menuzia', 2000)).toBe(false)
    expect(l.permitir('1.2.3.4', 'menuzia', 62_000)).toBe(true)
  })
  it('o mesmo IP (operadora/Wi-Fi compartilhado) em OUTRA loja não é bloqueado pelos pedidos da primeira', () => {
    const l = criarLimitePedidoPublico()
    for (let i = 0; i < 15; i++) l.permitir('1.2.3.4', 'loja-a', 1000)
    expect(l.permitir('1.2.3.4', 'loja-a', 1000)).toBe(false)
    expect(l.permitir('1.2.3.4', 'loja-b', 1000)).toBe(true)
  })
  it('200 por minuto por loja, somando todos os IPs', () => {
    const l = criarLimitePedidoPublico()
    for (let i = 0; i < 200; i++) expect(l.permitir(`10.0.${Math.floor(i / 10)}.${i % 10}`, 'loja', 1000)).toBe(true)
    expect(l.permitir('99.9.9.9', 'loja', 1000)).toBe(false)
  })
  it('pedido recusado não conta (quem passou do limite não fica preso para sempre)', () => {
    const l = criarLimitePedidoPublico()
    for (let i = 0; i < 15; i++) l.permitir('ip', 'x', 0)
    for (let i = 0; i < 100; i++) l.permitir('ip', 'x', 30_000)
    expect(l.permitir('ip', 'x', 60_001)).toBe(true)
  })
})
