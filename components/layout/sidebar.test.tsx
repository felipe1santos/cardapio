import { render, screen } from '@testing-library/react'
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

  it('marks the active item with the active styling', () => {
    render(<Sidebar items={ITEMS} activeHref="/pedidos" />)
    const active = screen.getByText('Painel de Pedidos').closest('a')
    expect(active?.className).toContain('text-primary')
  })

  it('renders the lowercase brand name', () => {
    render(<Sidebar items={ITEMS} activeHref="/dashboard" />)
    expect(screen.getByText('menuzia')).toBeInTheDocument()
  })
})
