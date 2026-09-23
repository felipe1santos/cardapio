import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Sidebar } from './sidebar'

const ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pedidos', label: 'Painel de Pedidos' },
  { href: '/logistica', label: 'Logística' },
  { href: '/cardapio', label: 'Cardápio' },
]

describe('Sidebar', () => {
  it('renders every navigation item label', () => {
    render(<Sidebar items={ITEMS} activeHref="/dashboard" />)
    for (const item of ITEMS) {
      expect(screen.getByText(item.label)).toBeInTheDocument()
    }
  })

  /**
   * O menu ficou claro (tema do painel, 2026-09-23): o item ativo deixou de ser
   * "azul sobre escuro" e passou a ser azul sobre uma pílula azul-clara. O que
   * o teste guarda é o contraste do ativo contra os outros, não o nome da cor.
   */
  it('marks the active item with the active styling', () => {
    render(<Sidebar items={ITEMS} activeHref="/pedidos" />)
    const active = screen.getByText('Painel de Pedidos').closest('a')
    const inativo = screen.getByText('Dashboard').closest('a')
    expect(active?.className).toContain('--adm-azul-claro')
    expect(active?.className).toContain('font-semibold')
    expect(inativo?.className).not.toContain('--adm-azul-claro')
  })

  it('renders the lowercase brand name', () => {
    render(<Sidebar items={ITEMS} activeHref="/dashboard" />)
    expect(screen.getByText('menuzia')).toBeInTheDocument()
  })
})

describe('atalho do link do cardápio', () => {
  it('sem loja, não há botão de copiar', () => {
    render(<Sidebar items={ITEMS} activeHref="/dashboard" />)
    expect(screen.queryByRole('button', { name: 'Copiar o link do cardápio' })).toBeNull()
  })

  it('copia a URL pública da loja e confirma na tela', async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    render(<Sidebar items={ITEMS} activeHref="/dashboard" storeSlug="fire-house" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar o link do cardápio' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/loja/fire-house`))
    expect(await screen.findByText('Link copiado')).toBeInTheDocument()
  })

  it('clipboard bloqueado: abre a vitrine para o dono copiar da barra de endereço', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('bloqueado')
    })
    Object.assign(navigator, { clipboard: { writeText } })
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<Sidebar items={ITEMS} activeHref="/dashboard" storeSlug="fire-house" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copiar o link do cardápio' }))

    await waitFor(() =>
      expect(abrir).toHaveBeenCalledWith(`${window.location.origin}/loja/fire-house`, '_blank', 'noopener,noreferrer'),
    )
    expect(screen.queryByText('Link copiado')).toBeNull()
    abrir.mockRestore()
  })
})
