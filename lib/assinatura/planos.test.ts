import { describe, expect, it } from 'vitest'
import { hojeSaoPaulo, novaValidade, PLANOS, planoValido, somarMeses, validadeAposPagamento, valorDoPlano } from './planos'

describe('planos', () => {
  it('valores do site: Básico 97, Completo 149; Completo liga as três chaves', () => {
    expect(PLANOS.basico.valor).toBe(97)
    expect(PLANOS.completo.valor).toBe(149)
    expect(PLANOS.completo.modulos).toEqual({ financeiro: true, agente_ia: true, disparos: true })
    expect(Object.values(PLANOS.basico.modulos).some(Boolean)).toBe(false)
  })

  it('planoValido só aceita os dois', () => {
    expect(planoValido('basico')).toBe(true)
    expect(planoValido('completo')).toBe(true)
    expect(planoValido('premium')).toBe(false)
    expect(planoValido(undefined)).toBe(false)
  })

  it('valor de teste só quando a variável é um número positivo', () => {
    expect(valorDoPlano('completo', {})).toBe(149)
    expect(valorDoPlano('completo', { ASSINATURA_VALOR_TESTE: '1' })).toBe(1)
    expect(valorDoPlano('basico', { ASSINATURA_VALOR_TESTE: '0' })).toBe(97)
    expect(valorDoPlano('basico', { ASSINATURA_VALOR_TESTE: 'abc' })).toBe(97)
  })
})

describe('prazo da assinatura', () => {
  it('somarMeses trava no fim do mês', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28')
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29')
    expect(somarMeses('2026-11-02', 1)).toBe('2026-12-02')
    expect(somarMeses('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('validade = vencimento + 1 mês + 5 dias de carência, 23:59:59 em São Paulo', () => {
    // Pagou a cobrança de 02/11 → vale até 07/12 23:59:59 (-03:00) = 08/12 02:59:59Z.
    expect(validadeAposPagamento('2026-11-02')).toBe('2026-12-08T02:59:59.000Z')
  })

  it('renovação nunca encurta a validade atual', () => {
    const atual = '2027-03-01T02:59:59.000Z'
    expect(novaValidade(atual, '2026-11-02')).toBe(atual)
    expect(novaValidade('2026-11-01T02:59:59.000Z', '2026-11-02')).toBe('2026-12-08T02:59:59.000Z')
    expect(novaValidade(null, '2026-11-02')).toBe('2026-12-08T02:59:59.000Z')
  })

  it('hojeSaoPaulo usa o fuso de São Paulo (22h de domingo em SP ainda é domingo)', () => {
    expect(hojeSaoPaulo(new Date('2026-11-02T01:00:00Z'))).toBe('2026-11-01')
    expect(hojeSaoPaulo(new Date('2026-11-02T12:00:00Z'))).toBe('2026-11-02')
  })
})
