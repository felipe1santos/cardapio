import { describe, expect, it } from 'vitest'
import { avaliarContagem, linhasDaAbertura, linhasDoAjuste, linhasDoMovimento, MOVIMENTOS, permissaoDoMovimento, precisaAprovacao, tempoAberto } from './caixa-regras'

const soma = (ls: { valorCentavos: number }[]) => ls.reduce((s, l) => s + l.valorCentavos, 0)
const naGaveta = (ls: { carteira: string; valorCentavos: number }[]) => soma(ls.filter((l) => l.carteira === 'gaveta'))

describe('movimentos do caixa', () => {
  it('cada movimento mexe na gaveta com o sinal certo', () => {
    expect(naGaveta(linhasDoMovimento('reforco', 5000))).toBe(5000)
    for (const m of ['sangria', 'despesa', 'retirada', 'perda'] as const) expect(naGaveta(linhasDoMovimento(m, 5000))).toBe(-5000)
  })
  it('sangria, reforço e retirada só trocam de lugar (soma zero); despesa e perda viram resultado', () => {
    for (const m of ['sangria', 'reforco', 'retirada'] as const) expect(soma(linhasDoMovimento(m, 1234))).toBe(0)
    expect(linhasDoMovimento('despesa', 100).find((l) => l.carteira === 'resultado')?.valorCentavos).toBe(-100)
    expect(linhasDoMovimento('perda', 100).find((l) => l.carteira === 'resultado')?.valorCentavos).toBe(-100)
  })
  it('valor negativo vindo da tela não inverte o movimento', () => {
    expect(naGaveta(linhasDoMovimento('sangria', -5000))).toBe(-5000)
  })
  it('permissões: despesa tem a própria; o resto é sangria', () => {
    expect(permissaoDoMovimento('despesa')).toBe('despesa')
    for (const m of MOVIMENTOS.filter((x) => x !== 'despesa')) expect(permissaoDoMovimento(m)).toBe('sangria')
  })
})

describe('aprovação por PIN', () => {
  it('saída acima do limite precisa; até o limite não', () => {
    expect(precisaAprovacao({ movimento: 'sangria', valor: 10001, limite: 10000, papel: 'atendente' })).toBe(true)
    expect(precisaAprovacao({ movimento: 'sangria', valor: 10000, limite: 10000, papel: 'atendente' })).toBe(false)
  })
  it('reforço nunca; dono nunca', () => {
    expect(precisaAprovacao({ movimento: 'reforco', valor: 999999, limite: 100, papel: 'atendente' })).toBe(false)
    expect(precisaAprovacao({ movimento: 'despesa', valor: 999999, limite: 100, papel: 'dono' })).toBe(false)
  })
})

describe('fechamento', () => {
  it('contagem cega: diferença e limite', () => {
    expect(avaliarContagem({ esperado: 10000, contado: 9500, limite: 500 })).toEqual({ diferenca: -500, acimaDoLimite: false })
    expect(avaliarContagem({ esperado: 10000, contado: 9499, limite: 500 })).toEqual({ diferenca: -501, acimaDoLimite: true })
    expect(avaliarContagem({ esperado: 10000, contado: 10501, limite: 500 }).acimaDoLimite).toBe(true)
  })
  it('ajuste deixa a gaveta igual ao contado', () => {
    expect(naGaveta(linhasDoAjuste(-300))).toBe(-300)
    expect(linhasDoAjuste(0)).toEqual([])
  })
  it('abertura: fundo entra na gaveta; zero não lança', () => {
    expect(naGaveta(linhasDaAbertura(20000))).toBe(20000)
    expect(linhasDaAbertura(0)).toEqual([])
  })
  it('tempo aberto', () => {
    const agora = Date.parse('2026-10-02T15:00:00Z')
    expect(tempoAberto('2026-10-02T14:45:00Z', agora)).toBe('15 min')
    expect(tempoAberto('2026-10-02T11:40:00Z', agora)).toBe('3 h 20 min')
    expect(tempoAberto('2026-10-02T12:00:00Z', agora)).toBe('3 h')
  })
})
