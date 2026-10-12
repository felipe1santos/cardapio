import { describe, expect, it } from 'vitest'
import { categoriasDoCardapio, escolherOpcao, itemEscolhidoNaLista, linkJaEnviado, pedeOpcoes, previaDoLink, respondeuSimAoPedido, textoCategorias, textoItensDaCategoria } from './categorias'
import type { ItemIa } from '@/lib/agente-ia/cardapio'

const item = (id: string, nome: string, categoria: string, preco: number, situacao = 'disponivel'): ItemIa =>
  ({ id, nome, descricao: '', categoria, posicao: 0, preco, precoCheio: null, situacao, tipo: 'simples', grupos: [], tamanhos: [], sabores: [] })
const cardapio = [
  item('1', 'X-Bacon', 'Lanches', 30), item('2', 'X-Salada', 'Lanches', 25), item('3', 'X-Velho', 'Lanches', 20, 'pausado'),
  item('4', 'Coca lata', 'Bebidas', 6), item('5', 'Suco', 'Bebidas', 8, 'esgotado'),
  item('6', 'Pudim', 'Sobremesas', 9, 'esgotado'),
]

describe('cliente não sabe o que quer → o ROBÔ (sem IA) mostra categorias', () => {
  it('reconhece "o que tem?", "não sei", "me mostra as opções"', () => {
    for (const t of ['o que tem?', 'nao sei', 'Não sei, o que tem?', 'me mostra as opções', 'quais as opcoes', 'o que voces tem']) expect(pedeOpcoes(t), t).toBe(true)
    for (const t of ['oi', 'quero um x-bacon', 'qual a taxa', 'sim']) expect(pedeOpcoes(t), t).toBe(false)
  })
  it('só categorias com item disponível, na ordem do cardápio (nada inventado)', () => {
    const cats = categoriasDoCardapio(cardapio)
    expect(cats.map((c) => c.nome)).toEqual(['Lanches', 'Bebidas'])
    expect(cats[0].itens.map((i) => i.nome)).toEqual(['X-Bacon', 'X-Salada'])
  })
  it('lista numerada, uma por linha', () => {
    expect(textoCategorias(categoriasDoCardapio(cardapio))).toBe('Temos estas opções 👇\n1. Lanches\n2. Bebidas\nResponda o número ou o nome.')
  })
  it('escolhe pelo número ou pelo nome', () => {
    const nomes = ['Lanches', 'Bebidas']
    expect(escolherOpcao('2', nomes)).toBe(1)
    expect(escolherOpcao('bebidas', nomes)).toBe(1)
    expect(escolherOpcao('quero ver os lanches', nomes)).toBe(0)
    expect(escolherOpcao('9', nomes)).toBeNull()
    expect(escolherOpcao('pizza', nomes)).toBeNull()
  })
  it('itens da categoria: nome + preço, disponíveis, no máximo 15 e o resto no link', () => {
    const muitos = Array.from({ length: 18 }, (_, i) => item(`b${i}`, `Bebida ${i + 1}`, 'Bebidas', 5))
    const cat = categoriasDoCardapio(muitos)[0]
    const t = textoItensDaCategoria(cat, 'https://x/loja/y', true)
    expect(t.split('\n').filter((l) => /^\d+\. /.test(l))).toHaveLength(15)
    expect(t).toContain('1. *Bebida 1* `R$ 5,00`')
    expect(t).toContain('+3 no cardápio completo: https://x/loja/y')
    expect(t).toMatch(/Qual você quer\? Responda o número ou o nome\.$/)
  })
  it('sem a IA, depois dos itens o pedido é pelo link', () => {
    const t = textoItensDaCategoria(categoriasDoCardapio(cardapio)[1], 'https://x/loja/y', false)
    expect(t).toContain('1. 🥤 *Coca lata* `R$ 6,00`')
    expect(t).toMatch(/link abaixo 👇\nhttps:\/\/x\/loja\/y$/)
  })
})

describe('"sim" ao "Quer fazer um pedido?" → link do cardápio (robô, sem IA)', () => {
  it('só quando a última mensagem da loja perguntou e o cliente disse sim/quero', () => {
    expect(respondeuSimAoPedido('sim', 'A taxa é R$ 3,00. Quer fazer um pedido?')).toBe(true)
    expect(respondeuSimAoPedido('Sim, quero pedir', 'Quer fazer o seu pedido?')).toBe(true)
    expect(respondeuSimAoPedido('sim', 'Está tudo certo? Responda *sim* para confirmar o pedido.')).toBe(false)
    expect(respondeuSimAoPedido('quero um x-bacon', 'Quer fazer um pedido?')).toBe(false)
  })
})

describe('número da lista de itens → nome do item para a IA (teste real 12/10: "3" virou "Item 3")', () => {
  const cats = categoriasDoCardapio([item('a', 'Item 3', 'Gourmet', 1), item('b', 'Item 5', 'Gourmet', 22), item('c', 'Item 4', 'Gourmet', 12)])
  it('o número é a posição na lista, não o número do nome', () => {
    expect(itemEscolhidoNaLista('3', cats, 0)).toBe('Quero o *Item 4* (opção 3 da lista)')
    expect(itemEscolhidoNaLista('item 5', cats, 0)).toBe('Quero o *Item 5* (opção 2 da lista)')
  })
  it('não achou na lista ou categoria sumiu: a IA recebe o texto como veio', () => {
    expect(itemEscolhidoNaLista('9', cats, 0)).toBeNull()
    expect(itemEscolhidoNaLista('3', cats, 5)).toBeNull()
  })
})

describe('"quero pedir por aqui" logo depois do link → IA (teste real 12/10)', () => {
  const agora = Date.parse('2026-10-12T21:00:00Z')
  const loja = (texto: string, criadoEm: string) => ({ direcao: 'loja' as const, texto, criadoEm })
  it('a última mensagem da loja foi o link do cardápio há menos de 15 min: já mandou o link', () => {
    expect(linkJaEnviado([loja('Nosso pedido é feito *online* 👇\nhttps://app.menuzia.com.br/loja/x', '2026-10-12T20:58:00Z')], agora)).toBe(true)
  })
  it('link antigo, ou a última da loja foi outra coisa: não', () => {
    expect(linkJaEnviado([loja('https://app.menuzia.com.br/loja/x', '2026-10-12T20:30:00Z')], agora)).toBe(false)
    expect(linkJaEnviado([loja('https://app.menuzia.com.br/loja/x', '2026-10-12T20:58:00Z'), loja('A taxa é R$ 3,00', '2026-10-12T20:59:00Z')], agora)).toBe(false)
    expect(linkJaEnviado([], agora)).toBe(false)
  })
})

describe('prévia do link (imagem) no máximo 1 vez a cada 30 min na conversa', () => {
  const agora = Date.parse('2026-10-12T21:00:00Z')
  it('com link e sem outro recente: mostra; repetido em menos de 30 min: não; sem link: nada a decidir', () => {
    expect(previaDoLink('Veja: https://app.menuzia.com.br/loja/x', null, agora)).toBe(true)
    expect(previaDoLink('Veja: https://app.menuzia.com.br/loja/x', '2026-10-12T20:40:00Z', agora)).toBe(false)
    expect(previaDoLink('Veja: https://app.menuzia.com.br/loja/x', '2026-10-12T20:20:00Z', agora)).toBe(true)
  })
})
