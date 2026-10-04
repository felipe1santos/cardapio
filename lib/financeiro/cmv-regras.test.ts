import { describe, expect, it } from 'vitest'
import { arredondarPreco, centavos, conversaoPadrao, custoFicha, custoPizza, custoPorBase, lerQuantidadeTexto, margemPct, precoSugerido } from './cmv-regras'

const ins = (custoCompraCentavos: number, quantidadeCompra: number, basePorUnidade: number, aproveitamentoPct = 100) =>
  custoPorBase({ custoCompraCentavos, quantidadeCompra, basePorUnidade, aproveitamentoPct })

describe('CMV: exemplos do pedido, conferidos à mão', () => {
  // tomate R$ 8,00/kg → 0,8 centavo/g × 30 g = 24 c
  const tomate = ins(800, 1, conversaoPadrao('kg')!.fator)
  // carne R$ 32,00/kg → 3,2 c/g × 120 g = 384 c
  const carne = ins(3200, 1, 1000)
  // pão R$ 24,00 o pacote com 24 → 100 c/un × 1
  const pao = ins(2400, 1, 24)
  // queijo R$ 40,00/kg → 4 c/g × 40 g = 160 c
  const queijo = ins(4000, 1, 1000)
  // embalagem R$ 0,80/un × 1 = 80 c
  const emb = ins(80, 1, 1)
  it('cada componente', () => {
    expect(centavos(30 * tomate)).toBe(24)
    expect(centavos(120 * carne)).toBe(384)
    expect(centavos(1 * pao)).toBe(100)
    expect(centavos(40 * queijo)).toBe(160)
    expect(centavos(1 * emb)).toBe(80)
  })
  it('ficha = R$ 7,48; vendendo a R$ 25,00: lucro R$ 17,52 e margem 70,08%', () => {
    const cmv = centavos(custoFicha([
      { quantidadeBase: 30, custoPorBase: tomate }, { quantidadeBase: 120, custoPorBase: carne }, { quantidadeBase: 1, custoPorBase: pao },
      { quantidadeBase: 40, custoPorBase: queijo }, { quantidadeBase: 1, custoPorBase: emb },
    ]))
    expect(cmv).toBe(748)
    expect(2500 - cmv).toBe(1752)
    expect(margemPct(2500, cmv)!.toFixed(2)).toBe('70.08')
  })
})

describe('CMV: conversões, aproveitamento e sub-receita', () => {
  it('kg→g, L→ml, dúzia→un; pacote e caixa definidos pela pessoa', () => {
    expect(conversaoPadrao('kg')).toEqual({ base: 'g', fator: 1000 })
    expect(conversaoPadrao('l')).toEqual({ base: 'ml', fator: 1000 })
    expect(conversaoPadrao('duzia')).toEqual({ base: 'un', fator: 12 })
    expect(conversaoPadrao('pacote')).toBeNull()
    // caixa com 12 L de leite por R$ 60,00 → 6000 c ÷ 12000 ml = 0,5 c/ml
    expect(ins(6000, 1, 12000)).toBe(0.5)
    // 2 pacotes comprados juntos por R$ 48,00 (24 un cada) = mesmo custo unitário
    expect(ins(4800, 2, 24)).toBe(100)
  })
  it('aproveitamento de 85% encarece o custo real por grama', () => {
    expect(ins(800, 1, 1000, 85)).toBeCloseTo(0.8 / 0.85, 10)
    expect(centavos(100 * ins(800, 1, 1000, 85))).toBe(94) // 80 c ÷ 0,85 = 94,1 c
  })
  it('insumo preparado: soma dos componentes ÷ rendimento', () => {
    // molho: 500 g de tomate (0,8 c/g) + 50 ml de azeite (6 c/ml) rende 400 g → (400 + 300) ÷ 400 = 1,75 c/g
    const molho = custoPorBase({ custoCompraCentavos: 0, quantidadeCompra: 1, basePorUnidade: 1, aproveitamentoPct: 100, preparado: true, rendimentoBase: 400,
      componentes: [{ quantidadeBase: 500, custoPorBase: 0.8 }, { quantidadeBase: 50, custoPorBase: 6 }] })
    expect(molho).toBe(1.75)
  })
  it('pizza meio a meio: 1/2 do custo de cada sabor naquele tamanho', () => {
    expect(custoPizza([1200, 1600])).toBe(1400)
    expect(custoPizza([900, 1200, 1500])).toBe(1200)
  })
})

describe('CMV: sugestão de preço', () => {
  it('custo ÷ (1 − margem − variáveis), arredondado para cima', () => {
    expect(precoSugerido(748, 65, 0, 'nenhum')).toBe(2138) // 748 ÷ 0,35 = 2137,1 → 2138
    expect(precoSugerido(748, 65, 5, 'nenhum')).toBe(2494) // ÷ 0,30 = 2493,3
    expect(precoSugerido(748, 65, 5, '90')).toBe(2590) // 24,94 → próximo final ,90 acima = 25,90
    expect(precoSugerido(748, 65, 5, '99')).toBe(2499)
    expect(precoSugerido(748, 65, 5, '00')).toBe(2500)
    expect(precoSugerido(748, 65, 5, '50')).toBe(2500)
    expect(precoSugerido(748, 70, 30, '90')).toBeNull()
    expect(precoSugerido(0, 65, 0, '90')).toBeNull()
  })
  it('arredondar nunca baixa o preço', () => {
    expect(arredondarPreco(2390, '90')).toBe(2390)
    expect(arredondarPreco(2391, '90')).toBe(2490)
    expect(arredondarPreco(2300, '99')).toBe(2399)
  })
})

describe('CMV: quantidade da ficha de preparo', () => {
  it('lê e converte', () => {
    expect(lerQuantidadeTexto('30 g', 'g')).toBe(30)
    expect(lerQuantidadeTexto('120g', 'g')).toBe(120)
    expect(lerQuantidadeTexto('1,5 kg', 'g')).toBe(1500)
    expect(lerQuantidadeTexto('0.2 L', 'ml')).toBe(200)
    expect(lerQuantidadeTexto('1 un', 'un')).toBe(1)
    expect(lerQuantidadeTexto('2', 'un')).toBe(2)
    expect(lerQuantidadeTexto('a gosto', 'g')).toBeNull()
    expect(lerQuantidadeTexto('30 g', 'ml')).toBeNull()
  })
})
