import { describe, expect, it } from 'vitest'
import { JANELA_TRANSFERENCIA_MS, aposCorteDaTransferencia } from './transferencia'

const corte = '2026-09-25T12:00:00.000Z'
const t = (s: number) => new Date(Date.parse(corte) + s * 1000).toISOString()
const pedidos = [
  { id: 'antes', criadoEm: t(-30) },
  { id: 'depois', criadoEm: t(5) },
  { id: 'sem-data', criadoEm: null },
]

describe('troca da cozinha para o Assistente Beta', () => {
  it('sem troca registrada: todos os pedidos seguem', () => {
    expect(aposCorteDaTransferencia(pedidos, null).map((p) => p.id)).toEqual(['antes', 'depois', 'sem-data'])
  })
  it('na janela: o Beta só recebe pedido criado depois da troca', () => {
    expect(aposCorteDaTransferencia(pedidos, corte, Date.parse(corte) + 10_000).map((p) => p.id)).toEqual(['depois'])
  })
  it('depois da janela: pedido de antes não impresso é recuperado (nada se perde)', () => {
    expect(aposCorteDaTransferencia(pedidos, corte, Date.parse(corte) + JANELA_TRANSFERENCIA_MS).map((p) => p.id)).toEqual(['antes', 'depois', 'sem-data'])
  })
  it('data inválida não bloqueia a fila', () => {
    expect(aposCorteDaTransferencia(pedidos, 'lixo')).toHaveLength(3)
  })
})
