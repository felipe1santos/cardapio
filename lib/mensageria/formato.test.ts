import { describe, expect, it } from 'vitest'
import { emojiDoItem, linhaComplemento, linhaItem, listaNumerada, quebrarListasEmLinha } from './formato'

describe('emoji por item/complemento (tabela fixa, sem IA)', () => {
  it('acha pela palavra-chave, sem acento e sem caixa', () => {
    const casos: [string, string][] = [
      ['Banana', '🍌'], ['Mel', '🍯'], ['Morango', '🍓'], ['Uva', '🍇'], ['Kiwi', '🥝'], ['Coco ralado', '🥥'],
      ['Leite em pó', '🥛'], ['leite ninho', '🥛'], ['Leite condensado', '🥛'], ['Granola', '🥣'], ['Sucrilhos', '🥣'],
      ['Chocolate', '🍫'], ['Nutella', '🍫'], ['Paçoca', '🥜'], ['Amendoim', '🥜'], ['Sorvete', '🍨'], ['Bacon extra', '🥓'],
      ['Queijo', '🧀'], ['Cheddar', '🧀'], ['Ovo', '🍳'], ['Cebola', '🧅'], ['Tomate', '🍅'], ['Alface', '🥬'], ['Salada', '🥬'],
      ['Frango', '🍗'], ['Picanha', '🥩'], ['Carne extra', '🥩'], ['X-Bacon', '🍔'], ['Smash burger', '🍔'], ['Hambúrguer artesanal', '🍔'],
      ['Batata frita', '🍟'], ['Fritas', '🍟'], ['Pizza grande', '🍕'], ['Hot dog', '🌭'], ['Açaí grandão', '🍇'], ['Acai 500', '🍇'],
      ['Coca lata', '🥤'], ['Guaraná 2L', '🥤'], ['Suco de laranja', '🥤'], ['Refrigerante', '🥤'], ['Cerveja', '🍺'], ['Água', '💧'],
    ]
    for (const [nome, e] of casos) expect(emojiDoItem(nome), nome).toBe(e)
  })
  it('sem correspondência: sem emoji (nunca um genérico)', () => {
    expect(emojiDoItem('ffd')).toBeNull()
    expect(emojiDoItem('Combo da casa')).toBeNull()
    expect(emojiDoItem('Ovomaltine')).toBeNull() // "ovo" só como palavra
    expect(emojiDoItem('Comer melhor')).toBeNull() // "mel" só como palavra
  })
})

describe('linhas de item e complemento', () => {
  it('complemento grátis não mostra preço; pago mostra com fundo cinza', () => {
    expect(linhaComplemento('banana', 0)).toBe('🍌 Banana')
    expect(linhaComplemento('Bacon extra', 4)).toBe('🥓 Bacon extra `+R$ 4,00`')
    expect(linhaComplemento('ffd', 0)).toBe('Ffd')
  })
  it('item: emoji, nome em negrito e preço com fundo cinza', () => {
    expect(linhaItem(1, 'Acai grandao', 32)).toBe('🍇 *1x Acai grandao* `R$ 32,00`')
    expect(linhaItem(2, 'ffd', 23)).toBe('*2x ffd* `R$ 23,00`')
  })
  it('lista numerada: uma opção por linha, com número', () => {
    expect(listaNumerada(['Lanches', 'Bebidas'])).toBe('1. Lanches\n2. Bebidas')
  })
})

describe('listas sempre uma embaixo da outra (o servidor quebra o que vier em linha)', () => {
  it('"·" na mesma linha vira uma por linha', () => {
    expect(quebrarListasEmLinha('banana · leite em pó · leite ninho · sucrilhos')).toBe('🍌 Banana\n🥛 Leite em pó\n🥛 Leite ninho\n🥣 Sucrilhos')
  })
  it('lista curta depois de ":" com vírgulas e "e/ou" vira uma por linha', () => {
    expect(quebrarListasEmLinha('Escolha de 4 a 10 adicionais: banana, leite em pó, leite ninho e/ou sucrilhos.'))
      .toBe('Escolha de 4 a 10 adicionais:\n🍌 Banana\n🥛 Leite em pó\n🥛 Leite ninho\n🥣 Sucrilhos')
  })
  it('frase normal com vírgula não é mexida', () => {
    const t = 'Beleza, vou anotar. Vai ser entrega ou retirada?'
    expect(quebrarListasEmLinha(t)).toBe(t)
    const t2 = 'Hoje funcionamos das 08:00 às 22:00, até mais tarde.'
    expect(quebrarListasEmLinha(t2)).toBe(t2)
  })
})
