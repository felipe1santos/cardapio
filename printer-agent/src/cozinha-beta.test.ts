import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { snapshotCozinhaTeste } from '../../lib/impressao/recibo-teste'

const require = createRequire(import.meta.url)
type Bloco = { t: string; s?: string; rotulo?: string; valor?: string; qtd?: string; nome?: string; esq?: string; dir?: string; direita?: string; linhas?: unknown; obs?: string; negrito?: boolean; icone?: string }
type Doc = { versao: number; modelo: string; teste: boolean; blocos: Bloco[] }
const { montarCozinhaBeta } = require('./cozinha-beta.js') as { montarCozinhaBeta: (p: unknown, o?: unknown) => Doc }
const { textoDoDocumento } = require('./pre-conta-beta.js') as { textoDoDocumento: (d: Doc) => string }

const destino = { loja: 'Menuzia', impressora: 'Cozinha', nomeSistema: 'POS-80', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }
const qr = { origem: 'instagram', url: 'https://instagram.com/menuzia', tamanho: 21, linhas: Array(21).fill('1'.repeat(21)) }
const snap = snapshotCozinhaTeste(destino, 'Op', qr, new Date('2026-09-28T01:18:00Z')) as { pedido: Record<string, unknown>; extras: Record<string, unknown> }
const PEDIDO = snap.pedido
const EXTRAS = snap.extras
const cfg = { mostrarNomeComplementos: true, mostrarPrecoComplementos: true }
const doc = (p = PEDIDO, o: Record<string, unknown> = {}) => montarCozinhaBeta(p, { config: cfg, lojaNome: 'Menuzia', extras: EXTRAS, qr, ...o })
const tipos = (d: Doc) => d.blocos.map((b) => b.t)
const blocos = (d: Doc, t: string) => d.blocos.filter((b) => b.t === t)

describe('Comanda da cozinha do Beta — modelo oficial (mockup-comanda-cozinha-termica-menuzia)', () => {
  it('ordem do modelo: topo, faixa #número COMANDA, ITENS DO PEDIDO, VALORES, faixa TOTAL, DADOS DA ENTREGA, QR, Feito por Menúzia', () => {
    const d = doc()
    expect(d.versao).toBe(2)
    expect(d.modelo).toBe('cozinha')
    expect(tipos(d)).toEqual([
      'topo', 'faixa_num', 'secao',
      'item_bola', 'detalhes', 'item_bola', 'detalhes', 'item_bola', 'detalhes',
      'secao', 'par', 'par', 'par', 'rotulo_valor', 'faixa_total', 'regua',
      'secao', 'dado', 'dado', 'dado', 'dado', 'qr', 'rodape', 'corte',
    ])
    expect(blocos(d, 'secao').map((b) => b.s)).toEqual(['ITENS DO PEDIDO', 'VALORES', 'DADOS DA ENTREGA'])
    expect(d.blocos[1]).toMatchObject({ esq: '#129', dir: 'COMANDA' })
    expect(d.blocos[0]).toMatchObject({ direita: 'ENTREGA', linhas: [['Recebido', '22:01'], ['Pronto', '22:18']] })
    expect(blocos(d, 'rodape')[0]!.s).toBe('Feito por Menúzia')
  })

  it('valores do modelo: itens sem os adicionais, adicionais com o preço deles, soma = subtotal', () => {
    const d = doc()
    expect(blocos(d, 'item_bola').map((b) => [b.qtd, b.nome, b.valor])).toEqual([
      ['1x', 'BOLO DUPLO', 'R$ 14,90'], ['1x', 'COCA-COLA LATA 350ML', 'R$ 5,00'], ['2x', 'COXINHA', 'R$ 14,00'],
    ])
    const det = blocos(d, 'detalhes') as unknown as { linhas: { s: string; valor: string }[]; obs: string }[]
    expect(det[0]!.linhas).toEqual([{ s: '+ Calda de chocolate', valor: 'R$ 2,00' }, { s: '+ Morango extra', valor: 'R$ 3,00' }])
    expect(det[0]!.obs).toBe('[OBS.: CORTAR AO MEIO E ENVIAR COLHER]')
    expect(det[2]!.linhas).toEqual([{ s: '+ Catupiry', valor: 'R$ 4,00' }, { s: '+ Molho especial', valor: 'R$ 1,50' }])
    expect(blocos(d, 'par').map((b) => [b.rotulo, b.valor])).toEqual([['Subtotal', 'R$ 44,40'], ['Taxa de entrega', 'R$ 3,00'], ['Desconto', '- R$ 2,00']])
    expect(blocos(d, 'rotulo_valor')[0]).toMatchObject({ rotulo: 'Pagamento:', valor: 'PIX' })
    expect(blocos(d, 'faixa_total')[0]!.valor).toBe('R$ 45,40')
    const soma = (14.9 + 2 + 3) + 5 + (14 + 4 + 1.5)
    expect(Math.round(soma * 100) / 100).toBe(44.4)
  })

  it('dados da entrega e QR do Instagram com o ícone', () => {
    const d = doc()
    expect(blocos(d, 'dado').map((b) => [b.rotulo, b.valor])).toEqual([
      ['Cliente:', 'teste claude'], ['Telefone:', '552799920804'], ['Endereco:', 'Avenida Henrique Moscoso, 1'], ['Bairro:', 'JABURUNA'],
    ])
    expect(blocos(d, 'qr')[0]).toMatchObject({ icone: 'instagram' })
    expect(blocos(doc(PEDIDO, { qr: { ...qr, origem: 'cardapio' } }), 'qr')[0]!.icone).toBe('')
    expect(blocos(doc(PEDIDO, { qr: null }), 'qr')).toHaveLength(0)
  })

  it('mesa: MESA no topo, DADOS DA MESA (mesa, comanda, atendente), sem endereço e sem forma de pagamento', () => {
    const d = doc({ ...PEDIDO, canal: 'mesa', tipo: 'retirada', origem: 'pdv', mesa: '07', clienteNome: '', clienteTelefone: '', taxaEntrega: 0 }, { extras: { ...EXTRAS, desconto: 0, comandaNumero: 175, atendente: 'Pedro' } })
    expect(d.blocos[0]!.direita).toBe('MESA 07')
    expect(blocos(d, 'secao').map((b) => b.s)).toContain('DADOS DA MESA')
    expect(blocos(d, 'dado').map((b) => [b.rotulo, b.valor])).toEqual([['Mesa:', '07'], ['Comanda:', '175'], ['Atendente:', 'Pedro']])
    const t = textoDoDocumento(d)
    for (const x of ['Endereco', 'Bairro', 'Pagamento:', 'Taxa de entrega']) expect(t).not.toContain(x)
  })

  it('mesa cadastrada como "Mesa 01" não sai "MESA MESA 01"; "01" ganha o prefixo', () => {
    const topo = (mesa: string) => doc({ ...PEDIDO, canal: 'mesa', mesa }).blocos[0]!.direita
    expect(topo('Mesa 01')).toBe('MESA 01')
    expect(topo('01')).toBe('MESA 01')
    expect(topo('PRA VIAGEM')).toBe('MESA PRA VIAGEM')
    expect(topo('Mesanino')).toBe('MESA MESANINO')
  })

  it('balcão: senha na faixa; retirada: DADOS DO CLIENTE sem endereço', () => {
    const b = doc({ ...PEDIDO, canal: 'balcao', tipo: 'retirada', senha: 12, taxaEntrega: 0 })
    expect(b.blocos[1]).toMatchObject({ esq: '#129', dir: 'SENHA 12' })
    expect(b.blocos[0]!.direita).toBe('BALCAO')
    const r = doc({ ...PEDIDO, tipo: 'retirada', taxaEntrega: 0 })
    expect(r.blocos[0]!.direita).toBe('RETIRADA')
    expect(blocos(r, 'secao').map((x) => x.s)).toContain('DADOS DO CLIENTE')
    expect(textoDoDocumento(r)).not.toContain('Avenida')
  })

  it('opções da loja: sem nome de adicionais o preço fica na linha do item; sem preço de adicionais, só o nome', () => {
    const semNome = doc(PEDIDO, { config: { mostrarNomeComplementos: false } })
    expect(blocos(semNome, 'item_bola')[0]!.valor).toBe('R$ 19,90')
    const semPreco = doc(PEDIDO, { config: { mostrarPrecoComplementos: false } })
    expect((blocos(semPreco, 'detalhes')[0] as unknown as { linhas: { valor: string }[] }).linhas.every((l) => l.valor === '')).toBe(true)
  })

  it('pizza: tamanho/sabores, borda e massa embaixo do item; dinheiro com troco; observação do pedido', () => {
    const d = doc({
      ...PEDIDO, formaPagamento: 'dinheiro', trocoPara: 100, observacao: 'interfone quebrado',
      itens: [{ nome: 'Pizza', quantidade: 1, precoUnitario: 60, tamanhoNome: 'Grande', saborNome: 'Calabresa / Frango', bordaNome: 'Catupiry', massaNome: 'Fina', observacao: '', complementos: [] }],
    })
    const t = textoDoDocumento(d)
    expect(t).toContain('Grande - Calabresa / Frango')
    expect(t).toContain('+ Borda: Catupiry')
    expect(t).toContain('+ Massa: Fina')
    expect(t).toContain('Troco para: R$ 100,00')
    expect(t).toContain('[OBS. DO PEDIDO: INTERFONE QUEBRADO]')
  })

  it('teste: marcas nas bordas e aviso para não preparar', () => {
    const d = doc(PEDIDO, { teste: true })
    expect(d.teste).toBe(true)
    expect(d.blocos[0]!.t).toBe('marcas')
    expect(textoDoDocumento(d)).toContain('TESTE DE IMPRESSAO - NAO PREPARAR')
  })
})
