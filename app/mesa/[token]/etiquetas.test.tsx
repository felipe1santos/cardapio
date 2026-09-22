import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CardapioDaMesa, type ItemDaMesa } from './cardapio'

/**
 * O cardápio da mesa lê o MESMO cadastro do delivery, mas não mostrava etiqueta
 * nenhuma: o item em promoção ou marcado como "mais pedido" aparecia igual aos
 * outros para quem estava sentado. Estes testes prendem a etiqueta na tela.
 */

const base: Pick<ItemDaMesa, 'grupoId' | 'imagemUrl' | 'grupos' | 'tamanhos' | 'sabores' | 'tipoItem'> = {
  grupoId: 'g1', imagemUrl: null, grupos: [], tamanhos: [], sabores: [], tipoItem: 'simples',
}

const item = (over: Partial<ItemDaMesa>): ItemDaMesa => ({
  ...base,
  id: 'i1',
  nome: 'Coca 1,5L',
  descricao: '',
  preco: 14,
  precoOriginal: null,
  precoAPartirDe: 14,
  tag: null,
  maisVendido: false,
  ...over,
})

function renderizar(itens: ItemDaMesa[], somenteVisualizacao = false) {
  return render(
    <CardapioDaMesa
      token="t"
      mesaNome="Mesa 1"
      sessaoId="s"
      loja={{ nome: 'Loja', logoUrl: null, bannerUrl: null }}
      grupos={[{ id: 'g1', nome: 'Tudo', imagemUrl: null }]}
      itens={itens}
      pizza={{ tamanhos: [], bordas: [], massas: [], regra: 'media' }}
      carrossel={[]}
      mensagem="Aviso"
      somenteVisualizacao={somenteVisualizacao}
    />,
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: null, itens: [], deOutros: [] }))) as typeof fetch
})

describe('etiquetas no cardápio da mesa', () => {
  it('mostra a etiqueta marcada no cadastro', () => {
    renderizar([item({ tag: 'novo' })])
    expect(screen.getByText('✨ Novo')).toBeInTheDocument()
  })

  it('item com desconto ganha a etiqueta de promoção sem o lojista marcar nada', () => {
    renderizar([item({ preco: 9, precoOriginal: 14 })])
    expect(screen.getByText('🏷️ Promoção')).toBeInTheDocument()
  })

  it('"item em destaque" vira mais pedido', () => {
    renderizar([item({ maisVendido: true })])
    expect(screen.getByText('🔥 Mais pedido')).toBeInTheDocument()
  })

  it('item comum não ganha etiqueta nenhuma', () => {
    const { container } = renderizar([item({})])
    expect(container.querySelectorAll('.mesa-item-etiqueta')).toHaveLength(0)
  })

  /** Uma só por item: duas pílulas no mesmo cartão se anulam. */
  it('nunca empilha duas etiquetas no mesmo item', () => {
    const { container } = renderizar([item({ tag: 'favorito', preco: 9, precoOriginal: 14, maisVendido: true })])
    expect(container.querySelectorAll('.mesa-item-etiqueta')).toHaveLength(1)
    expect(screen.getByText('⭐ Favorito da casa')).toBeInTheDocument()
  })

  it('a etiqueta também aparece no modo somente visualização', () => {
    renderizar([item({ tag: 'edicao_limitada' })], true)
    expect(screen.getByText('⏳ Edição limitada')).toBeInTheDocument()
  })
})
