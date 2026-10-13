import { describe, expect, it } from 'vitest'
import {
  interpretarEscolhas, itemListadoPelaIa, mesclarDoIa, novoRascunho, perguntaValor, proximaPergunta, rascunhoParaCarrinho, responderPeloRascunho, valorParcial,
  type Rascunho,
} from './rascunho'
import type { CardapioIa, ItemIa } from './cardapio'

const acai: ItemIa = {
  id: '11111111-1111-1111-1111-111111111111', nome: 'Açaí grandão', descricao: '', categoria: 'Açaí', posicao: 0, preco: 32, precoCheio: null,
  situacao: 'disponivel', tipo: 'simples', tamanhos: [], sabores: [],
  grupos: [
    { nome: 'adicionais', obrigatorio: true, min: 4, max: 10, opcoes: ['banana', 'leite em po', 'leite ninho', 'sucrilhos'].map((nome) => ({ nome, preco: 0, pausado: false })) },
    { nome: 'Frutas', obrigatorio: false, min: 0, max: 3, opcoes: ['banana', 'maca', 'pera', 'uva', 'limao', 'paimito'].map((nome) => ({ nome, preco: 2, pausado: false })) },
  ],
}
const ffd: ItemIa = { ...acai, id: '22222222-2222-2222-2222-222222222222', nome: 'ffd', categoria: 'Lanches', preco: 23, grupos: [] }
const cardapio: CardapioIa = { itens: [acai, ffd], pizza: { tamanhos: [], bordas: [], massas: [] } }
const loja = { aceitaEntrega: true, aceitaRetirada: true, pix: true }
const EM = '2026-10-12T22:00:00.000Z'
const comAcai = (): Rascunho => ({ ...novoRascunho(EM), itens: [{ itemId: acai.id, quantidade: 1, escolhas: {}, respondidos: [] }] })

describe('números colados ou separados viram as opções da lista (bug "1 234" = 3 adicionais)', () => {
  const nomes = ['banana', 'leite em po', 'leite ninho', 'sucrilhos']
  it.each([['1 234'], ['1,2,3,4'], ['1234'], ['1 2 3 4'], ['1, 2, 3 e 4'], ['todos'], ['os 4'], ['quero todos']])('"%s" = as 4', (t) => {
    expect(interpretarEscolhas(t, nomes)).toEqual([0, 1, 2, 3])
  })
  it('nomes (sem acento, plural) e mistura com número', () => {
    expect(interpretarEscolhas('Banana, leite ninho e sucrilhos', nomes)).toEqual([0, 2, 3])
    expect(interpretarEscolhas('1 e sucrilhos', nomes)).toEqual([0, 3])
    expect(interpretarEscolhas('bananas', nomes)).toEqual([0])
  })
  it('"nenhuma" / "nenhum fruta extra..." / "não"', () => {
    for (const t of ['nenhuma', 'Nenhum fruta extra...', 'não', 'nada', 'sem']) expect(interpretarEscolhas(t, nomes), t).toBe('nenhum')
  })
  it('número fora da lista ou texto que não é escolha: não entendeu (vai para a IA)', () => {
    expect(interpretarEscolhas('5', nomes)).toBeNull()
    expect(interpretarEscolhas('fica quanto?', nomes)).toBeNull()
    expect(interpretarEscolhas('quero mudar o pedido', nomes)).toBeNull()
  })
})

describe('uma pergunta por mensagem, na ordem: obrigatórios → extras → entrega → endereço → pagamento → troco', () => {
  it('obrigatórios primeiro, sozinhos, sem número na frente', () => {
    const p = proximaPergunta(comAcai(), cardapio, loja)!
    expect(p.campo).toBe('grupo')
    expect(p.texto).toBe('*Açaí grandão* `R$ 32,00` 🍇\nEscolha 4 opções de adicionais (obrigatório):\n\n🍌 Banana\n🥛 Leite em po\n🥛 Leite ninho\n🥣 Sucrilhos\n\n_Pode responder com os nomes._')
  })
  it('"1 234" aceita os 4, anota e manda os extras em OUTRA mensagem', () => {
    const r = responderPeloRascunho(comAcai(), ['1 234'], cardapio, loja)!
    expect(r.mensagens[0]).toBe('Anotado ✍️:\n*Açaí grandão* com `Banana` `Leite em po` `Leite ninho` `Sucrilhos`')
    expect(r.mensagens[1]).toBe('Quer adicionar frutas? (`+R$ 2,00` cada, até 3)\n\n🍌 Banana\n🍎 Maca\n🍐 Pera\n🍇 Uva\n🍋 Limao\nPaimito\n\n_Se não quiser, é só dizer "nenhuma"._')
    expect(r.completo).toBe(false)
  })
  it('só 3 num grupo de mínimo 4: o servidor recusa e pede o que falta; depois completa', () => {
    const r = responderPeloRascunho(comAcai(), ['1 2 3'], cardapio, loja)!
    expect(r.mensagens).toEqual(['Faltou escolher mais 1 😉\n\n🥣 Sucrilhos'])
    const r2 = responderPeloRascunho(r.rascunho, ['sucrilhos'], cardapio, loja)!
    expect(r2.mensagens[0]).toContain('`Sucrilhos`')
    expect(r2.rascunho.itens[0].respondidos).toEqual(['adicionais'])
  })
  it('acima do máximo: pede de novo', () => {
    const r = responderPeloRascunho({ ...comAcai(), itens: [{ itemId: acai.id, quantidade: 1, escolhas: { adicionais: ['banana', 'leite em po', 'leite ninho', 'sucrilhos'] }, respondidos: ['adicionais'] }] }, ['1 2 3 4'], cardapio, loja)!
    expect(r.mensagens[0]).toBe('Aqui dá para escolher até 3 😉\n\nQuais você quer?')
  })
  it('"nenhuma" nos extras + "fica quanto" (duas mensagens): UMA resposta com anotado, valor parcial e a próxima pergunta', () => {
    const passo1 = responderPeloRascunho(comAcai(), ['1 234'], cardapio, loja)!
    const r = responderPeloRascunho(passo1.rascunho, ['Nenhum fruta extra...', 'Fica quanto'], cardapio, loja)!
    expect(r.mensagens).toEqual(['Anotado ✍️:\n*Açaí grandão* com `Banana` `Leite em po` `Leite ninho` `Sucrilhos`\n\nAté agora fica `R$ 32,00` (sem a taxa de entrega).\n\nAgora, vai ser `Entrega` ou `Retirada no balcão`?'])
  })
  it('só "fica quanto?": valor parcial e repete a pergunta', () => {
    const r = responderPeloRascunho(comAcai(), ['fica quanto?'], cardapio, loja)!
    expect(r.mensagens[0]).toBe('Até agora fica `R$ 32,00` (sem a taxa de entrega).')
    expect(r.mensagens[1]).toContain('Escolha 4 opções de adicionais')
  })
  it('entrega → endereço (IA) ; retirada → pagamento em lista ; dinheiro → troco ; completo', () => {
    const base: Rascunho = { ...comAcai(), itens: [{ itemId: acai.id, quantidade: 1, escolhas: { adicionais: ['banana', 'leite em po', 'leite ninho', 'sucrilhos'] }, respondidos: ['adicionais', 'Frutas'] }] }
    expect(proximaPergunta(base, cardapio, loja)!.texto).toBe('Beleza!\nVai ser `Entrega` ou `Retirada no balcão`?')
    const ent = responderPeloRascunho(base, ['entrega'], cardapio, loja)!
    expect(ent.mensagens).toEqual(['Me passa o endereço de entrega: rua, número e bairro 📍'])
    expect(responderPeloRascunho(ent.rascunho, ['rua das flores 10 centro'], cardapio, loja)).toBeNull()
    const ret = responderPeloRascunho(base, ['vou retirar'], cardapio, loja)!
    expect(ret.mensagens).toEqual(['Como prefere pagar?\n💠 Pix\n💵 Dinheiro\n💳 Cartão na retirada'])
    const din = responderPeloRascunho(ret.rascunho, ['dinheiro'], cardapio, loja)!
    expect(din.mensagens).toEqual(['Precisa de troco para quanto? Se não precisar, é só dizer "sem troco".'])
    const fim = responderPeloRascunho(din.rascunho, ['troco pra 50'], cardapio, loja)!
    expect(fim.completo).toBe(true)
    expect(fim.rascunho.trocoPara).toBe(50)
    const pix = responderPeloRascunho(ret.rascunho, ['pix'], cardapio, loja)!
    expect(pix.completo).toBe(true)
    expect(pix.mensagens).toEqual([])
  })
  it('"prefiro pagar na entrega" não é uma forma clara: vai para a IA', () => {
    const r: Rascunho = { ...comAcai(), tipo: 'retirada', itens: [{ itemId: acai.id, quantidade: 1, escolhas: { adicionais: ['banana', 'leite em po', 'leite ninho', 'sucrilhos'] }, respondidos: ['adicionais', 'Frutas'] }] }
    expect(responderPeloRascunho(r, ['prefiro pagar na entrega'], cardapio, loja)).toBeNull()
  })
})

describe('a IA anota pelo montar_pedido (parcial) e o servidor valida', () => {
  it('item novo sem complementos: entra no rascunho e a próxima pergunta é a dos obrigatórios', () => {
    const m = mesclarDoIa(null, { itens: [{ item_id: acai.id, quantidade: 1 }] }, cardapio, EM)
    expect(m.ok && proximaPergunta(m.rascunho, cardapio, loja)?.campo).toBe('grupo')
  })
  it('complementos que a IA mandou vão para o grupo certo; "banana" repetida vai para o grupo seguinte', () => {
    const m = mesclarDoIa(null, { itens: [{ item_id: acai.id, quantidade: 1, complementos: ['banana', 'leite em pó', 'leite ninho', 'sucrilhos', 'banana'] }] }, cardapio, EM)
    expect(m.ok && m.rascunho.itens[0].escolhas).toEqual({ adicionais: ['banana', 'leite em po', 'leite ninho', 'sucrilhos'], Frutas: ['banana'] })
    expect(m.ok && m.rascunho.itens[0].respondidos).toEqual(['adicionais', 'Frutas'])
  })
  it('a IA manda só a novidade (pagamento): os itens guardados ficam', () => {
    const m = mesclarDoIa(comAcai(), { pagamento: 'cartao' }, cardapio, EM)
    expect(m.ok && m.rascunho.itens).toHaveLength(1)
    expect(m.ok && m.rascunho.pagamento).toBe('cartao')
  })
  it('opção que não existe: erro para a IA (nada inventado)', () => {
    const m = mesclarDoIa(null, { itens: [{ item_id: acai.id, quantidade: 1, complementos: ['nutella'] }] }, cardapio, EM)
    expect(m.ok).toBe(false)
  })
})

describe('valor parcial e carrinho final', () => {
  it('soma item + extras pagos, vezes a quantidade (sem taxa)', () => {
    const r: Rascunho = { ...comAcai(), itens: [{ itemId: acai.id, quantidade: 2, escolhas: { adicionais: ['banana'], Frutas: ['uva'] }, respondidos: [] }, { itemId: ffd.id, quantidade: 1, escolhas: {}, respondidos: [] }] }
    expect(valorParcial(r, cardapio)).toBe(2 * 34 + 23)
  })
  it('perguntaValor', () => {
    for (const t of ['Fica quanto', 'fica quanto?', 'quanto deu?', 'qual o total', 'quanto ficou']) expect(perguntaValor(t), t).toBe(true)
    for (const t of ['quanto custa o açaí duplo?', 'sim']) expect(perguntaValor(t), t).toBe(false)
  })
  it('carrinho com os complementos na ordem dos grupos e o tipo único da loja', () => {
    const r: Rascunho = { ...comAcai(), pagamento: 'pix', itens: [{ itemId: acai.id, quantidade: 1, escolhas: { Frutas: ['uva'], adicionais: ['banana'] }, respondidos: [] }] }
    const c = rascunhoParaCarrinho(r, cardapio, { ...loja, aceitaEntrega: false }, 'Felipe')
    expect(c).toMatchObject({ tipo: 'retirada', pagamento: 'pix', nomeCliente: 'Felipe', itens: [{ itemId: acai.id, quantidade: 1, complementos: ['banana', 'uva'] }] })
  })
})

describe('a IA listou os adicionais ela mesma (teste real 12/10): o servidor assume a pergunta', () => {
  it('reconhece o item cujas opções vieram uma por linha', () => {
    const t = 'Achei o *Acai grandao* por `R$ 32,00`, disponível.\n\nEle é obrigatório escolher de *4 a 10* adicionais:\n🍌 Banana\n🥛 Leite em pó\n🥛 Leite ninho\n🍫 Sucrilhos\n\nQuais adicionais você quer?'
    expect(itemListadoPelaIa(t, cardapio)?.id).toBe(acai.id)
  })
  it('texto sem lista de opções: nada', () => {
    expect(itemListadoPelaIa('O *Açaí grandão* custa `R$ 32,00`. Quer pedir?', cardapio)).toBeNull()
  })
})
