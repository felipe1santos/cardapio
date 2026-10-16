import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TopBar } from '@/components/layout/topbar'
import { AvisoTopo, LinhaResumos, Segmentado, SeletorSecao } from './topo-compacto'

vi.mock('@/components/admin/acoes-topo', () => ({ AcoesTopo: () => null }))

describe('topo compacto', () => {
  it('TopBar com seção mostra o caminho "Título › Seção" e o "i" da ajuda', () => {
    render(<TopBar title="Financeiro" breadcrumb="x" secao={{ nome: 'Contas e DRE', ajuda: { href: '/guia#contas', rotulo: 'Como usar', testid: 'ajuda' } }} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Financeiro')
    expect(screen.getByTestId('topo-secao')).toHaveTextContent('Contas e DRE')
    expect(screen.getByTestId('ajuda')).toHaveAttribute('href', '/guia#contas')
  })

  it('TopBar sem seção continua só com o título', () => {
    render(<TopBar title="Clientes" breadcrumb="x" />)
    expect(screen.queryByTestId('topo-caminho')).toBeNull()
    expect(screen.queryByTestId('topo-aviso')).toBeNull()
  })

  it('aviso do topo aparece na barra com texto e ação', () => {
    render(<TopBar title="Financeiro" breadcrumb="x" aviso={<AvisoTopo testid="pin" texto="Crie seu PIN de aprovação" acao={<button>Criar PIN</button>} />} />)
    expect(screen.getByTestId('topo-aviso')).toContainElement(screen.getByTestId('pin'))
    expect(screen.getByRole('button', { name: 'Criar PIN' })).toBeInTheDocument()
  })

  it('seletor de sub-seção troca pelo valor', async () => {
    const mudar = vi.fn()
    render(<SeletorSecao valor="pagar" onMudar={mudar} rotulo="Seção" testid="sel" opcoes={[{ id: 'pagar', rotulo: 'A pagar' }, { id: 'dre', rotulo: 'DRE' }]} />)
    await userEvent.selectOptions(screen.getByTestId('sel'), 'dre')
    expect(mudar).toHaveBeenCalledWith('dre')
  })

  it('segmentado marca o ativo com aria-pressed', async () => {
    const mudar = vi.fn()
    render(<Segmentado valor="a" onMudar={mudar} rotulo="Situação" testidPrefixo="s-" opcoes={[{ id: 'a', rotulo: 'Em aberto' }, { id: 'b', rotulo: 'Pagas' }]} />)
    expect(screen.getByTestId('s-a')).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByTestId('s-b'))
    expect(mudar).toHaveBeenCalledWith('b')
  })

  it('linha de resumos mostra rótulo e valor de cada pílula', () => {
    render(<LinhaResumos itens={[{ rotulo: 'A pagar', valor: 'R$ 10,00', testid: 'r1' }, { rotulo: 'Vencidas', valor: 'R$ 0,00' }]} />)
    expect(screen.getByTestId('r1')).toHaveTextContent('A pagarR$ 10,00')
    expect(screen.getByText('Vencidas')).toBeInTheDocument()
  })
})
