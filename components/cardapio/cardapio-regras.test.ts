import { describe, expect, it } from 'vitest'
import { nomeImportadoMarmita, tamanhosFaltandoNoItem } from './tamanhos-do-item'
import { lerPreco } from './ui'
import { abaDaUrl } from './abas-cardapio'

const loja = [
  { id: 'p', nome: 'Pequena', peso: '500 g', posicao: 0 },
  { id: 'g', nome: 'Grande', peso: '700 g', posicao: 1 },
  { id: 'x', nome: 'Executiva', peso: '', posicao: 2 },
]

describe('importar tamanhos da loja na marmita', () => {
  it('nome importado leva o peso entre parênteses', () => {
    expect(nomeImportadoMarmita(loja[0])).toBe('Pequena (500 g)')
    expect(nomeImportadoMarmita(loja[2])).toBe('Executiva')
  })

  it('importar de novo não duplica (antes criava "Pequena (500 g)" outra vez)', () => {
    expect(tamanhosFaltandoNoItem(loja, [{ nome: 'Pequena (500 g)' }, { nome: 'Grande (700 g)' }, { nome: 'Executiva' }])).toEqual([])
  })

  it('reconhece o tamanho digitado à mão com o nome puro, sem diferenciar caixa', () => {
    expect(tamanhosFaltandoNoItem(loja, [{ nome: ' pequena ' }]).map((t) => t.id)).toEqual(['g', 'x'])
  })
})

describe('lerPreco', () => {
  it('aceita vírgula, ponto e milhar', () => {
    expect(lerPreco('45,90')).toBe(45.9)
    expect(lerPreco('45.90')).toBe(45.9)
    expect(lerPreco('R$ 1.234,50')).toBe(1234.5)
    expect(lerPreco('')).toBeNull()
    expect(lerPreco('abc')).toBeNull()
  })
})

describe('aba do cardápio na URL', () => {
  it('link antigo de "orderbump" abre "Peça também"; valor estranho volta para itens', () => {
    expect(abaDaUrl('orderbump')).toBe('peca-tambem')
    expect(abaDaUrl('tamanhos')).toBe('tamanhos')
    expect(abaDaUrl('xyz')).toBe('itens')
    expect(abaDaUrl(null)).toBe('itens')
  })
})
