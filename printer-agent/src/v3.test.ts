import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { montarComandaV3, montarPreContaV3, textoDoV3, telefone, lojaDoTopo, rotuloDaTaxa } = require('./v3.js')

const item = (nome: string, precoUnitario: number, quantidade = 1, complementos: { nome: string; preco: number }[] = [], observacao = '') =>
  ({ nome, quantidade, precoUnitario, observacao, tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos })

const base = {
  id: 'x', numero: 135, tipo: 'entrega', canal: 'delivery', status: 'recebido', formaPagamento: 'pix', pago: false, pagamentoOnline: false,
  clienteNome: 'kkk', clienteTelefone: '5527992399932', enderecoRua: 'jaburuna', enderecoNumero: '55', enderecoComplemento: '', enderecoBairro: 'DASDAS',
  enderecoCidade: '', enderecoReferencia: '', observacao: '', subtotal: 94.63, taxaEntrega: 2.4, total: 97.03, criadoEm: '2026-10-01T23:43:00Z',
  itens: [item('Acai Grande 500 mL (300)', 19), item('X-Egg Bacon', 26, 2, [{ nome: 'Bacon', preco: 4 }]), item('Coca Lata 350ml', 5.63), item('Batata Frita (G)', 18)],
}
const loja = { nome: 'Ponto 400 Hamburgueria', telefone: '27999990000', endereco: 'Rua Pedro Alves, 120 - Centro, Vila Velha/ES' }
const blocos = (doc: { blocos: { t: string }[] }, t: string) => doc.blocos.filter((b) => b.t === t) as Record<string, unknown>[]

describe('v3 — comanda', () => {
  it('monta o pedido #135 como no modelo', () => {
    const d = montarComandaV3(base, { loja })
    expect(d.modelo).toBe('v3')
    expect(blocos(d, 'faixa').map((b) => b.s)).toEqual(['PEDIDO #135', 'ITENS', 'PAGAMENTO', 'CLIENTE'])
    expect(blocos(d, 'loja_nome')[0].s).toBe('PONTO 400 HAMBURGUERIA')
    expect(blocos(d, 'loja_endereco')[0].partes).toEqual(['Rua Pedro Alves, 120', 'Centro'])
    expect(blocos(d, 'loja_telefone')[0].s).toBe('(27) 99999-0000')
    expect(blocos(d, 'data')[0].s).toBe('01/10/2026 20:43')
    expect(blocos(d, 'tipo')[0].s).toBe('ENTREGA')
    const itens = blocos(d, 'item')
    expect(itens.map((i) => [String(i.texto).replace(/ /g, ' '), i.valor])).toEqual([
      ['1x Acai Grande 500 mL (300)', '19,00'], ['2x X-Egg Bacon (+ Bacon)', '52,00'], ['1x Coca Lata 350ml', '5,63'], ['1x Batata Frita (G)', '18,00'],
    ])
    expect(blocos(d, 'par').map((p) => `${p.rotulo} ${p.valor}`)).toEqual(['Subtotal R$ 94,63', 'Taxa de entrega R$ 2,40'])
    expect(blocos(d, 'total')[0].valor).toBe('R$ 97,03')
    expect(blocos(d, 'texto').map((b) => b.s)).toEqual(['Pagamento: PIX'])
  })

  it('telefone sem o 55 e endereço por partes, nunca começando com hífen', () => {
    const d = montarComandaV3({ ...base, enderecoComplemento: ' - Apto 3', enderecoCidade: 'Vila Velha/ES' }, { loja })
    const dados = blocos(d, 'dado')
    expect(dados.find((x) => x.rotulo === 'Tel.:')?.partes).toEqual(['(27) 99239-9932'])
    const end = dados.find((x) => x.rotulo === 'End.:')?.partes as string[]
    expect(end).toEqual(['jaburuna, 55', 'Apto 3', 'DASDAS', 'Vila Velha/ES'])
    for (const p of end) expect(p.startsWith('-')).toBe(false)
    expect(telefone('27992399932')).toBe('(27) 99239-9932')
    expect(telefone('552733334444')).toBe('(27) 3333-4444')
  })

  it('omite linhas com valor zero (taxa de entrega 0, desconto 0)', () => {
    const d = montarComandaV3({ ...base, taxaEntrega: 0, total: 94.63 }, { loja, extras: { desconto: 0 } })
    expect(blocos(d, 'par').map((p) => p.rotulo)).toEqual(['Subtotal'])
    const c = montarComandaV3({ ...base, total: 92.03 }, { loja, extras: { desconto: 5 } })
    expect(blocos(c, 'par').map((p) => `${p.rotulo} ${p.valor}`)).toEqual(['Subtotal R$ 94,63', 'Taxa de entrega R$ 2,40', 'Desconto - R$ 5,00'])
  })

  it('PAGO só quando pago de verdade; Pix online confirmado; aguardando pagamento não imprime', () => {
    const pg = (p: Record<string, unknown>) => blocos(montarComandaV3({ ...base, ...p }, { loja }), 'texto').map((b) => b.s)[0]
    expect(pg({ pagamentoOnline: true, pago: true })).toBe('Pagamento: PIX ONLINE - PAGO')
    expect(pg({ pagamentoOnline: true, pago: false })).toBe('Pagamento: PIX ONLINE')
    expect(pg({ formaPagamento: 'pix', pago: false })).toBe('Pagamento: PIX')
    expect(pg({ formaPagamento: 'credito', pago: true })).toBe('Pagamento: CARTÃO DE CRÉDITO - PAGO')
    expect(pg({ formaPagamento: 'dinheiro' })).toBe('Pagamento: DINHEIRO')
    expect(montarComandaV3({ ...base, status: 'aguardando_pagamento', pagamentoOnline: true }, { loja })).toBeNull()
  })

  it('observação do item logo abaixo dele; observação geral em faixa própria antes de PAGAMENTO; vazias somem', () => {
    const d = montarComandaV3({ ...base, observacao: 'Tocar o interfone', itens: [item('Smash', 29, 1, [], 'sem cebola'), item('Coca', 6)] }, { loja })
    const its = blocos(d, 'item')
    expect(its[0].obs).toBe('OBS: sem cebola')
    expect(its[1].obs).toBe('')
    const faixas = blocos(d, 'faixa').map((b) => b.s)
    expect(faixas.indexOf('OBSERVAÇÃO')).toBe(faixas.indexOf('PAGAMENTO') - 1)
    expect(blocos(d, 'obs_geral')[0].s).toBe('Tocar o interfone')
    expect(blocos(montarComandaV3(base, { loja }), 'faixa').map((b) => b.s)).not.toContain('OBSERVAÇÃO')
  })

  it('mesa, balcão e retirada', () => {
    const mesa = montarComandaV3({ ...base, canal: 'mesa', tipo: 'retirada', mesa: '04', formaPagamento: null }, { loja, extras: { comandaNumero: 26, atendente: 'Carlos' } })
    expect(blocos(mesa, 'tipo')[0].s).toBe('MESA 04')
    expect(blocos(mesa, 'faixa').map((b) => b.s)).toContain('MESA')
    expect(blocos(mesa, 'texto')).toHaveLength(0) // mesa acerta no fechamento
    expect(blocos(mesa, 'dado').map((x) => x.rotulo)).toEqual(['Mesa:', 'Comanda:', 'Atendente:', 'Cliente:'])
    const balcao = montarComandaV3({ ...base, canal: 'balcao', tipo: 'retirada', senha: 12 }, { loja })
    expect(blocos(balcao, 'tipo')[0].s).toBe('BALCÃO - SENHA 12')
    const ret = montarComandaV3({ ...base, tipo: 'retirada', taxaEntrega: 0, total: 94.63 }, { loja })
    expect(blocos(ret, 'tipo')[0].s).toBe('RETIRADA')
    expect(blocos(ret, 'dado').map((x) => x.rotulo)).toEqual(['Cliente:', 'Tel.:'])
  })

  it('via da cozinha: sem valores e sem PAGAMENTO; itens com observação', () => {
    const d = montarComandaV3({ ...base, itens: [item('Smash', 29, 1, [{ nome: 'Bacon', preco: 4 }], 'sem cebola')] }, { loja, via: 'cozinha' })
    expect(d.via).toBe('cozinha')
    expect(blocos(d, 'faixa').map((b) => b.s)).not.toContain('PAGAMENTO')
    expect(blocos(d, 'total')).toHaveLength(0)
    expect(blocos(d, 'par')).toHaveLength(0)
    expect(blocos(d, 'item')[0].valor).toBe('')
    expect(blocos(d, 'item')[0].obs).toBe('OBS: sem cebola')
    expect(textoDoV3(d)).not.toMatch(/R\$/)
  })

  it('loja sem logo e endereço no formato novo', () => {
    expect(lojaDoTopo({ nome: 'X', endereco: 'Rua A, 1 - Apto 2 - Centro, Vitória/ES' }).endereco).toEqual(['Rua A, 1', 'Apto 2', 'Centro'])
    expect(lojaDoTopo({ nome: 'X', endereco: 'Vitória/ES', linha1: 'Rua A, 1' }).endereco).toEqual(['Rua A, 1'])
    expect(lojaDoTopo(null, 'Loja').nome).toBe('Loja')
  })
})

describe('v3 — pré-conta', () => {
  const conta = {
    tipo: 'mesa', mesa: '04', comanda_numero: 26, atendente: 'Carlos', cliente_nome: 'Maria', impresso_em: '2026-10-02T00:47:00Z', via: 1,
    itens: [{ quantidade: 2, nome: 'X-Egg Bacon', preco_unitario: 26, complementos: [{ nome: 'Bacon', preco: 4 }] }],
    subtotal: 82.26, taxa: 8.23, taxa_percentual: 10, taxas: [{ nome: 'Couvert', detalhe: '1 x R$ 15,00', valor: 15 }], desconto: 5, taxa_entrega: 0,
    total: 100.49, pago: 50, restante: 50.49,
  }
  it('monta como no modelo', () => {
    const d = montarPreContaV3({ ...conta, loja_dados: loja })
    expect(blocos(d, 'faixa').map((b) => b.s)).toEqual(['PRÉ-CONTA', 'ITENS', 'VALORES', 'MESA'])
    expect(blocos(d, 'par').map((p) => `${p.rotulo} ${p.valor}`)).toEqual([
      'Subtotal R$ 82,26', 'Serviço (10%) R$ 8,23', 'Couvert 1x15,00 R$ 15,00', 'Desconto - R$ 5,00', 'Total da conta R$ 100,49', 'Já pago - R$ 50,00',
    ])
    expect(blocos(d, 'total')[0]).toMatchObject({ rotulo: 'A PAGAR', valor: 'R$ 50,49' })
    expect(blocos(d, 'nota')[0].s).toBe('Conferência de conta - não é documento fiscal')
    expect(blocos(d, 'dado').map((x) => `${x.rotulo} ${(x.partes as string[])[0]}`)).toEqual(['Mesa: 04', 'Comanda: 26', 'Atendente: Carlos', 'Cliente: Maria'])
  })
  it('sem pagamento: TOTAL e sem "Já pago"; balcão', () => {
    const d = montarPreContaV3({ ...conta, pago: 0, restante: 100.49 })
    expect(blocos(d, 'total')[0]).toMatchObject({ rotulo: 'TOTAL', valor: 'R$ 100,49' })
    expect(blocos(d, 'par').map((p) => p.rotulo)).not.toContain('Já pago')
    const b = montarPreContaV3({ ...conta, tipo: 'balcao', senha: 7, mesa: null })
    expect(blocos(b, 'tipo')[0].s).toBe('BALCÃO - SENHA 7')
    expect(blocos(b, 'faixa').map((x) => x.s)).toContain('BALCÃO')
  })
  it('rótulo das taxas', () => {
    expect(rotuloDaTaxa('Couvert', '2 x R$ 15,00')).toBe('Couvert 2x15,00')
    expect(rotuloDaTaxa('Taxa', '5% do subtotal')).toBe('Taxa (5%)')
    expect(rotuloDaTaxa('Rolha', '')).toBe('Rolha')
  })
})

describe('item 59: legenda do QR vinda do servidor (beta.10)', () => {
  const linhas = Array.from({ length: 21 }, () => '1'.repeat(21))
  it('QR da rota: "Entregador: leia no app Menuzia", sem ícone', () => {
    const doc = montarComandaV3(base, { config: {}, lojaNome: 'Loja', loja, qr: { origem: 'rota', url: 'https://app.menuzia.com.br/r/x', linhas, frase: 'Entregador: leia no app Menuzia' } })
    const r = blocos(doc, 'rodape')[0] as { frase: string; qr: { icone: string } }
    expect(r.frase).toBe('Entregador: leia no app Menuzia')
    expect(r.qr.icone).toBe('')
  })
  it('sem frase: comportamento de sempre (cardápio)', () => {
    const doc = montarComandaV3(base, { config: {}, lojaNome: 'Loja', loja, qr: { origem: 'cardapio', url: 'https://app.menuzia.com.br/loja/x', linhas } })
    expect((blocos(doc, 'rodape')[0] as { frase: string }).frase).toBe('Peça de novo pelo nosso cardápio')
  })
  it('via da cozinha continua sem QR', () => {
    const doc = montarComandaV3(base, { config: {}, lojaNome: 'Loja', loja, via: 'cozinha', qr: { origem: 'rota', url: 'x', linhas, frase: 'Entregador: leia no app Menuzia' } })
    expect(blocos(doc, 'rodape').length).toBe(0)
  })
})
