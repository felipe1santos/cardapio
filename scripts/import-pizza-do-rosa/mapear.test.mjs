import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { mapear } from './mapear.mjs'

const origem = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'dados/cardapio-origem.json'), 'utf8'))
const plano = mapear(origem)

describe('tamanhos de pizza', () => {
  it('cria os 4 tamanhos da origem mais o Brotinho', () => {
    expect(plano.tamanhosPizza.map((t) => t.nome)).toEqual(['Pequena', 'Média', 'Grande', 'Gigante', 'Brotinho'])
  })

  it('leva o máximo de sabores de cada tamanho', () => {
    expect(plano.tamanhosPizza.map((t) => t.maxSabores)).toEqual([1, 2, 3, 4, 1])
  })

  it('leva as fatias', () => {
    expect(plano.tamanhosPizza.map((t) => t.fatias)).toEqual([4, 6, 8, 12, 4])
  })
})

describe('bordas', () => {
  it('são 5 e todas com o preço do Grande', () => {
    expect(plano.bordas).toHaveLength(5)
    expect(plano.bordas.every((b) => b.preco === 19)).toBe(true)
    expect(plano.bordas.map((b) => b.nome)).toContain('Catupiry')
  })
})

describe('grupos', () => {
  it('tem as 15 categorias do spec, nessa ordem', () => {
    expect(plano.grupos.map((g) => g.nome)).toEqual([
      'Pizzas Salgadas', 'Pizzas Doces', 'Pizza Promocional', 'Pizza Brotinho',
      'Hambúrguers', 'Pizza Burguer', 'Porções', 'Massas', 'Saladas',
      'Sobremesas', 'Bebidas', 'Cervejas e Vinhos', 'Molhos', 'Congelados', 'Loja Virtual',
    ])
  })

  it('não perde nenhum dos 227 itens de origem', () => {
    const totalSimples = plano.grupos.flatMap((g) => g.itens).filter((i) => i.tipoItem === 'simples').length
    const totalSabores = plano.grupos.flatMap((g) => g.itens).flatMap((i) => i.sabores ?? []).length
    expect(totalSimples + totalSabores).toBe(227)
  })
})

describe('itens de pizza', () => {
  const salgadas = plano.grupos.find((g) => g.nome === 'Pizzas Salgadas').itens[0]
  const brotinho = plano.grupos.find((g) => g.nome === 'Pizza Brotinho').itens[0]
  const promo = plano.grupos.find((g) => g.nome === 'Pizza Promocional').itens[0]

  it('Pizzas Salgadas é um item pizza com 56 sabores', () => {
    expect(salgadas.tipoItem).toBe('pizza')
    expect(salgadas.sabores).toHaveLength(56)
  })

  it('cada sabor salgado tem preço nos 4 tamanhos grandes, nenhum no Brotinho', () => {
    for (const s of salgadas.sabores) {
      expect(s.precos.map((p) => p.tamanho)).toEqual(['Pequena', 'Média', 'Grande', 'Gigante'])
      expect(s.precos.every((p) => p.preco > 0)).toBe(true)
    }
  })

  it('Brotinho tem preço só no tamanho Brotinho, com a faixa real por sabor', () => {
    // A origem NÃO cobra um valor único de R$ 49 pro Brotinho: 4 sabores com
    // recheio nobre custam mais (o mesmo padrão de "sabor especial custa mais"
    // que já existe na sessão PIZZA). Descoberto rodando o mapeador contra a
    // origem ao vivo em 2026-09-12 — ver task-8-report.md.
    expect(brotinho.sabores).toHaveLength(20)
    for (const s of brotinho.sabores) {
      expect(s.precos).toHaveLength(1)
      expect(s.precos[0].tamanho).toBe('Brotinho')
      expect(s.precos[0].preco).toBeGreaterThan(0)
    }
    const precoPorSabor = Object.fromEntries(brotinho.sabores.map((s) => [s.nome, s.precos[0].preco]))
    expect(new Set(Object.values(precoPorSabor))).toEqual(new Set([49, 59, 69]))
    expect(precoPorSabor['Alcatra']).toBe(59)
    expect(precoPorSabor['Filé ao 4 Queijos']).toBe(59)
    expect(precoPorSabor['Costela com Catupiry']).toBe(59)
    expect(precoPorSabor['Picanha']).toBe(69)
  })

  it('Promocional tem preço só no Gigante, a R$ 79, e tag de promoção', () => {
    expect(promo.tag).toBe('promocao')
    expect(promo.sabores).toHaveLength(15)
    for (const s of promo.sabores) {
      expect(s.precos).toEqual([{ tamanho: 'Gigante', preco: 79 }])
    }
  })

  it('os 4 itens de pizza recebem o preset de adicionais de pizza', () => {
    for (const nome of ['Pizzas Salgadas', 'Pizzas Doces', 'Pizza Promocional', 'Pizza Brotinho']) {
      expect(plano.grupos.find((g) => g.nome === nome).itens[0].presets).toContain('Adicionais de Pizza')
    }
  })
})

describe('presets de complementos', () => {
  it('cria os 5 presets', () => {
    expect(plano.presets.map((p) => p.nome).sort()).toEqual([
      'Adicionais de Hambúrguer', 'Adicionais de Massa', 'Adicionais de Pizza', 'Adicionais de Porção', 'Adicionais de Salada',
    ])
  })

  it('adicional de pizza usa a coluna do Grande', () => {
    const bacon = plano.presets.find((p) => p.nome === 'Adicionais de Pizza').itens.find((i) => i.nome === 'Bacon')
    expect(bacon.preco).toBe(9)
  })

  it('todos são opcionais e de múltipla escolha', () => {
    for (const p of plano.presets) {
      expect(p.obrigatorio).toBe(false)
      expect(p.minEscolhas).toBe(0)
      expect(p.maxEscolhas).toBeGreaterThan(1)
    }
  })
})

describe('itens simples', () => {
  it('todo item simples tem preço maior que zero', () => {
    const simples = plano.grupos.flatMap((g) => g.itens).filter((i) => i.tipoItem === 'simples')
    expect(simples.every((i) => i.preco > 0)).toBe(true)
  })

  it('todo item e todo sabor tem foto de origem', () => {
    const itens = plano.grupos.flatMap((g) => g.itens)
    expect(itens.filter((i) => i.tipoItem === 'simples').every((i) => !!i.imagemOrigem)).toBe(true)
    expect(itens.flatMap((i) => i.sabores ?? []).every((s) => !!s.imagemOrigem)).toBe(true)
  })

  it('nenhum nome de sabor contém o separador " / "', () => {
    const sabores = plano.grupos.flatMap((g) => g.itens).flatMap((i) => i.sabores ?? [])
    expect(sabores.filter((s) => s.nome.includes(' / '))).toEqual([])
  })
})
