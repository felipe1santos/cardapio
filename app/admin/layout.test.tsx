import { render, screen } from '@testing-library/react'
import AdminLayout from './layout'

vi.mock('next/navigation', () => ({ usePathname: () => '/admin/dashboard' }))
vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }))
vi.mock('@/lib/queries/cardapio', () => ({ buscarRestauranteIdDoUsuario: vi.fn().mockResolvedValue(null) }))

describe('AdminLayout', () => {
  it('renders the sidebar navigation alongside the page content', () => {
    render(
      <AdminLayout>
        <p>Conteúdo da página</p>
      </AdminLayout>
    )
    expect(screen.getByText('menuzia')).toBeInTheDocument()
    expect(screen.getByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Painel de Pedidos')).toBeInTheDocument()
    expect(screen.getByText('Conteúdo da página')).toBeInTheDocument()
  })
})
