import { describe, expect, it } from 'vitest'
import { pizzaSemSabores, pizzaTemPrecoPorSabor, saborDoProprioItem, saboresDoTamanho } from './pizza-sabores'

const G = 'tam-g', GG = 'tam-gg', XG = 'tam-xg'
const s = (nome: string, precos: Record<string, number>, status = 'disponivel') => ({ nome, status, precos: Object.entries(precos).map(([tamanhoPadraoId, preco]) => ({ tamanhoPadraoId, preco })) })

describe('sabores por tamanho', () => {
  const salgada = [s('Calabresa', { [G]: 50, [GG]: 60, [XG]: 70 }), s('Portuguesa', { [G]: 55, [GG]: 65 }), s('Atum', { [G]: 52, [GG]: 62, [XG]: 72 }, 'pausado')]
  it('pizza precificada por sabor: só sabores ativos com preço no tamanho', () => {
    expect(saboresDoTamanho(salgada, G, 40).map((x) => `${x.sabor.nome}:${x.preco}`)).toEqual(['Calabresa:50', 'Portuguesa:55'])
    expect(saboresDoTamanho(salgada, XG, 40).map((x) => x.sabor.nome)).toEqual(['Calabresa'])
  })
  it('pizza sem preço por sabor (Brotinho): sabores com o preço do item', () => {
    const brotinho = [s('Brot Calabresa', {}), s('Brot Frango', {})]
    expect(pizzaTemPrecoPorSabor(brotinho)).toBe(false)
    expect(saboresDoTamanho(brotinho, GG, 49).map((x) => `${x.sabor.nome}:${x.preco}`)).toEqual(['Brot Calabresa:49', 'Brot Frango:49'])
    expect(saboresDoTamanho(brotinho, GG)).toEqual([]) // sem o preço do item: regra antiga
  })
  it('pizza sem sabores (Baiana): grupo sabor não é obrigatório', () => {
    expect(pizzaSemSabores([])).toBe(true)
    expect(pizzaSemSabores([s('X', {}, 'pausado')])).toBe(true)
    expect(saboresDoTamanho([], G, 0)).toEqual([])
    expect(pizzaSemSabores(salgada)).toBe(false)
  })
  it('sem tamanho escolhido: nenhum sabor', () => {
    expect(saboresDoTamanho(salgada, null, 40)).toEqual([])
  })
})

describe('sabor do próprio produto', () => {
  it('casa palavra inteira, sem acento/caixa, o nome mais longo primeiro', () => {
    expect(saborDoProprioItem('Pizza Baiana', ['Calabresa', 'Baiana'])).toBe('Baiana')
    expect(saborDoProprioItem('Pizza de Frango com Catupiry', ['Frango', 'Frango com Catupiry'])).toBe('Frango com Catupiry')
    expect(saborDoProprioItem('PIZZA PORTUGUÊSA', ['Portuguêsa'])).toBe('Portuguêsa')
    expect(saborDoProprioItem('Pizza Salgada', ['Sal'])).toBeNull()
    expect(saborDoProprioItem('Pizza Tradicional', ['Calabresa'])).toBeNull()
  })
})

describe('avisos do cadastro', async () => {
  const { avisosDoCadastro } = await import('./avisos-cadastro')
  const tams = [{ id: 'g', nome: 'Pizza G' }, { id: 'gg', nome: 'Pizza GG' }]
  it('pizza sem sabores', () => {
    expect(avisosDoCadastro({ nome: 'Pizza Baiana', tipoItem: 'pizza', preco: 0, sabores: [], grupos: [] }, tams)[0]).toMatch(/não tem nenhum sabor cadastrado/)
  })
  it('tamanho sem sabor disponível (e tamanho desligado não avisa)', () => {
    const it1 = { nome: 'P', tipoItem: 'pizza', preco: 0, sabores: [{ nome: 'A', status: 'disponivel', precos: [{ tamanhoPadraoId: 'g', preco: 50 }] }], grupos: [] }
    expect(avisosDoCadastro(it1, tams)).toEqual(['O tamanho Pizza GG não tem nenhum sabor disponível — cadastre o preço ou desligue o tamanho nesta pizza.'])
    expect(avisosDoCadastro({ ...it1, pizzaTamanhosOcultos: ['gg'] }, tams)).toEqual([])
  })
  it('grupo obrigatório sem opções', () => {
    const a = avisosDoCadastro({ nome: 'Açaí', tipoItem: 'simples', preco: 10, sabores: [], grupos: [{ nome: 'Fruta', obrigatorio: true, complementos: [{ pausado: true }] }, { nome: 'Extras', obrigatorio: false, complementos: [] }] }, [])
    expect(a).toEqual(['O grupo obrigatório "Fruta" não tem nenhuma opção disponível — ele não será exigido até ter opções.'])
  })
})
