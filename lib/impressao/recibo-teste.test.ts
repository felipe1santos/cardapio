import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { TOTAL_RECIBO_TESTE, snapshotReciboTeste } from './recibo-teste'

// O renderizador OPERACIONAL do Assistente Beta — o mesmo arquivo empacotado no instalador.
const require = createRequire(import.meta.url)
const { montarPreConta, montarPreContaLinhas } = require('../../printer-agent/src/pre-conta.js') as {
  montarPreConta: (s: unknown) => string
  montarPreContaLinhas: (s: unknown) => string[]
}

const destino = { loja: 'Cantina Demonstração', impressora: 'Caixa', nomeSistema: 'POS-8370', computador: 'PC Caixa', larguraMm: 80, larguraPontos: 512, deslocamentoPontos: 0 }

describe('Recibo/Extrato de teste', () => {
  const s = snapshotReciboTeste(destino, 'Gerente Demo', new Date('2026-09-25T12:00:00Z'))

  it('contas fecham: subtotal − desconto + entrega = R$ 248,70 (modelo v3/PRE-CONTA.png)', () => {
    expect(Math.round((Number(s.subtotal) - Number(s.desconto) + Number(s.taxa_entrega)) * 100) / 100).toBe(TOTAL_RECIBO_TESTE)
    expect(s.total).toBe(248.7)
    expect(Number(s.pago) + Number(s.restante)).toBeCloseTo(248.7, 2)
    // A soma das linhas dos itens é o subtotal.
    const itens = s.itens as { subtotal: number }[]
    expect(Math.round(itens.reduce((t, i) => t + i.subtotal, 0) * 100) / 100).toBe(250.7)
  })

  it('o renderizador de texto (emergência) leva tudo o que revela corte', () => {
    const t = montarPreConta(s)
    for (const trecho of [
      'TESTE DE IMPRESSÃO', 'SEM VALOR FISCAL', 'RECIBO/EXTRATO', 'Maria', 'Pizza Grande Calabresa', 'Borda recheada de catupiry',
      'SubtotalR$ 250,70', 'Desconto-R$ 10,00', 'Taxa de entregaR$ 8,00', 'TOTALR$ 248,70', 'Pix: R$ 100,00', 'RESTANTE A PAGARR$ 148,70',
    ]) expect(t).toContain(trecho)
  })

  it('régua com bordas no começo e no fim do papel', () => {
    const l = montarPreContaLinhas(s)
    expect(l[0]).toBe('\x01K')
    expect(l[l.length - 1]).toBe('\x01K')
  })

  it('não é um pedido: sem comanda nem senha (a Mesa 34 é só demonstração)', () => {
    expect(s).not.toHaveProperty('comanda_id')
    expect(s.comanda_numero).toBeUndefined()
    expect(s.senha).toBeUndefined()
    expect(s.recibo_teste).toBe(true)
  })
})
