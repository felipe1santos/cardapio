import { describe, expect, it } from 'vitest'
// @ts-expect-error o semver (dependência do electron-updater) não traz tipos
import semver from 'semver'
import {
  montarComandaAlfa1, montarPreContaAlfa1, textoAlfa1, textoPlanoAlfa1, decodificarTexto, htmlAlfa1,
  larguraDoPapel, colunasDoPapel, caminhoDoEnvio, FAIXA_LINHAS,
} from './alfa1.js'
import { imagemEscpos } from './escpos.js'
import { conviteDoNomeArquivo } from './convite.js'

const QR = Array.from({ length: 25 }, (_, y) => Array.from({ length: 25 }, (_, x) => ((x + y) % 2 ? '1' : '0')).join(''))
const itens = [
  { nome: 'X-Tudo', quantidade: 1, precoUnitario: 30, complementos: [{ nome: 'Hambúrguer caseiro', preco: 5 }], observacao: 'Carne artesanal, por favor' },
  { nome: 'Coca-Cola Lata 350 ml', quantidade: 1, precoUnitario: 6, complementos: [], observacao: '' },
]
const entrega = montarComandaAlfa1({
  numero: 10, criadoEm: '2026-10-10T00:40:00Z', tipo: 'entrega', canal: 'delivery', clienteNome: 'Maria Souza', clienteTelefone: '5527992390000',
  enderecoRua: 'Rua Jaburuna', enderecoNumero: '55', enderecoComplemento: 'Apto 202', enderecoBairro: 'Centro', enderecoReferencia: 'Ao lado da farmácia', enderecoCidade: 'Vila Velha/ES',
  itens, subtotal: 36, taxaEntrega: 3.99, total: 39.99, formaPagamento: 'dinheiro', trocoPara: 50, pago: false, agendadoPara: '2026-10-10T01:25:00Z',
}, { loja: { nome: 'Villa Burguer' }, extras: { qtdPedidosCliente: 3 }, qr: { linhas: QR, url: 'https://app.menuzia.com.br/r/AAAA' } })!

describe('Alfa 1: largura real do papel', () => {
  it('a do driver, arredondada para baixo em múltiplo de 8', () => {
    expect(larguraDoPapel({ larguraMm: 80, larguraPontos: 576, pontosImprimiveis: 574 })).toBe(568)
    expect(larguraDoPapel({ larguraMm: 80, larguraPontos: 576, pontosImprimiveis: 576 })).toBe(576)
    expect(larguraDoPapel({ larguraMm: 80, larguraPontos: null, pontosImprimiveis: null })).toBe(576)
    expect(larguraDoPapel({ larguraMm: 58, larguraPontos: null, pontosImprimiveis: 370 })).toBe(368)
    expect(larguraDoPapel({ larguraMm: 80, larguraPontos: 576, pontosImprimiveis: 100 })).toBe(576) // valor absurdo ignorado
  })
  it('colunas do modo texto', () => {
    expect(colunasDoPapel(576)).toBe(48)
    expect(colunasDoPapel(384)).toBe(32)
  })
})

describe('Alfa 1: por onde manda', () => {
  it('direto por padrão, com o Windows só de reserva', () => {
    expect(caminhoDoEnvio({ envio: 'raw_fila' })).toEqual({ via: 'raw_fila', reserva: true })
    expect(caminhoDoEnvio({ envio: 'raw_rede', redeIp: '192.168.0.50' })).toEqual({ via: 'raw_rede', reserva: true })
  })
  it('"driver" (ajuste do suporte) força o Windows; impressora virtual também', () => {
    expect(caminhoDoEnvio({ envio: 'driver' })).toEqual({ via: 'driver', reserva: false })
    expect(caminhoDoEnvio({ envio: 'raw_fila', virtual: true })).toEqual({ via: 'driver', reserva: false })
  })
})

describe('Alfa 1: envio da imagem em faixas', () => {
  it('cada faixa é um GS v 0 de no máximo FAIXA_LINHAS linhas', () => {
    const altura = 300, largura = 568, porLinha = largura / 8
    const bytes = imagemEscpos({ bits: new Uint8Array(porLinha * altura), largura, altura, porLinha }, { linhasPorFaixa: FAIXA_LINHAS })
    const faixas: number[] = []
    for (let i = 0; i < bytes.length - 7; i++) if (bytes[i] === 0x1d && bytes[i + 1] === 0x76 && bytes[i + 2] === 0x30) { faixas.push(bytes[i + 6] | (bytes[i + 7] << 8)); expect(bytes[i + 4] | (bytes[i + 5] << 8)).toBe(porLinha); i += 7 }
    expect(faixas).toEqual([64, 64, 64, 64, 44])
  })
})

describe('Alfa 1: comanda', () => {
  it('dados no layout da referência', () => {
    expect(entrega.numero).toBe('#010')
    expect(entrega.tipo).toBe('DELIVERY')
    expect(entrega.dados.map((d: { rotulo: string }) => d.rotulo)).toEqual(['Cliente', 'Qtd de pedidos', 'Tel', 'Endereço', 'Comp', 'Bairro', 'Ref', 'Cidade'])
    expect(entrega.dados[2].valor).toBe('(27) 99239-0000')
    expect(entrega.dados[7].valor).toBe('Vila Velha')
    expect(entrega.itens[0]).toMatchObject({ q: 1, nome: 'X-Tudo', total: 30, comp: ['1x Hambúrguer caseiro'], obs: 'Carne artesanal, por favor' })
    expect(entrega.pagamento).toMatchObject({ titulo: 'Pagamento na entrega', forma: 'Dinheiro', total: 39.99, recebe: 50, troco: 10.01 })
    expect(entrega.qr?.titulo).toBe('ROTA DE ENTREGA')
  })
  it('retirada e balcão: sem endereço nem QR; tipo certo', () => {
    const base = { numero: 7, criadoEm: '2026-10-10T00:40:00Z', clienteNome: 'Ana', itens, subtotal: 36, total: 36, formaPagamento: 'pix' }
    const ret = montarComandaAlfa1({ ...base, tipo: 'retirada', canal: 'delivery' }, { qr: { linhas: QR } })!
    const bal = montarComandaAlfa1({ ...base, tipo: 'retirada', canal: 'balcao', senha: 12 }, {})!
    expect(ret.tipo).toBe('RETIRADA'); expect(ret.qr).toBeNull(); expect(ret.pagamento?.titulo).toBe('Pagamento')
    expect(bal.tipo).toBe('BALCÃO'); expect(bal.dados.some((d: { rotulo: string }) => d.rotulo === 'Senha')).toBe(true)
  })
  it('aguardando pagamento não imprime', () => {
    expect(montarComandaAlfa1({ status: 'aguardando_pagamento' }, {})).toBeNull()
  })
  it('HTML: faixas pretas, observação com borda e sem QR de cardápio', () => {
    const h = htmlAlfa1(entrega, { larguraPontos: 576 })
    expect(h).toContain('<div class="faixa">Itens do pedido</div>')
    expect(h).toContain('<div class="faixa">Pagamento na entrega</div>')
    expect(h).toContain('<div class="obs">Obs: Carne artesanal, por favor</div>')
    expect(h).toContain('COBRAR DO CLIENTE')
    expect(h).toContain('ROTA DE ENTREGA')
    expect(h).not.toMatch(/card[aá]pio/i)
  })
})

describe('Alfa 1: pré-conta', () => {
  const pc = montarPreContaAlfa1({
    loja_dados: { nome: 'Villa Burguer' }, tipo: 'mesa', mesa: '04', comanda_numero: 123, impresso_em: '2026-10-10T00:40:00Z',
    itens: itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, preco_unitario: i.precoUnitario, complementos: i.complementos })),
    subtotal: 36, taxa: 3.6, taxa_percentual: 10, desconto: 5, total: 34.6, pago: 10, restante: 24.6, pessoas: 2, atendente: 'Carlos',
    qr: { linhas: QR, origem: 'instagram', url: 'https://instagram.com/villaburguer' },
  })
  it('faixa, resumo, a pagar, pessoas e rodapé do Instagram', () => {
    expect(pc.faixa).toBe('Mesa 04 · Conta 0123')
    expect(pc.resumo.map((r: { rotulo: string }) => r.rotulo)).toEqual(['Subtotal', 'Serviço (10%)', 'Desconto', 'Total da conta', 'Já pago'])
    expect(pc.aPagar).toBe(24.6)
    expect(pc.pessoas).toBe('2 pessoas · R$ 12,30 por pessoa')
    expect(pc.servicoOpcional).toBe('Serviço de 10% opcional')
    expect(pc.instagram?.arroba).toBe('@villaburguer')
    expect(pc.cnpj).toBe('') // sem CNPJ cadastrado, não sai
  })
})

describe('Alfa 1: modo texto (mesmo layout, comandos da impressora)', () => {
  for (const col of [48, 32]) {
    it(`${col} colunas: nenhuma linha passa da largura e os acentos saem certos`, () => {
      const t = textoPlanoAlfa1(entrega, col)
      for (const l of t.split('\n')) expect(l.length).toBeLessThanOrEqual(col)
      expect(t).toContain('Endereço: Rua Jaburuna, 55')
      expect(t).toContain('Ref: Ao lado da farmácia')
      expect(t.indexOf('Itens do pedido')).toBeLessThan(t.indexOf('Pagamento na entrega'))
      expect(t).toContain('[QR]')
    })
  }
  it('negrito, letra dupla, faixa invertida, página de código WPC1252 e QR nativo', () => {
    const b = textoAlfa1(entrega, { colunas: 48 })
    const tem = (seq: number[]) => b.indexOf(Buffer.from(seq)) >= 0
    expect(tem([0x1b, 0x74, 16])).toBe(true) // WPC1252
    expect(tem([0x1b, 0x45, 1])).toBe(true) // negrito
    expect(tem([0x1d, 0x21, 0x11])).toBe(true) // letra dupla
    expect(tem([0x1d, 0x42, 1])).toBe(true) // faixa invertida
    expect(tem([0x1d, 0x28, 0x6b])).toBe(true) // QR nativo
    expect(decodificarTexto(Buffer.from([0xe7, 0xe3, 0x6f, 0x20, 0xe9]))).toBe('ção é')
  })
})

describe('Alfa 1: versão e instalador', () => {
  it('1.1.0 é mais nova que o beta.13 para o atualizador (semver)', () => {
    expect(semver.gt('1.1.0', '0.2.0-beta.13')).toBe(true)
    expect(semver.gt('0.2.0-alpha.1', '0.2.0-beta.13')).toBe(false) // por isso não "alpha"
  })
  it('instalador do Alfa 1 com convite no nome', () => {
    const C = 'ABCDEFGHJKMNPQRSTUVWXYZ2'
    expect(conviteDoNomeArquivo(`AssistenteMenuziaAlfa1-Setup-1.1.0-c${C}.exe`)).toBe(C)
  })
})
