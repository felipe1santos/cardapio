import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { snapshotReciboTeste } from '../../lib/impressao/recibo-teste'

const require = createRequire(import.meta.url)
type Bloco = { t: string; s?: string; rotulo?: string; valor?: string; titulo?: string; sub?: string; pares?: [string, string][]; desc?: string; qtd?: string; unit?: string; total?: string; subs?: string[] }
type Doc = { versao: number; modelo: string; teste: boolean; loja: string; blocos: Bloco[] }
const { montarPreContaBeta, textoDoDocumento } = require('./pre-conta-beta.js') as {
  montarPreContaBeta: (s: unknown) => Doc
  textoDoDocumento: (d: Doc) => string
}
const { CONTAS } = require('../test/fixtures-pre-conta.cjs') as { CONTAS: Record<string, Record<string, unknown>> }

const par = (d: Doc, r: string) => d.blocos.find((b) => b.t === 'par_pc' && b.rotulo === r)?.valor
const total = (d: Doc) => d.blocos.find((b) => b.t === 'faixa_total')?.valor
const mesa = (d: Doc) => d.blocos.find((b) => b.t === 'mesa')!

describe('Pré-conta do Beta — modelo oficial, com faixas de seção para leitura (2026-09-28)', () => {
  it('ordem: data+logo, linha, PRE-CONTA, não fiscal, mesa, faixa ITENS CONSUMIDOS, tabela, faixa VALORES, totais, faixa TOTAL A PAGAR, rodapé', () => {
    const d = montarPreContaBeta(CONTAS.mesa)
    expect(d.versao).toBe(2)
    expect(d.modelo).toBe('pre_conta')
    expect(d.blocos.map((b) => b.t)).toEqual([
      'topo_data', 'linha_grossa', 'faixa_arred', 'centro', 'mesa', 'secao', 'tabela_cab', 'regua',
      'tabela_item', 'tabela_item', 'tabela_item',
      'secao', 'par_pc', 'par_pc', 'par_pc', 'par_pc', 'par_pc', 'faixa_total',
      'centro', 'tracejado', 'centro', 'espaco', 'centro', 'corte',
    ])
    expect(d.blocos.filter((b) => b.t === 'secao').map((b) => b.s)).toEqual(['ITENS CONSUMIDOS', 'VALORES'])
    expect(d.blocos.find((b) => b.t === 'faixa_total')?.rotulo).toBe('TOTAL A PAGAR')
    expect(d.blocos.find((b) => b.t === 'faixa_arred')?.s).toBe('PRE-CONTA')
    expect(d.blocos.filter((b) => b.t === 'centro').map((b) => b.s)).toEqual([
      '*** NAO E DOCUMENTO FISCAL ***', 'CONFIRA OS ITENS ANTES DO PAGAMENTO', 'Esta pre-conta pode ser paga no caixa', 'Obrigado pela preferencia!',
    ])
  })

  it('mesa grande à esquerda com o número embaixo; comanda, atendente e abertura à direita', () => {
    const m = mesa(montarPreContaBeta({ ...CONTAS.mesa, pedido_numero: 221, atendente: 'Pedro Henrique' }))
    expect(m.titulo).toBe('Mesa Varanda 02')
    expect(mesa(montarPreContaBeta({ ...CONTAS.mesa, mesa: 'Mesa 01' })).titulo).toBe('Mesa 01')
    expect(mesa(montarPreContaBeta({ ...CONTAS.mesa, mesa: '07' })).titulo).toBe('Mesa 07')
    expect(m.sub).toBe('#000221')
    expect(m.pares).toEqual([['Comanda', '57'], ['Atendente', 'Pedro'], ['Abertura', '19:02']])
  })

  it('tabela: QTD, DESCRICAO em maiúsculas, UNIT. e TOTAL sem R$; adicionais e observação embaixo da descrição', () => {
    const d = montarPreContaBeta(CONTAS.mesa)
    const itens = d.blocos.filter((b) => b.t === 'tabela_item')
    expect(itens[0]).toMatchObject({ qtd: '2', desc: 'X-BURGUER ARTESANAL COM QUEIJO COALHO GRELHADO E CEBOLA CARAMELIZADA', unit: '40,00', total: '80,00' })
    expect(itens[0]!.subs).toEqual(['+ 2x Bacon', '+ Ovo', 'Obs.: Bem passado'])
    expect(itens[1]!.subs).toEqual(['Média - Calabresa / Frango com Catupiry', '+ Borda: Cheddar', '+ Massa: Fina'])
    // Sem linha entre os itens: régua só antes e depois da tabela.
    const iTab = d.blocos.findIndex((b) => b.t === 'tabela_item')
    expect(d.blocos.slice(iTab, iTab + 3).every((b) => b.t === 'tabela_item')).toBe(true)
  })

  it('totais: subtotal, serviço opcional, desconto e, com pagamento parcial, TOTAL A PAGAR = restante', () => {
    const d = montarPreContaBeta(CONTAS.mesa)
    expect(par(d, 'Subtotal')).toBe('R$ 156,90')
    expect(par(d, 'Servico 10% opcional')).toBe('R$ 15,69')
    expect(par(d, 'Desconto')).toBe('R$ 12,50')
    expect(par(d, 'Total da conta')).toBe('R$ 160,09')
    expect(par(d, 'Ja pago')).toBe('R$ 60,00')
    expect(total(d)).toBe('R$ 100,09')
    // Sem pagamento: TOTAL A PAGAR = total, sem as linhas de pago.
    const b = montarPreContaBeta(CONTAS.balcao)
    expect(total(b)).toBe('R$ 76,90')
    expect(par(b, 'Ja pago')).toBeUndefined()
    expect(par(b, 'Desconto')).toBe('R$ 0,00')
    expect(total(montarPreContaBeta(CONTAS.milhar))).toBe('R$ 4.088,00')
  })

  it('taxa manual da conta (0106) sai com o nome dela, entre serviço e desconto', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, taxa_extra: 15, taxa_extra_nome: 'Couvert' })
    const rot = d.blocos.filter((b) => b.t === 'par_pc').map((b) => b.rotulo)
    expect(rot.slice(0, 4)).toEqual(['Subtotal', 'Servico 10% opcional', 'Couvert', 'Desconto'])
    expect(par(d, 'Couvert')).toBe('R$ 15,00')
    expect(par(montarPreContaBeta(CONTAS.mesa), 'Couvert')).toBeUndefined()
  })

  it('balcão: senha no lugar da mesa e o primeiro nome do cliente; reimpressão marcada', () => {
    const d = montarPreContaBeta(CONTAS.balcao)
    expect(mesa(d).titulo).toBe('Senha 128')
    expect(mesa(d).pares).toContainEqual(['Cliente', 'João'])
    expect(d.blocos.find((b) => b.t === 'topo_data')).toMatchObject({ via: '2a VIA' })
  })

  it('conta real NUNCA imprime telefone, endereço, observação do pedido nem frete, mesmo vindo no snapshot', () => {
    const d = montarPreContaBeta({ ...CONTAS.mesa, cliente_telefone: '27999990000', endereco: { rua: 'Rua X', numero: '1' }, observacao: 'interno', taxa_entrega: 9 })
    const t = textoDoDocumento(d)
    for (const x of ['27999990000', 'Rua X', 'interno', 'Taxa de entrega']) expect(t).not.toContain(x)
    expect(d.blocos.some((b) => b.t === 'marcas')).toBe(false)
    expect(t).not.toContain('TESTE DE IMPRESSAO')
  })
})

describe('Pré-conta do Beta — teste (mesmo montador)', () => {
  const s = snapshotReciboTeste(
    { loja: 'Cantina', impressora: 'Caixa', nomeSistema: 'POS-80', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 },
    'Operador',
  )
  it('mesmo modelo da conta real, com marcas de borda, aviso de teste e os dados de teste', () => {
    const d = montarPreContaBeta(s)
    expect(d.teste).toBe(true)
    expect(d.blocos[0]!.t).toBe('marcas')
    expect(d.blocos.at(-2)!.t).toBe('marcas')
    const t = textoDoDocumento(d)
    expect(t).toContain('PRE-CONTA')
    expect(t).toContain('TESTE DE IMPRESSAO - PEDIDO DE DEMONSTRACAO')
    expect(t).toContain('(27) 99999-0000')
    expect(par(d, 'Taxa de entrega')).toBe('R$ 25,00')
    expect(total(d)).toBe('R$ 3.088,00')
  })
})
