import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminLayout from './layout'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { carregarDadosSetup } from '@/lib/queries/setup'
import type { DadosSetup } from '@/lib/setup-checklist'

const push = vi.fn()

let rotaAtual = '/admin/dashboard'

vi.mock('next/navigation', () => ({ usePathname: () => rotaAtual, useRouter: () => ({ push }) }))
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    // O layout abre um canal Realtime assim que conhece a loja.
    channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
    removeChannel: () => {},
    auth: { signOut: vi.fn() },
  }),
}))
vi.mock('@/lib/queries/cardapio', () => ({ buscarRestauranteIdDoUsuario: vi.fn() }))
vi.mock('@/lib/queries/pedidos', () => ({
  contarBadgesNav: vi.fn().mockResolvedValue({ novosPedidos: 0, logisticaPendente: 0 }),
}))
vi.mock('@/lib/queries/ajustes', () => ({ buscarConfigLoja: vi.fn() }))
vi.mock('@/lib/queries/setup', () => ({ carregarDadosSetup: vi.fn() }))

/** Config mínima que o layout consome (slug e o toggle de Logística). */
const CONFIG = { slug: 'lanchonete', usaLogistica: true }

function dadosSetup(over: Partial<DadosSetup> = {}): DadosSetup {
  return {
    config: {
      telefone: '27999999999',
      logoUrl: 'https://exemplo/logo.png',
      bannerUrl: 'https://exemplo/capa.png',
      enderecoRua: 'Rua das Flores',
      enderecoNumero: '123',
      enderecoBairro: 'Centro',
      enderecoCidade: 'Vila Velha',
      enderecoEstado: 'ES',
      taxaEntregaPadrao: 5,
      horarioFuncionamento: { '1': [{ abre: '18:00', fecha: '23:00' }] },
      statusLoja: 'automatico',
      usaLogistica: true,
      aceitaEntrega: true,
      aceitaRetirada: true,
      ...(over.config ?? {}),
    },
    itensDisponiveis: 10,
    itensSemFoto: 0,
    itensSemPreco: 0,
    itensSemDiaDaSemana: 0,
    categorias: 2,
    temTaxaPorBairro: true,
    temTaxaPorRaio: false,
    entregadoresCadastrados: 1,
    ...over,
  }
}

beforeEach(() => {
  rotaAtual = '/admin/dashboard'
  localStorage.clear()
  push.mockClear()
  vi.mocked(carregarDadosSetup).mockClear()
  vi.mocked(buscarConfigLoja).mockClear()
  vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue(null)
  vi.mocked(buscarConfigLoja).mockResolvedValue(CONFIG as never)
  vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup())
})

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

describe('AdminLayout — checklist de configuração', () => {
  it('não mostra nada quando a loja está configurada', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    render(<AdminLayout><p>Página</p></AdminLayout>)

    await waitFor(() => expect(carregarDadosSetup).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByText(/pendência/i)).not.toBeInTheDocument()
  })

  it('abre o alerta e, no OK, deixa só o marcador no menu da seção', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup({ itensDisponiveis: 0 }))

    render(<AdminLayout><p>Página</p></AdminLayout>)

    const modal = await screen.findByRole('dialog')
    expect(modal).toHaveTextContent('Nenhum item disponível no cardápio')

    await userEvent.click(screen.getByRole('button', { name: /ok, entendi/i }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Marcador no item de menu que resolve (Cardápio) e atalho no rodapé.
    expect(screen.getByLabelText('1 pendência de configuração')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 pendência/i })).toBeInTheDocument()
    expect(localStorage.getItem('menuzia:setup-ok:loja-1')).toBe('sem-item-disponivel')
  })

  it('não reabre o alerta depois do OK, mas reabre quando surge pendência nova', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    localStorage.setItem('menuzia:setup-ok:loja-1', 'sem-item-disponivel')
    vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup({ itensDisponiveis: 0 }))

    const { unmount } = render(<AdminLayout><p>Página</p></AdminLayout>)
    await waitFor(() => expect(screen.getByLabelText('1 pendência de configuração')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    unmount()

    // Chegou outra pendência crítica: a assinatura muda e o alerta volta.
    vi.mocked(carregarDadosSetup).mockResolvedValue(
      dadosSetup({ itensDisponiveis: 0, config: { ...dadosSetup().config, telefone: '' } })
    )
    render(<AdminLayout><p>Página</p></AdminLayout>)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('o marcador some quando a pendência é corrigida', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup({ itensDisponiveis: 0 }))

    const { unmount } = render(<AdminLayout><p>Página</p></AdminLayout>)
    await screen.findByRole('dialog')
    unmount()

    // Dono cadastrou os itens: a próxima leitura não acha mais pendência.
    vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup())
    render(<AdminLayout><p>Página</p></AdminLayout>)

    await waitFor(() => expect(carregarDadosSetup).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/pendência de configuração/)).not.toBeInTheDocument()
  })

  it('só avisos não interrompem: nada de modal, só o marcador', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(carregarDadosSetup).mockResolvedValue(
      dadosSetup({ config: { ...dadosSetup().config, logoUrl: null } })
    )

    render(<AdminLayout><p>Página</p></AdminLayout>)

    await waitFor(() => expect(screen.getByLabelText('1 pendência de configuração')).toBeInTheDocument())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('não interrompe quem está no Kanban ou no PDV — só marca o menu', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup({ itensDisponiveis: 0 }))
    rotaAtual = '/admin/pedidos'

    render(<AdminLayout><p>Kanban</p></AdminLayout>)

    await waitFor(() => expect(carregarDadosSetup).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByLabelText('1 pendência de configuração')).toBeInTheDocument()
  })

  it('"Resolver agora" navega para a seção e fecha o alerta', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup({ itensDisponiveis: 0 }))

    render(<AdminLayout><p>Página</p></AdminLayout>)
    await screen.findByRole('dialog')

    await userEvent.click(screen.getByRole('button', { name: /resolver agora/i }))

    expect(push).toHaveBeenCalledWith('/admin/cardapio')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('o atalho do rodapé reabre o alerta depois do OK', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(carregarDadosSetup).mockResolvedValue(dadosSetup({ itensDisponiveis: 0 }))

    render(<AdminLayout><p>Página</p></AdminLayout>)
    await screen.findByRole('dialog')
    await userEvent.click(screen.getByRole('button', { name: /ok, entendi/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /1 pendência/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
