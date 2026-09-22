import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CardapioDaMesa, type ItemDaMesa } from './cardapio'

const base: Pick<ItemDaMesa, 'grupoId' | 'precoOriginal' | 'imagemUrl' | 'grupos' | 'tamanhos' | 'tag' | 'maisVendido'> = {
  grupoId: 'g1', precoOriginal: null, imagemUrl: 'https://x/foto.webp', grupos: [], tamanhos: [], tag: null, maisVendido: false,
}

const PIZZA: ItemDaMesa = {
  ...base, id: 'p', nome: 'Pizza Salgada', descricao: 'Massa artesanal', preco: 69, tipoItem: 'pizza', precoAPartirDe: 69,
  sabores: [
    { nome: 'Calabresa', descricao: 'Calabresa, cebola', precos: { m: 69 } },
    { nome: 'Portuguesa', descricao: 'Presunto, ovo', precos: { m: 75 } },
  ],
  grupos: [{ id: 'ga', nome: 'Adicionais de Pizza', obrigatorio: false, minEscolhas: 0, maxEscolhas: 3, complementos: [{ id: 'c', nome: 'Bacon', preco: 6, imagemUrl: null }] }],
}
const SUCO: ItemDaMesa = {
  ...base, id: 's', nome: 'Suco de laranja', descricao: 'Natural, 500 ml', preco: 12, tipoItem: 'simples', precoAPartirDe: 12, sabores: [],
}

function renderizar(somenteVisualizacao: boolean) {
  return render(
    <CardapioDaMesa
      token="t"
      mesaNome="Mesa 1"
      sessaoId="s"
      loja={{ nome: 'Loja', logoUrl: null, bannerUrl: null }}
      grupos={[{ id: 'g1', nome: 'Tudo', imagemUrl: null }]}
      itens={[PIZZA, SUCO]}
      pizza={{ tamanhos: [{ id: 'm', nome: 'Média', maxSabores: 2 }], bordas: [], massas: [], regra: 'media' }}
      carrossel={[]}
      mensagem="Aviso da seleção"
      somenteVisualizacao={somenteVisualizacao}
    />,
  )
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: null, itens: [], deOutros: [] }))) as typeof fetch
})

describe('cardápio da mesa — somente visualização', () => {
  it('sem "Minha seleção", sem chamar garçom e sem ler/gravar seleção', () => {
    renderizar(true)
    expect(screen.queryByText('Minha seleção')).toBeNull()
    expect(screen.queryByRole('button', { name: /Chamar o garçom|Garçom já chamado/ })).toBeNull()
    const chamadas = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(chamadas.filter((u) => u.includes('/selecao'))).toEqual([])
    expect(chamadas.filter((u) => u.includes('/chamado'))).toEqual([])
  })

  it('o aviso da loja fecha o cardápio como rodapé nos dois modos', () => {
    const { unmount } = renderizar(true)
    expect(screen.getByRole('note')).toHaveTextContent('Aviso da seleção')
    unmount()
    renderizar(false)
    expect(screen.getByRole('note')).toHaveTextContent('Aviso da seleção')
  })

  it('desligado, o botão de chamar o garçom continua na tela', () => {
    renderizar(false)
    expect(screen.getByRole('button', { name: 'Chamar o garçom' })).toBeInTheDocument()
  })

  /**
   * A loja vira a chave com celulares já na mesa. Ao voltar para a aba, a tela confere o
   * modo e se recarrega se mudou — senão o cliente fica montando uma seleção que a rota
   * recusa, ou preso no cardápio de consulta numa loja que voltou a atender.
   */
  it('confere o modo ao voltar para a aba e recarrega quando ele mudou', async () => {
    const reload = vi.fn()
    const local = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...local, reload } })

    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('/modo')
        ? new Response(JSON.stringify({ somenteVisualizacao: false }))
        : new Response(JSON.stringify({ id: null, itens: [], deOutros: [] })),
    ) as typeof fetch

    renderizar(true)
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => expect(reload).toHaveBeenCalled())

    const chamadas = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
    expect(chamadas.some((u) => u.endsWith('/api/mesa/t/modo'))).toBe(true)

    Object.defineProperty(window, 'location', { configurable: true, value: local })
  })

  it('modo igual ao da tela não recarrega nada', async () => {
    const reload = vi.fn()
    const local = window.location
    Object.defineProperty(window, 'location', { configurable: true, value: { ...local, reload } })

    globalThis.fetch = vi.fn(async (url: unknown) =>
      String(url).includes('/modo')
        ? new Response(JSON.stringify({ somenteVisualizacao: true }))
        : new Response(JSON.stringify({ id: null, itens: [], deOutros: [] })),
    ) as typeof fetch

    renderizar(true)
    fireEvent(document, new Event('visibilitychange'))
    await waitFor(() => {
      const chamadas = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]))
      expect(chamadas.some((u) => u.endsWith('/api/mesa/t/modo'))).toBe(true)
    })
    expect(reload).not.toHaveBeenCalled()

    Object.defineProperty(window, 'location', { configurable: true, value: local })
  })

  it('pizza abre a ficha com foto, descrição e sabores — sem tamanho, adicional nem botão de adicionar', () => {
    renderizar(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Pizza Salgada' }))
    const ficha = screen.getByRole('dialog', { name: 'Pizza Salgada' })
    expect(within(ficha).getByText('Massa artesanal')).toBeInTheDocument()
    expect(within(ficha).getByText('Calabresa')).toBeInTheDocument()
    expect(within(ficha).getByText('Presunto, ovo')).toBeInTheDocument()
    expect(within(ficha).queryByText(/tamanho/i)).toBeNull()
    expect(within(ficha).queryByText('Bacon')).toBeNull()
    expect(within(ficha).queryByText(/Adicionar|Avançar/i)).toBeNull()
    // Único botão da ficha: fechar.
    expect(within(ficha).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Fechar'])
    expect(within(ficha).getByRole('img', { name: 'Pizza Salgada' })).toBeInTheDocument()
  })

  it('outro item: só foto, nome e descrição', () => {
    renderizar(true)
    fireEvent.click(screen.getByRole('button', { name: 'Ver Suco de laranja' }))
    const ficha = screen.getByRole('dialog', { name: 'Suco de laranja' })
    expect(within(ficha).getByText('Natural, 500 ml')).toBeInTheDocument()
    expect(within(ficha).queryByText('Sabores')).toBeNull()
    fireEvent.click(within(ficha).getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('desligado: continua como antes (Minha seleção e configurador)', () => {
    renderizar(false)
    expect(screen.getByText('Minha seleção')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Escolher Pizza Salgada' }))
    expect(screen.getAllByText('Escolha o tamanho').length).toBeGreaterThan(0)
  })
})
