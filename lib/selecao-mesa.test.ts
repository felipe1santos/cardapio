import { describe, it, expect } from 'vitest'
import { adicionarNaSelecao, assinaturaDaLinha, SELECAO_QTD_MAX, type LinhaDaSelecao } from './selecao-mesa'

const linha = (over: Partial<LinhaDaSelecao> = {}): LinhaDaSelecao => ({
  chave: 'k1',
  itemId: 'i-coca',
  quantidade: 1,
  observacao: '',
  opcoes: [],
  ...over,
})

describe('adicionarNaSelecao', () => {
  it('item repetido soma na linha que já existe', () => {
    const r = adicionarNaSelecao([linha()], linha({ chave: 'k2' }))
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ chave: 'k1', quantidade: 2 })
  })

  it('soma a quantidade que veio, não de um em um', () => {
    const r = adicionarNaSelecao([linha({ quantidade: 2 })], linha({ chave: 'k2', quantidade: 3 }))
    expect(r[0].quantidade).toBe(5)
  })

  it('item diferente é linha nova', () => {
    const r = adicionarNaSelecao([linha()], linha({ chave: 'k2', itemId: 'i-fanta' }))
    expect(r).toHaveLength(2)
  })

  /** "Sem cebola" é outro prato para a cozinha — não pode virar quantidade 2. */
  it('mesma comida com observação diferente fica separada', () => {
    const r = adicionarNaSelecao([linha()], linha({ chave: 'k2', observacao: 'sem gelo' }))
    expect(r).toHaveLength(2)
  })

  it('a mesma observação escrita diferente ainda junta', () => {
    const r = adicionarNaSelecao([linha({ observacao: 'Sem Gelo' })], linha({ chave: 'k2', observacao: ' sem gelo ' }))
    expect(r).toHaveLength(1)
    expect(r[0].quantidade).toBe(2)
  })

  it('opções diferentes são linhas diferentes', () => {
    const comBacon = linha({ opcoes: [{ grupo: 'Adicionais', escolha: 'Bacon', preco: 4 }] })
    const semNada = linha({ chave: 'k2' })
    expect(adicionarNaSelecao([comBacon], semNada)).toHaveLength(2)
  })

  it('as mesmas opções em outra ordem juntam', () => {
    const a = linha({
      opcoes: [
        { grupo: 'Adicionais', escolha: 'Bacon', preco: 4 },
        { grupo: 'Adicionais', escolha: 'Cheddar', preco: 3 },
      ],
    })
    const b = linha({
      chave: 'k2',
      opcoes: [
        { grupo: 'Adicionais', escolha: 'Cheddar', preco: 3 },
        { grupo: 'Adicionais', escolha: 'Bacon', preco: 4 },
      ],
    })
    const r = adicionarNaSelecao([a], b)
    expect(r).toHaveLength(1)
    expect(r[0].quantidade).toBe(2)
  })

  /** Pizza: o sabor viaja como opção, então meio a meio diferente não junta. */
  it('pizza com sabores diferentes não junta', () => {
    const calabresa = linha({ itemId: 'i-pizza', opcoes: [{ grupo: 'Sabor', escolha: 'Calabresa', preco: 0, tipo: 'sabor' }] })
    const marguerita = linha({ chave: 'k2', itemId: 'i-pizza', opcoes: [{ grupo: 'Sabor', escolha: 'Marguerita', preco: 0, tipo: 'sabor' }] })
    expect(adicionarNaSelecao([calabresa], marguerita)).toHaveLength(2)
  })

  it('junta na linha certa quando há várias', () => {
    const lista = [linha(), linha({ chave: 'k2', itemId: 'i-fanta' }), linha({ chave: 'k3', itemId: 'i-agua' })]
    const r = adicionarNaSelecao(lista, linha({ chave: 'k4', itemId: 'i-fanta' }))
    expect(r.map((l) => l.quantidade)).toEqual([1, 2, 1])
    expect(r.map((l) => l.chave)).toEqual(['k1', 'k2', 'k3'])
  })

  it('não passa do teto da linha', () => {
    const r = adicionarNaSelecao([linha({ quantidade: SELECAO_QTD_MAX })], linha({ chave: 'k2', quantidade: 5 }))
    expect(r[0].quantidade).toBe(SELECAO_QTD_MAX)
  })

  it('preserva a ordem e não mexe nas outras linhas', () => {
    const lista = [linha(), linha({ chave: 'k2', itemId: 'i-fanta' })]
    const r = adicionarNaSelecao(lista, linha({ chave: 'k3' }))
    expect(r[1]).toBe(lista[1])
  })
})

describe('assinaturaDaLinha', () => {
  it('não depende da chave nem da quantidade', () => {
    expect(assinaturaDaLinha(linha({ quantidade: 7 }))).toBe(assinaturaDaLinha(linha({ chave: 'outra' })))
  })
})
