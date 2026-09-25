import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { snapshotReciboTeste } from '../../lib/impressao/recibo-teste'

const require = createRequire(import.meta.url)
type Bloco = { t: string; s?: string; rotulo?: string; valor?: string; nome?: string }
type Doc = { teste: boolean; loja: string; blocos: Bloco[] }
const { montarPreContaBeta, textoDoDocumento } = require('./pre-conta-beta.js') as {
  montarPreContaBeta: (s: unknown) => Doc
  textoDoDocumento: (d: Doc) => string
}
const { CONTAS } = require('../test/fixtures-pre-conta.cjs') as { CONTAS: Record<string, Record<string, unknown>> }

const FRASES_TESTE = ['TESTE DE IMPRESSÃO', 'SEM VALOR FISCAL', 'CONFERÊNCIA DE CONSUMO', 'NÃO É DOCUMENTO FISCAL', 'PEDIDO DE DEMONSTRAÇÃO']
const campo = (d: Doc, r: string) => d.blocos.find((b) => b.t === 'campo' && b.rotulo === r)?.valor
const valor = (d: Doc, r: string) => d.blocos.find((b) => (b.t === 'valor' || b.t === 'total') && b.rotulo === r)?.valor

describe('Recibo/Extrato do Beta — conta real', () => {
  it('mesa: faixas, mesa/comanda, itens, totais; sem régua, marcadores nem frases de teste', () => {
    const d = montarPreContaBeta(CONTAS.mesa)
    const tipos = d.blocos.map((b) => b.t)
    expect(tipos).not.toContain('marcas')
    expect(d.blocos.filter((b) => b.t === 'faixa').map((b) => b.s)).toEqual(['RECIBO/EXTRATO', 'CONSUMO (6)', 'TOTAIS'])
    expect(d.blocos.filter((b) => b.t === 'centro').map((b) => b.s)).not.toEqual(expect.arrayContaining(['TESTE DE IMPRESSÃO']))
    expect(campo(d, 'Mesa')).toBe('Varanda 02')
    expect(campo(d, 'Comanda')).toBe('57')
    expect(valor(d, 'TOTAL')).toBe('R$ 160,09')
    expect(valor(d, 'Desconto')).toBe('−R$ 12,50')
    expect(valor(d, 'Status')).toBe('Pagamento parcial')
    expect(textoDoDocumento(d)).toContain('+ 2x Bacon (R$ 8,00)')
    expect(textoDoDocumento(d)).toContain('Obs.: Bem passado')
    expect(textoDoDocumento(d)).toContain('CANCELADOS — NÃO COBRADOS')
  })
  it('rodapé da conta real: NÃO É DOCUMENTO FISCAL discreto, junto de feito por Menuzia; nada do teste', () => {
    for (const conta of Object.values(CONTAS)) {
      const d = montarPreContaBeta(conta)
      const rod = d.blocos.filter((b) => b.t === 'rodape')
      expect(rod.map((b) => b.s)).toEqual(['Confira os itens da sua conta.', 'NÃO É DOCUMENTO FISCAL', 'feito por Menuzia.com.br'])
      expect(rod.every((b) => !(b as { negrito?: boolean }).negrito)).toBe(true)
      expect(d.blocos.some((b) => b.t === 'faixa' && b.s === 'NÃO É DOCUMENTO FISCAL')).toBe(false)
      const t = textoDoDocumento(d)
      for (const x of ['TESTE DE IMPRESSÃO', 'PEDIDO DE DEMONSTRAÇÃO', 'SEM VALOR FISCAL', 'CONFERÊNCIA DE CONSUMO']) expect(t).not.toContain(x)
      expect(d.blocos.some((b) => b.t === 'marcas')).toBe(false)
    }
  })
  it('balcão a receber, conta paga e conta de R$ 4.088,00', () => {
    const b = montarPreContaBeta(CONTAS.balcao)
    expect(campo(b, 'Balcão')).toBe('senha 128')
    expect(valor(b, 'Status')).toBe('A receber')
    expect(valor(montarPreContaBeta(CONTAS.pago), 'Status')).toBe('Pago')
    expect(valor(montarPreContaBeta(CONTAS.milhar), 'TOTAL')).toBe('R$ 4.088,00')
  })
  it('conta real NUNCA imprime telefone, endereço, observação do pedido nem frete, mesmo vindo no snapshot', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, cliente_telefone: '27999990000', endereco: { rua: 'Rua X', numero: '1' }, observacao: 'interno', taxa_entrega: 9 })
    const t = textoDoDocumento(d)
    for (const x of ['27999990000', 'Rua X', 'interno', 'Taxa de entrega']) expect(t).not.toContain(x)
  })
  it('campos vazios não viram linha', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, operador: '', cliente_nome: null })
    expect(d.blocos.some((b) => b.t === 'campo' && (!b.valor || b.valor.trim() === ''))).toBe(false)
    expect(campo(d, 'Operador')).toBeUndefined()
  })
})

describe('Recibo/Extrato do Beta — teste (mesmo montador)', () => {
  const destino = { loja: 'Loja Fictícia', impressora: 'Caixa', nomeSistema: 'POS', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }
  const snap = snapshotReciboTeste(destino, 'Gerente', new Date('2026-09-25T12:00:00Z'))
  const d = montarPreContaBeta(snap)

  it('ordem: marcas, cabeçalho, faixa, frases, pontilhado, atendimento, pontilhado, CONSUMO, itens, TOTAIS, total, pagamentos, pontilhado, rodapé, marcas', () => {
    const t = d.blocos.map((b) => b.t)
    expect(t[0]).toBe('marcas')
    expect(t.slice(1, 3)).toEqual(['cabecalho', 'faixa'])
    expect(d.blocos.slice(3, 8).map((b) => b.s)).toEqual(FRASES_TESTE)
    expect(t[8]).toBe('pontilhado')
    const iConsumo = d.blocos.findIndex((b) => b.s?.startsWith('CONSUMO'))
    const iTotais = d.blocos.findIndex((b) => b.s === 'TOTAIS')
    const iTotal = t.indexOf('total')
    expect(t[iConsumo - 1]).toBe('pontilhado')
    expect(iConsumo).toBeLessThan(iTotais)
    expect(iTotais).toBeLessThan(iTotal)
    expect(t.slice(-3)).toEqual(['rodape', 'marcas', 'corte'])
  })
  it('números corretos', () => {
    expect(valor(d, 'Subtotal')).toBe('R$ 4.108,00')
    expect(valor(d, 'Desconto')).toBe('−R$ 45,00')
    expect(valor(d, 'Taxa de entrega')).toBe('R$ 25,00')
    expect(valor(d, 'TOTAL')).toBe('R$ 4.088,00')
    expect(valor(d, 'Já pago')).toBe('R$ 1.000,00')
    expect(valor(d, 'Restante a pagar')).toBe('R$ 3.088,00')
    expect(valor(d, 'Status')).toBe('Pagamento parcial')
  })
  it('a ÚNICA diferença para a conta real: dados de teste, frases de teste e marcadores', () => {
    const real = montarPreContaBeta({ ...snap, recibo_teste: false })
    const soDoTeste = (b: Bloco) =>
      b.t === 'marcas' ||
      (b.t === 'centro' && FRASES_TESTE.includes(b.s ?? '')) ||
      (b.t === 'rodape' && b.s === 'TESTE DE IMPRESSÃO — SEM VALOR FISCAL') ||
      (b.t === 'campo' && ['Telefone', 'Endereço', 'Complemento', 'Cidade/UF', 'Observação'].includes(b.rotulo ?? '')) ||
      (b.t === 'valor' && b.rotulo === 'Taxa de entrega')
    // Na conta real, o balcão/mesa aparecem no lugar do "PEDIDO DE DEMONSTRAÇÃO" e o aviso
    // não fiscal vai no rodapé (no teste ele está entre as frases de teste).
    const semIdentificacao = (b: Bloco) =>
      !(b.t === 'campo' && ['Mesa', 'Comanda', 'Balcão'].includes(b.rotulo ?? '')) && !(b.t === 'rodape' && b.s === 'NÃO É DOCUMENTO FISCAL')
    expect(d.blocos.filter((b) => !soDoTeste(b))).toEqual(real.blocos.filter(semIdentificacao))
  })
})
