import { describe, expect, it } from 'vitest'
import { classificarClique, ehPedidoDeTeste, organizarCliques } from './dashboard-limpeza'

describe('pedido de teste', () => {
  it('cliente, observação ou bairro com "teste"; telefone de teste', () => {
    expect(ehPedidoDeTeste({ clienteNome: 'teste' })).toBe(true)
    expect(ehPedidoDeTeste({ clienteNome: 'TESTE tempo de resposta' })).toBe(true)
    expect(ehPedidoDeTeste({ observacao: 'pedido de teste, cancelar' })).toBe(true)
    expect(ehPedidoDeTeste({ bairro: 'Bairro Teste' })).toBe(true)
    expect(ehPedidoDeTeste({ telefone: '(27) 99253-4407' })).toBe(true)
    expect(ehPedidoDeTeste({ telefone: '5527992534407' })).toBe(true)
  })
  it('cliente de verdade não é teste (nem quem tem "teste" dentro de outra palavra)', () => {
    expect(ehPedidoDeTeste({ clienteNome: 'Eduarda', bairro: 'Valparaíso', telefone: '27999990000' })).toBe(false)
    expect(ehPedidoDeTeste({ clienteNome: 'Celeste Martins' })).toBe(false)
    expect(ehPedidoDeTeste({ bairro: 'Contestado' })).toBe(false)
    expect(ehPedidoDeTeste({})).toBe(false)
  })
})

describe('cliques da vitrine', () => {
  const nomes = { produtos: ['X - BACON', 'PICANHA BRUTO', 'Combo Família'], categorias: ['COMBOS PROMOCIONAIS', 'Bebidas'] }
  it('navegação', () => {
    for (const a of ['×', '✕', '←', 'Fechar', 'Home', 'Pedidos', 'Continuar no cardápio', 'Sair mesmo assim', '+', '−', 'Salvar'])
      expect(classificarClique(a, nomes), a).toBe('navegacao')
  })
  it('o que importa', () => {
    expect(classificarClique('X - BACON Pão, Bife de hambúrguer, Queijo, Baco…', nomes)).toBe('produto')
    expect(classificarClique('PICANHA BRUTO', nomes)).toBe('produto')
    expect(classificarClique('COMBOS PROMOCIONAIS', nomes)).toBe('categoria')
    expect(classificarClique('Bebidas', nomes)).toBe('categoria')
    expect(classificarClique('🏷️ Promoções', nomes)).toBe('promocao')
    expect(classificarClique('Cupons', nomes)).toBe('cupom')
    expect(classificarClique('🎁 Você tem cupom pra resgatar →', nomes)).toBe('cupom')
    expect(classificarClique('APLICAR', nomes)).toBe('cupom')
    expect(classificarClique('Continuar para pagamento', nomes)).toBe('pagamento')
    expect(classificarClique('Revisar pedido', nomes)).toBe('pagamento')
    expect(classificarClique('2 Ver sacola', nomes)).toBe('sacola')
    expect(classificarClique('Adicionar', nomes)).toBe('sacola')
    expect(classificarClique('Verde Grátis', nomes)).toBe('escolha')
  })
  it('organiza: 10 principais, navegação e escolhas agrupadas, soma igual', () => {
    const cliques = [
      { alvo: '×', cliques: 320, visitantes: 100 }, { alvo: 'Adicionar', cliques: 236, visitantes: 90 }, { alvo: 'Home', cliques: 127, visitantes: 60 },
      { alvo: 'PICANHA BRUTO', cliques: 16, visitantes: 10 }, { alvo: 'Verde Grátis', cliques: 48, visitantes: 20 },
    ]
    const o = organizarCliques(cliques, nomes)
    expect(o.principais.map((c) => c.alvo)).toEqual(['Adicionar', 'PICANHA BRUTO'])
    expect(o.navegacao?.cliques).toBe(447)
    expect(o.escolhas?.cliques).toBe(48)
    const soma = o.principais.reduce((s, c) => s + c.cliques, 0) + (o.navegacao?.cliques ?? 0) + (o.escolhas?.cliques ?? 0)
    expect(soma).toBe(cliques.reduce((s, c) => s + c.cliques, 0))
    expect(o.todos).toHaveLength(5)
  })
})
