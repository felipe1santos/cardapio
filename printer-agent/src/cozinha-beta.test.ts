import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { snapshotCozinhaTeste } from '../../lib/impressao/recibo-teste'

const require = createRequire(import.meta.url)
type Bloco = { t: string; s?: string; rotulo?: string; valor?: string; qtd?: string; nome?: string; numero?: string; tipo?: string; subs?: string[]; obs?: string; linhas?: { s: string; negrito?: boolean }[]; negrito?: boolean; icone?: string }
type Doc = { versao: number; modelo: string; teste: boolean; blocos: Bloco[] }
const { montarCozinhaBeta } = require('./cozinha-beta.js') as { montarCozinhaBeta: (p: unknown, o?: unknown) => Doc }
const { textoDoDocumento } = require('./pre-conta-beta.js') as { textoDoDocumento: (d: Doc) => string }

const destino = { loja: 'Menuzia', impressora: 'Cozinha', nomeSistema: 'POS-80', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }
const qr = { origem: 'instagram', url: 'https://instagram.com/menuzia', tamanho: 21, linhas: Array(21).fill('1'.repeat(21)) }
const snap = snapshotCozinhaTeste(destino, 'Op', qr, new Date('2026-09-28T01:18:00Z')) as { pedido: Record<string, unknown>; extras: Record<string, unknown> }
const PEDIDO = snap.pedido
const EXTRAS = snap.extras
const doc = (p = PEDIDO, o: Record<string, unknown> = {}) => montarCozinhaBeta(p, { config: {}, lojaNome: 'Menuzia', extras: EXTRAS, qr, ...o })
const tipos = (d: Doc) => d.blocos.map((b) => b.t)
const blocos = (d: Doc, t: string) => d.blocos.filter((b) => b.t === t)
const pedido = (d: Doc) => d.blocos.find((b) => b.t === 'pedido')!

describe('Comanda da cozinha do Beta — modelo docs/referencias/impressao/v2/COMANDA.png', () => {
  it('ordem do modelo: logo, COMANDA COZINHA, Pedido #N | TIPO, horários, ITENS DO PEDIDO, VALORES, TOTAL, DADOS DA ENTREGA, QR, rodapé', () => {
    const d = doc()
    expect(d.versao).toBe(3)
    expect(d.modelo).toBe('cozinha')
    expect(tipos(d)).toEqual([
      'logo', 'titulo', 'pedido', 'horas', 'faixa', 'item', 'item', 'item',
      'faixa', 'par', 'par', 'par', 'par', 'tracejado', 'total',
      'faixa', 'dado', 'dado', 'dado', 'dado', 'qr', 'rodape',
    ])
    expect(blocos(d, 'faixa').map((b) => b.s)).toEqual(['ITENS DO PEDIDO', 'VALORES', 'DADOS DA ENTREGA'])
    expect(d.blocos[1]!.s).toBe('COMANDA COZINHA')
    expect(pedido(d)).toMatchObject({ numero: 'Pedido #129', tipo: 'ENTREGA' })
    expect(blocos(d, 'horas')[0]!.s).toBe('Recebido 22:01  |  Pronto 22:18')
  })

  it('itens SEM preço (para a cozinha ler rápido): quantidade, nome, adicionais e a observação com fundo claro', () => {
    const d = doc()
    expect(blocos(d, 'item').map((b) => [b.qtd, b.nome])).toEqual([['1x', 'BOLO DUPLO'], ['1x', 'COCA-COLA LATA 350ML'], ['2x', 'COXINHA']])
    expect(blocos(d, 'item').every((b) => b.valor === undefined)).toBe(true)
    expect(blocos(d, 'item')[0]).toMatchObject({ subs: ['+ Calda de chocolate', '+ Morango extra'], obs: 'OBS: CORTAR AO MEIO E ENVIAR COLHER' })
    expect(blocos(d, 'item')[2]!.subs).toEqual(['+ Catupiry', '+ Molho especial'])
    // Na parte dos itens, nenhum "R$".
    const t = textoDoDocumento(d)
    expect(t.slice(t.indexOf('ITENS DO PEDIDO'), t.indexOf('VALORES'))).not.toContain('R$')
  })

  it('valores do modelo: subtotal, taxa de entrega, desconto, pagamento e TOTAL', () => {
    const d = doc()
    expect(blocos(d, 'par').map((b) => [b.rotulo, b.valor])).toEqual([['Subtotal', 'R$ 44,40'], ['Taxa de entrega', 'R$ 3,00'], ['Desconto', '- R$ 2,00'], ['Pagamento', 'PIX']])
    expect(blocos(d, 'total')[0]).toMatchObject({ rotulo: 'TOTAL', valor: 'R$ 45,40' })
  })

  it('dados da entrega, QR do Instagram com o ícone e rodapé', () => {
    const d = doc()
    expect(blocos(d, 'dado').map((b) => [b.rotulo, b.valor])).toEqual([
      ['Cliente:', 'teste claude'], ['Telefone:', '552799920804'], ['Endereco:', 'Avenida Henrique Moscoso, 1'], ['Bairro:', 'JABURUNA'],
    ])
    expect(blocos(d, 'qr')[0]).toMatchObject({ icone: 'instagram' })
    expect(blocos(d, 'rodape')[0]!.linhas!.map((l) => l.s)).toEqual(['Siga a gente no Instagram', '@menuzia', 'Feito por Sistema Menúzia'])
    expect(blocos(doc(PEDIDO, { qr: { ...qr, origem: 'cardapio' } }), 'qr')[0]!.icone).toBe('')
    expect(blocos(doc(PEDIDO, { qr: null }), 'qr')).toHaveLength(0)
  })

  it('mesa: MESA ao lado do número, DADOS DA MESA (mesa, comanda, atendente), sem endereço e sem forma de pagamento', () => {
    const d = doc({ ...PEDIDO, canal: 'mesa', tipo: 'retirada', origem: 'pdv', mesa: '07', clienteNome: '', clienteTelefone: '', taxaEntrega: 0 }, { extras: { ...EXTRAS, desconto: 0, comandaNumero: 175, atendente: 'Pedro' } })
    expect(pedido(d).tipo).toBe('MESA 07')
    expect(blocos(d, 'faixa').map((b) => b.s)).toContain('DADOS DA MESA')
    expect(blocos(d, 'dado').map((b) => [b.rotulo, b.valor])).toEqual([['Mesa:', '07'], ['Comanda:', '175'], ['Atendente:', 'Pedro']])
    const t = textoDoDocumento(d)
    for (const x of ['Endereco', 'Bairro', 'Pagamento', 'Taxa de entrega']) expect(t).not.toContain(x)
  })

  it('mesa cadastrada como "Mesa 01" não sai "MESA MESA 01"; "01" ganha o prefixo', () => {
    const tipo = (mesa: string) => pedido(doc({ ...PEDIDO, canal: 'mesa', mesa })).tipo
    expect(tipo('Mesa 01')).toBe('MESA 01')
    expect(blocos(doc({ ...PEDIDO, canal: 'mesa', tipo: 'retirada', mesa: 'Mesa 01' }), 'dado')[0]).toMatchObject({ rotulo: 'Mesa:', valor: '01' })
    expect(tipo('01')).toBe('MESA 01')
    expect(tipo('PRA VIAGEM')).toBe('MESA PRA VIAGEM')
    expect(tipo('Mesanino')).toBe('MESA MESANINO')
  })

  it('balcão: senha ao lado do número; retirada: DADOS DO CLIENTE sem endereço', () => {
    expect(pedido(doc({ ...PEDIDO, canal: 'balcao', tipo: 'retirada', senha: 12, taxaEntrega: 0 })).tipo).toBe('SENHA 12')
    expect(pedido(doc({ ...PEDIDO, canal: 'balcao', tipo: 'retirada', senha: null, taxaEntrega: 0 })).tipo).toBe('BALCAO')
    const r = doc({ ...PEDIDO, tipo: 'retirada', taxaEntrega: 0 })
    expect(pedido(r).tipo).toBe('RETIRADA')
    expect(blocos(r, 'faixa').map((x) => x.s)).toContain('DADOS DO CLIENTE')
    expect(textoDoDocumento(r)).not.toContain('Avenida')
  })

  it('opção da loja: sem nome de adicionais, só o item', () => {
    expect(blocos(doc(PEDIDO, { config: { mostrarNomeComplementos: false } }), 'item')[0]!.subs).toEqual([])
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
    expect(t).toContain('Troco para  R$ 100,00')
    expect(t).toContain('OBS. DO PEDIDO: INTERFONE QUEBRADO')
  })

  it('teste: marcas nas bordas e aviso para não preparar', () => {
    const d = doc(PEDIDO, { teste: true })
    expect(d.teste).toBe(true)
    expect(d.blocos[0]!.t).toBe('marcas')
    expect(d.blocos.at(-1)!.t).toBe('marcas')
    expect(textoDoDocumento(d)).toContain('TESTE DE IMPRESSAO - NAO PREPARAR')
  })
})
