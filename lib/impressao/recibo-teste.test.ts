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

  it('contas fecham: subtotal − desconto + entrega = R$ 4.088,00', () => {
    expect(Number(s.subtotal) - Number(s.desconto) + Number(s.taxa_entrega)).toBe(TOTAL_RECIBO_TESTE)
    expect(s.total).toBe(4088)
    expect(Number(s.pago) + Number(s.restante)).toBe(4088)
  })

  it('sai pelo renderizador real com tudo o que revela corte', () => {
    const t = montarPreConta(s)
    for (const trecho of [
      'TESTE DE IMPRESSÃO', 'SEM VALOR FISCAL', 'TESTE DE IMPRESSÃO — SEM VALOR FISCAL', 'RECIBO/EXTRATO', 'Maria Aparecida dos Santos Conceição de Albuquerque Figueiredo', '(27) 99999-0000',
      'Avenida Nossa Senhora da Penha', '1500', 'Santa Lúcia · Vitória/ES', 'Combo Família Gigante', '+ 2x Bacon crocante extra (R$ 18,00)',
      'Obs.: Entregar na portaria', 'Subtotal\x02R$ 4.108,00', 'Desconto\x02-R$ 45,00', 'Taxa de entrega\x02R$ 25,00', 'TOTAL\x02R$ 4.088,00',
      'Pix: R$ 1.000,00', 'RESTANTE A PAGAR\x02R$ 3.088,00', 'Status: Pagamento parcial',
    ]) expect(t).toContain(trecho)
  })

  it('régua com bordas no começo e no fim do papel', () => {
    const l = montarPreContaLinhas(s)
    expect(l[0]).toBe('\x01K')
    expect(l[l.length - 1]).toBe('\x01K')
  })

  it('não é um pedido: sem comanda, mesa ou senha', () => {
    expect(s).not.toHaveProperty('comanda_id')
    expect(s.comanda_numero).toBeUndefined()
    expect(s.senha).toBeUndefined()
    expect(s.recibo_teste).toBe(true)
  })
})
