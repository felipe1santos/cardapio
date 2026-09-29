import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { snapshotCozinhaTeste } from '../../lib/impressao/recibo-teste'

const require = createRequire(import.meta.url)
type Sub = { s: string; valor?: string }
type Bloco = { t: string; s?: string; rotulo?: string; valor?: string; texto?: string; numero?: string; tipo?: string; nome?: string; subs?: Sub[]; obs?: string; linhas?: { s: string; negrito?: boolean }[]; negrito?: boolean; icone?: string; esq?: string; dir?: string; loja?: { nome: string; telefone: string; endereco?: string; linha1?: string; cidade?: string }; final?: string; chamada?: string[]; qr?: { linhas: string[]; icone: string } | null }
type Doc = { versao: number; modelo: string; teste: boolean; fonteMaior: boolean; blocos: Bloco[] }
const { montarCozinhaBeta } = require('./cozinha-beta.js') as { montarCozinhaBeta: (p: unknown, o?: unknown) => Doc }
const { textoDoDocumento } = require('./pre-conta-beta.js') as { textoDoDocumento: (d: Doc) => string }

const destino = { loja: 'Menuzia', impressora: 'Cozinha', nomeSistema: 'POS-80', computador: 'PC', larguraMm: 80, larguraPontos: null, deslocamentoPontos: 0 }
const qr = { origem: 'cardapio', url: 'https://app.menuzia.com.br/loja/pizza-do-rosa', tamanho: 21, linhas: Array(21).fill('1'.repeat(21)) }
const snap = snapshotCozinhaTeste(destino, 'Op', qr, new Date('2026-09-28T18:55:00Z')) as { pedido: Record<string, unknown>; extras: Record<string, unknown> }
const PEDIDO = snap.pedido
const EXTRAS = snap.extras
const LOJA = { nome: 'Pizza do Rosa', telefone: '(27) 99999-0000', endereco: 'Av. Nossa Senhora da Penha, 1500 - Cond. Res. Jardim das Orquídeas - Praia do Canto, Vitória/ES', linha1: 'Av. Nossa Senhora da Penha, 1500', cidade: 'Vitória/ES' }
const doc = (p = PEDIDO, o: Record<string, unknown> = {}) => montarCozinhaBeta(p, { config: {}, lojaNome: 'Pizza do Rosa', loja: LOJA, extras: EXTRAS, qr, ...o })
const tipos = (d: Doc) => d.blocos.map((b) => b.t)
const blocos = (d: Doc, t: string) => d.blocos.filter((b) => b.t === t)
const pedido = (d: Doc) => d.blocos.find((b) => b.t === 'pedido')!
const centavos = (s: string) => Math.round(Number(s.replace(/\./g, '').replace(',', '.')) * 100)

describe('Comanda da cozinha do Beta — padrão docs/referencias/impressao/comanda-padrao.png', () => {
  it('ordem do padrão: logo, COMANDA COZINHA, #N com o selo, horários, ITENS DO PEDIDO (ITEM / VALOR), VALORES, TOTAL, DADOS, separador, rodapé da loja com QR', () => {
    const d = doc()
    expect(d.versao).toBe(5)
    expect(d.modelo).toBe('cozinha')
    expect(tipos(d)).toEqual([
      'logo', 'titulo', 'pedido', 'horas', 'faixa', 'itens_cab', 'item', 'item', 'item',
      'faixa', 'par', 'par', 'par', 'par', 'tracejado', 'total',
      'faixa', 'dado', 'dado', 'dado', 'dado', 'dado', 'dado', 'separador', 'rodape_loja',
    ])
    expect(d.blocos[0]).toMatchObject({ t: 'logo', nome: 'PIZZA DO ROSA' })
    expect(d.blocos[1]!.s).toBe('COMANDA COZINHA')
    expect(pedido(d)).toMatchObject({ numero: '#129', tipo: 'ENTREGA' })
    expect(blocos(d, 'horas')[0]!.s).toBe('Recebido 15:38 | Pronto 15:55')
    expect(blocos(d, 'itens_cab')[0]).toMatchObject({ esq: 'ITEM', dir: 'VALOR (R$)' })
  })

  it('cada item com o valor (qtd × preço, sem adicionais) e cada adicional com o dele; a coluna soma o Subtotal', () => {
    const d = doc()
    const itens = blocos(d, 'item')
    expect(itens.map((b) => [b.texto, b.valor])).toEqual([['1x BOLO DUPLO', '18,00'], ['1x COCA-COLA LATA 350ML', '6,00'], ['2x COXINHA', '10,40']])
    expect(itens[0]!.subs).toEqual([{ s: '+ Calda de chocolate', valor: '3,00' }, { s: '+ Morango extra', valor: '4,00' }])
    expect(itens[0]!.obs).toBe('OBS: CORTAR AO MEIO E ENVIAR COLHER')
    expect(itens[2]!.subs).toEqual([{ s: '+ Catupiry', valor: '2,00' }, { s: '+ Molho especial', valor: '1,00' }])
    const soma = itens.reduce((t, b) => t + centavos(b.valor!) + (b.subs ?? []).reduce((u, x) => u + (x.valor ? centavos(x.valor) : 0), 0), 0)
    expect(soma).toBe(4440)
    expect(blocos(d, 'par')[0]).toMatchObject({ rotulo: 'Subtotal', valor: 'R$ 44,40' })
  })

  it('VALORES como eram, com o ícone da forma de pagamento', () => {
    const d = doc()
    expect(blocos(d, 'par').map((b) => [b.rotulo, b.valor])).toEqual([['Subtotal', 'R$ 44,40'], ['Taxa de entrega', 'R$ 3,00'], ['Desconto', '- R$ 2,00'], ['Pagamento', 'PIX']])
    expect(blocos(d, 'par')[3]!.icone).toBe('pix')
    expect(blocos(d, 'total')[0]).toMatchObject({ rotulo: 'TOTAL', valor: 'R$ 45,40' })
    expect(blocos(doc({ ...PEDIDO, formaPagamento: 'cartao' }), 'par')[3]).toMatchObject({ valor: 'CARTAO', icone: 'cartao' })
  })

  it('rodapé em duas colunas: nome, telefone, rua e Cidade/UF da LOJA; QR com a chamada; "Feito por"', () => {
    const r = blocos(doc(), 'rodape_loja')[0]!
    expect(r.loja).toEqual({ nome: 'PIZZA DO ROSA', telefone: '(27) 99999-0000', linha1: 'Av. Nossa Senhora da Penha, 1500', cidade: 'Vitória/ES' })
    expect(r.chamada).toEqual(['PEÇA DE NOVO PELO CARDÁPIO:', 'aponte a câmera para o QR Code'])
    expect(r.qr!.linhas).toHaveLength(21)
    expect(r.final).toBe('Feito por Sistema Menuzia')
    const ig = blocos(doc(PEDIDO, { qr: { ...qr, origem: 'instagram', url: 'https://instagram.com/pizzadorosa' } }), 'rodape_loja')[0]!
    expect(ig.chamada).toEqual(['SIGA A GENTE NO INSTAGRAM:', '@pizzadorosa'])
    expect(ig.qr!.icone).toBe('instagram')
    const semQr = blocos(doc(PEDIDO, { qr: null }), 'rodape_loja')[0]!
    expect(semQr.qr).toBeNull()
    expect(semQr.chamada).toEqual([])
    // O endereço do rodapé é o da loja, nunca o do cliente.
    const txt = textoDoDocumento(doc())
    expect(txt.slice(txt.lastIndexOf('PIZZA DO ROSA'))).not.toContain('Henrique Moscoso')
  })

  it('servidor antigo (só "endereco"): rua e Cidade/UF saem do endereço completo; campo vazio = linha omitida', () => {
    const antigo = blocos(doc(PEDIDO, { loja: { nome: 'Pizza do Rosa', telefone: '', endereco: 'Rua A, 10 - Loja 2 - Centro, Vila Velha/ES' } }), 'rodape_loja')[0]!
    expect(antigo.loja).toEqual({ nome: 'PIZZA DO ROSA', telefone: '', linha1: 'Rua A, 10', cidade: 'Vila Velha/ES' })
    const livre = blocos(doc(PEDIDO, { loja: { nome: 'X', telefone: '', endereco: 'Rua sem cidade' } }), 'rodape_loja')[0]!
    expect(livre.loja).toMatchObject({ linha1: 'Rua sem cidade', cidade: '' })
  })

  it('dados da entrega pensados para o motoboy: cliente, telefone, endereço com complemento, bairro, cidade, referência e troco', () => {
    expect(blocos(doc(), 'dado').map((b) => [b.rotulo, b.valor])).toEqual([
      ['Cliente:', 'TESTE CLAUDE'], ['Telefone:', '(27) 9992-0804'], ['Endereço:', 'Avenida Henrique Moscoso, 1, Apto 1203, bloco B'], ['Bairro:', 'JABURUNA'],
      ['Cidade:', 'Vila Velha/ES'], ['Ref.:', 'Em frente à padaria, portão verde'],
    ])
    const longo = doc({
      ...PEDIDO, formaPagamento: 'dinheiro', trocoPara: 100, enderecoComplemento: 'Apto 1203 bloco B', enderecoCidade: 'Vila Velha/ES',
      enderecoReferencia: 'Em frente à padaria, portão verde',
    })
    const dd = blocos(longo, 'dado')
    expect(dd.map((b) => [b.rotulo, b.valor, !!b.negrito])).toEqual([
      ['Cliente:', 'TESTE CLAUDE', true], ['Telefone:', '(27) 9992-0804', true], ['Endereço:', 'Avenida Henrique Moscoso, 1, Apto 1203 bloco B', false],
      ['Bairro:', 'JABURUNA', true], ['Cidade:', 'Vila Velha/ES', false], ['Ref.:', 'Em frente à padaria, portão verde', false], ['Troco:', 'Troco para R$ 100,00', true],
    ])
    // Troco da entrega é do motoboy: sai nos dados, não em VALORES.
    expect(blocos(longo, 'par').map((b) => b.rotulo)).not.toContain('Troco para')
  })

  it('mesa: MESA no selo, DADOS DA MESA (mesa, comanda, atendente), sem endereço e sem forma de pagamento', () => {
    const d = doc({ ...PEDIDO, canal: 'mesa', tipo: 'retirada', origem: 'pdv', mesa: 'Mesa 07', clienteNome: '', clienteTelefone: '', taxaEntrega: 0 }, { extras: { ...EXTRAS, desconto: 0, comandaNumero: 175, atendente: 'Pedro' } })
    expect(pedido(d).tipo).toBe('MESA 07')
    expect(blocos(d, 'dado').map((b) => [b.rotulo, b.valor])).toEqual([['Mesa:', '07'], ['Comanda:', '175'], ['Atendente:', 'Pedro']])
    const t = textoDoDocumento(d)
    for (const x of ['Endereço', 'Bairro', 'Pagamento', 'Taxa de entrega']) expect(t).not.toContain(x)
  })

  it('retirada: DADOS DA RETIRADA só com cliente e telefone; balcão: senha no selo e DADOS DO CLIENTE', () => {
    expect(pedido(doc({ ...PEDIDO, canal: 'balcao', tipo: 'retirada', senha: 12, taxaEntrega: 0 })).tipo).toBe('SENHA 12')
    const r = doc({ ...PEDIDO, tipo: 'retirada', taxaEntrega: 0 })
    expect(pedido(r).tipo).toBe('RETIRADA')
    expect(blocos(r, 'faixa').map((x) => x.s)).toContain('DADOS DA RETIRADA')
    expect(blocos(r, 'dado').map((b) => b.rotulo)).toEqual(['Cliente:', 'Telefone:'])
    const bal = doc({ ...PEDIDO, canal: 'balcao', tipo: 'retirada', senha: 12, taxaEntrega: 0 })
    expect(blocos(bal, 'faixa').map((x) => x.s)).toContain('DADOS DO CLIENTE')
  })

  it('opções da loja: número do item, nome e preço dos adicionais, multiplicar pela quantidade, fonte maior', () => {
    expect(blocos(doc(PEDIDO, { config: { mostrarNumeroItem: false } }), 'item')[0]!.texto).toBe('BOLO DUPLO')
    // Sem nome dos adicionais: o valor deles vai para a linha do item (a soma continua certa).
    const semNome = blocos(doc(PEDIDO, { config: { mostrarNomeComplementos: false } }), 'item')
    expect(semNome[0]).toMatchObject({ valor: '25,00', subs: [] })
    const semPreco = blocos(doc(PEDIDO, { config: { mostrarPrecoComplementos: false } }), 'item')
    expect(semPreco[0]!.valor).toBe('25,00')
    expect(semPreco[0]!.subs!.every((s) => !s.valor)).toBe(true)
    expect(blocos(doc(PEDIDO, { config: { multiplicarOpcoesQtd: true } }), 'item')[2]!.subs![0]!.s).toBe('+ 2x Catupiry')
    expect(doc(PEDIDO, { config: { fonteMaiorProducao: true } }).fonteMaior).toBe(true)
  })

  it('pizza: tamanho/sabores, borda e massa; dinheiro com troco; observação do pedido', () => {
    const t = textoDoDocumento(doc({
      ...PEDIDO, formaPagamento: 'dinheiro', trocoPara: 100, observacao: 'interfone quebrado',
      itens: [{ nome: 'Pizza', quantidade: 1, precoUnitario: 60, tamanhoNome: 'Grande', saborNome: 'Calabresa / Frango', bordaNome: 'Catupiry', massaNome: 'Fina', observacao: '', complementos: [] }],
    }))
    for (const x of ['1x PIZZA  60,00', 'Grande - Calabresa / Frango', '+ Borda: Catupiry', '+ Massa: Fina', 'Troco: Troco para R$ 100,00', 'OBS. DO PEDIDO: INTERFONE QUEBRADO']) expect(t).toContain(x)
  })

  it('teste: marcas nas bordas e aviso para não preparar', () => {
    const d = doc(PEDIDO, { teste: true })
    expect(d.blocos[0]!.t).toBe('marcas')
    expect(d.blocos.at(-1)!.t).toBe('marcas')
    expect(textoDoDocumento(d)).toContain('TESTE DE IMPRESSÃO - NÃO PREPARAR')
  })
})
