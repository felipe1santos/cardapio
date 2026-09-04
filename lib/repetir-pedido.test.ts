import { describe, it, expect } from 'vitest'
import { avisoRepeticao, montarRepeticaoPedido } from './repetir-pedido'
import type { ItemCardapio } from '@/lib/queries/cardapio'
import type { PedidoCliente } from '@/lib/queries/pedidos'

function item(over: Partial<ItemCardapio> = {}): ItemCardapio {
  return {
    id: 'i1',
    grupoId: 'g1',
    nome: 'X Burger',
    descricao: '',
    preco: 20,
    imagemUrl: 'https://exemplo/x.png',
    imagemThumbUrl: null,
    status: 'disponivel',
    diasDisponiveis: [0, 1, 2, 3, 4, 5, 6],
    promocaoPreco: null,
    maisVendido: false,
    tag: null,
    tipoItem: 'simples',
    grupos: [],
    complementos: [],
    tamanhos: [],
    sabores: [],
    ...over,
  }
}

function pedido(itens: Partial<PedidoCliente['itens'][number]>[]): PedidoCliente {
  return {
    id: 'p1',
    numero: 10,
    status: 'entregue',
    tipo: 'entrega',
    subtotal: 0,
    desconto: 0,
    total: 0,
    taxaEntrega: 0,
    formaPagamento: 'pix',
    observacao: '',
    criadoEm: '2026-09-01T12:00:00Z',
    itens: itens.map((i) => ({
      nome: 'X Burger',
      quantidade: 1,
      tamanhoNome: '',
      saborNome: '',
      precoUnitario: 20,
      descricao: '',
      complementos: [],
      observacao: '',
      ...i,
    })),
  }
}

describe('montarRepeticaoPedido', () => {
  it('remonta a linha com o preço de hoje, não o do pedido antigo', () => {
    const r = montarRepeticaoPedido(pedido([{ quantidade: 2, precoUnitario: 20 }]), [item({ preco: 26 })])
    expect(r.linhas).toHaveLength(1)
    expect(r.linhas[0]).toMatchObject({ itemId: 'i1', name: 'X Burger', qty: 2, unit: 26 })
    expect(r.indisponiveis).toEqual([])
  })

  it('usa o preço promocional quando o item está em promoção', () => {
    const r = montarRepeticaoPedido(pedido([{}]), [item({ preco: 30, promocaoPreco: 19.9 })])
    expect(r.linhas[0].unit).toBe(19.9)
  })

  it('casa o nome ignorando acento e caixa', () => {
    const r = montarRepeticaoPedido(pedido([{ nome: 'açaí GRANDE' }]), [item({ nome: 'Açai Grande' })])
    expect(r.linhas).toHaveLength(1)
    expect(r.linhas[0].name).toBe('Açai Grande')
  })

  it('deixa de fora item que saiu do cardápio ou está pausado', () => {
    const semItem = montarRepeticaoPedido(pedido([{ nome: 'Sumiu' }]), [item()])
    expect(semItem.linhas).toEqual([])
    expect(semItem.indisponiveis).toEqual(['Sumiu'])

    const pausado = montarRepeticaoPedido(pedido([{}]), [item({ status: 'pausado' })])
    expect(pausado.linhas).toEqual([])
    expect(pausado.indisponiveis).toEqual(['X Burger'])
  })

  it('soma os adicionais que ainda existem e sinaliza os que sumiram', () => {
    const comAdicional = item({
      grupos: [
        {
          id: 'g',
          nome: 'Adicionais',
          obrigatorio: false,
          minEscolhas: 0,
          maxEscolhas: 0,
          permiteQuantidade: false,
          posicao: 0,
          complementos: [
            { id: 'c1', nome: 'Bacon', preco: 5, presetOrigemId: null, imagemUrl: null, pausado: false },
            { id: 'c2', nome: 'Ovo', preco: 3, presetOrigemId: null, imagemUrl: null, pausado: true },
          ],
        },
      ],
    } as Partial<ItemCardapio>)

    const r = montarRepeticaoPedido(pedido([{ complementos: ['Bacon', 'Ovo', 'Cheddar'] }]), [comAdicional])
    expect(r.linhas[0].addons).toEqual([{ nome: 'Bacon', preco: 5 }])
    expect(r.linhas[0].unit).toBe(25)
    expect(r.semAlgunsAdicionais).toEqual(['X Burger'])
  })

  it('respeita o tamanho escolhido quando ele ainda existe', () => {
    const comTamanhos = item({
      tamanhos: [
        { id: 't1', nome: 'Pequeno', preco: 15 },
        { id: 't2', nome: 'Grande', preco: 25 },
      ],
    } as Partial<ItemCardapio>)

    const r = montarRepeticaoPedido(pedido([{ tamanhoNome: 'Grande' }]), [comTamanhos])
    expect(r.linhas[0].unit).toBe(25)
    expect(r.linhas[0].tamanhoNome).toBe('Grande')

    // Tamanho que não existe mais volta no preço base, sem tamanho.
    const semTamanho = montarRepeticaoPedido(pedido([{ tamanhoNome: 'Família' }]), [comTamanhos])
    expect(semTamanho.linhas[0].tamanhoNome).toBe('')
    expect(semTamanho.linhas[0].unit).toBe(20)
  })

  it('manda pizza para montagem em vez de adivinhar o preço', () => {
    const r = montarRepeticaoPedido(pedido([{ nome: 'Pizza Calabresa' }]), [item({ nome: 'Pizza Calabresa', tipoItem: 'pizza' })])
    expect(r.linhas).toEqual([])
    expect(r.precisamMontagem).toEqual(['Pizza Calabresa'])
  })

  it('dá chave única para o mesmo item repetido no pedido', () => {
    const r = montarRepeticaoPedido(pedido([{}, {}]), [item()])
    expect(r.linhas).toHaveLength(2)
    expect(r.linhas[0].key).not.toBe(r.linhas[1].key)
  })

  it('mantém a observação da linha', () => {
    const r = montarRepeticaoPedido(pedido([{ observacao: 'sem cebola' }]), [item()])
    expect(r.linhas[0].obs).toBe('sem cebola')
  })
})

describe('avisoRepeticao', () => {
  const vazio = { linhas: [], indisponiveis: [], semAlgunsAdicionais: [], precisamMontagem: [] }

  it('não avisa nada quando tudo voltou', () => {
    expect(avisoRepeticao(vazio)).toBeNull()
  })

  it('avisa item fora do cardápio no singular e no plural', () => {
    expect(avisoRepeticao({ ...vazio, indisponiveis: ['A'] })).toBe('Um item saiu do cardápio.')
    expect(avisoRepeticao({ ...vazio, indisponiveis: ['A', 'B'] })).toBe('2 itens saíram do cardápio.')
  })

  it('junta os motivos numa frase só', () => {
    const texto = avisoRepeticao({ ...vazio, indisponiveis: ['A'], precisamMontagem: ['Pizza'], semAlgunsAdicionais: ['B'] })
    expect(texto).toBe('Um item saiu do cardápio, uma pizza precisa ser montada de novo e alguns adicionais mudaram.')
  })
})
