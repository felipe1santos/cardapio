import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AdminLayout from './layout'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { carregarDadosSetup } from '@/lib/queries/setup'
import type { DadosSetup } from '@/lib/setup-checklist'

const push = vi.fn()

let rotaAtual = '/admin/dashboard'

/** Último callback registrado no canal Realtime dos pedidos — o teste dispara por ele. */
let aoMudarPedido: ((payload: Record<string, unknown>) => void) | null = null

vi.mock('next/navigation', () => ({ usePathname: () => rotaAtual, useRouter: () => ({ push }) }))
vi.mock('@/lib/supabase/client', () => ({
  getBrowserSupabase: () => ({
    // O layout abre um canal Realtime assim que conhece a loja.
    channel: () => ({
      on: (_evento: string, _cfg: unknown, cb: (payload: Record<string, unknown>) => void) => {
        aoMudarPedido = cb
        return { subscribe: () => ({}) }
      },
    }),
    removeChannel: () => {},
    // Leitura do módulo Mesas (`auth_modulo_mesas`). Sem ela o efeito rejeita e
    // o vitest derruba a execução com erro não tratado.
    rpc: async () => ({ data: false, error: null }),
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
  aoMudarPedido = null
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

  /**
   * Loja sem nome cadastrado existe (cadastro pela metade). O bloco de identidade
   * do menu desenha a inicial do nome quando não há logo — e derrubava o painel
   * inteiro. Sem nome, o bloco some; o painel continua de pé.
   */
  it('loja sem nome: painel de pé, sem bloco de identidade', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(buscarConfigLoja).mockResolvedValue({ ...CONFIG, nome: '  ' } as never)

    render(<AdminLayout><p>Conteúdo da página</p></AdminLayout>)

    await waitFor(() => expect(buscarConfigLoja).toHaveBeenCalled())
    expect(screen.getByText('Conteúdo da página')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Ver os dados de/ })).toBeNull()
  })

  it('loja com nome: bloco de identidade abre a ficha', async () => {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    vi.mocked(buscarConfigLoja).mockResolvedValue({ ...CONFIG, nome: 'Fire House' } as never)

    render(<AdminLayout><p>Conteúdo da página</p></AdminLayout>)

    expect(await screen.findByRole('button', { name: 'Ver os dados de Fire House' })).toBeInTheDocument()
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

/**
 * Aviso de pedido novo pelo navegador. O layout não abre canal novo: usa o
 * Realtime que já assina para os badges do menu. O que se guarda aqui é QUEM
 * vira notificação (INSERT ainda em "recebido") e que o conteúdo não carrega
 * dado de cliente.
 */
describe('AdminLayout — aviso de pedido novo', () => {
  const criadas: { titulo: string; corpo: string }[] = []

  beforeEach(() => {
    criadas.length = 0
    class NotificacaoFake {
      static permission: NotificationPermission = 'granted'
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission)
      onclick: (() => void) | null = null
      close = vi.fn()
      constructor(titulo: string, opcoes?: NotificationOptions) {
        criadas.push({ titulo, corpo: opcoes?.body ?? '' })
      }
    }
    vi.stubGlobal('Notification', NotificacaoFake)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function montarComCanal() {
    vi.mocked(buscarRestauranteIdDoUsuario).mockResolvedValue('loja-1')
    render(<AdminLayout><p>Página</p></AdminLayout>)
    await waitFor(() => expect(aoMudarPedido).not.toBeNull())
  }

  it('pedido novo em "recebido" avisa, sem dado do cliente', async () => {
    await montarComCanal()

    aoMudarPedido!({ eventType: 'INSERT', new: { id: 'p1', numero: 42, canal: 'delivery', status: 'recebido', cliente_nome: 'Ana' } })

    expect(criadas).toHaveLength(1)
    expect(criadas[0].titulo).toBe('Pedido #42 chegou')
    expect(criadas[0].corpo).not.toContain('Ana')
  })

  it('não avisa em UPDATE nem em pedido que já saiu de "recebido"', async () => {
    await montarComCanal()

    aoMudarPedido!({ eventType: 'UPDATE', new: { id: 'p2', numero: 43, status: 'recebido' } })
    aoMudarPedido!({ eventType: 'INSERT', new: { id: 'p3', numero: 44, status: 'preparando' } })

    expect(criadas).toHaveLength(0)
  })

  it('o mesmo pedido duas vezes avisa uma vez só', async () => {
    await montarComCanal()

    const evento = { eventType: 'INSERT', new: { id: 'p4', numero: 45, canal: 'mesa', status: 'recebido' } }
    aoMudarPedido!(evento)
    aoMudarPedido!(evento)

    expect(criadas).toHaveLength(1)
  })

  it('sem permissão concedida, nada é disparado', async () => {
    ;(Notification as unknown as { permission: NotificationPermission }).permission = 'default'
    await montarComCanal()

    aoMudarPedido!({ eventType: 'INSERT', new: { id: 'p5', numero: 46, status: 'recebido' } })

    expect(criadas).toHaveLength(0)
  })
})
