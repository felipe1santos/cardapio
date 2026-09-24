import { describe, it, expect } from 'vitest'
import { avisoDoItem, erroDoItem, statusAoCriarItem, ERRO_PRECO_ZERO, ERRO_PROMOCAO_SEM_DESCONTO, type ItemParaValidar } from './item-cadastro'

const item = (over: Partial<ItemParaValidar> = {}): ItemParaValidar => ({
  preco: 25,
  promocaoPreco: null,
  tipoItem: 'simples',
  qtdTamanhos: 0,
  status: 'disponivel',
  ...over,
})

describe('erroDoItem', () => {
  it('item normal passa', () => {
    expect(erroDoItem(item())).toBeNull()
    expect(erroDoItem(item({ promocaoPreco: 19.9 }))).toBeNull()
  })

  /** O caso real: item "ffd", preço 23 e promoção 23. */
  it('promoção que não desconta é barrada', () => {
    expect(erroDoItem(item({ preco: 23, promocaoPreco: 23 }))).toBe(ERRO_PROMOCAO_SEM_DESCONTO)
    expect(erroDoItem(item({ preco: 23, promocaoPreco: 30 }))).toBe(ERRO_PROMOCAO_SEM_DESCONTO)
  })

  /** O caso real: ESFIHA DE OVOMALTINE a R$ 0,00, disponível na vitrine. */
  it('item simples a R$ 0 e disponível é barrado', () => {
    expect(erroDoItem(item({ preco: 0 }))).toBe(ERRO_PRECO_ZERO)
  })

  it('preço 0 é legítimo quando o preço vem do tamanho', () => {
    expect(erroDoItem(item({ preco: 0, tipoItem: 'pizza' }))).toBeNull()
    expect(erroDoItem(item({ preco: 0, qtdTamanhos: 3 }))).toBeNull()
  })

  /** Item pausado/esgotado não chega ao cliente: cadastro pela metade pode esperar. */
  it('preço 0 não trava item que não está disponível', () => {
    expect(erroDoItem(item({ preco: 0, status: 'pausado' }))).toBeNull()
    expect(erroDoItem(item({ preco: 0, status: 'esgotado' }))).toBeNull()
  })
})

describe('avisoDoItem', () => {
  it('avisa sobre o que já está cadastrado errado', () => {
    expect(avisoDoItem(item({ preco: 0 }))).toMatch(/de graça/)
    expect(avisoDoItem(item({ preco: 23, promocaoPreco: 23 }))).toMatch(/não está descontando/)
    expect(avisoDoItem(item())).toBeNull()
  })
})

describe('tamanhos sem preço', () => {
  it('marmita só com tamanhos a R$ 0 não conta como precificada', () => {
    // qtdTamanhos = tamanhos com preço; os importados a zero ficam em qtdTamanhosSemPreco.
    expect(erroDoItem(item({ preco: 0, tipoItem: 'marmita', qtdTamanhos: 0, qtdTamanhosSemPreco: 3 }))).toBe(ERRO_PRECO_ZERO)
  })

  it('avisa quando algum tamanho de item disponível está a zero', () => {
    expect(avisoDoItem(item({ preco: 0, tipoItem: 'marmita', qtdTamanhos: 2, qtdTamanhosSemPreco: 1 }))).toMatch(/tamanho a R\$ 0,00/)
    expect(avisoDoItem(item({ preco: 0, tipoItem: 'marmita', qtdTamanhos: 2, qtdTamanhosSemPreco: 1, status: 'pausado' }))).toBeNull()
  })
})

describe('statusAoCriarItem', () => {
  it('marmita/açaí novo sem preço nasce pausado em vez de travar o cadastro', () => {
    expect(statusAoCriarItem({ ...item({ preco: 0, tipoItem: 'marmita' }), cobraPorTamanho: true })).toEqual({ status: 'pausado', pausadoAteTerPreco: true })
    expect(statusAoCriarItem({ ...item({ preco: 0 }), cobraPorTamanho: true })).toEqual({ status: 'pausado', pausadoAteTerPreco: true })
  })

  it('não mexe em item simples, pizza, item com preço ou já pausado', () => {
    expect(statusAoCriarItem({ ...item({ preco: 0 }), cobraPorTamanho: false }).pausadoAteTerPreco).toBe(false)
    expect(statusAoCriarItem({ ...item({ preco: 0, tipoItem: 'pizza' }), cobraPorTamanho: true }).status).toBe('disponivel')
    expect(statusAoCriarItem({ ...item({ preco: 12, tipoItem: 'marmita' }), cobraPorTamanho: true }).status).toBe('disponivel')
    expect(statusAoCriarItem({ ...item({ preco: 0, tipoItem: 'marmita', status: 'esgotado' }), cobraPorTamanho: true }).status).toBe('esgotado')
  })
})
