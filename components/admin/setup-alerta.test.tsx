import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SetupAlerta } from './setup-alerta'
import type { PendenciaSetup } from '@/lib/setup-checklist'

const critica: PendenciaSetup = {
  id: 'sem-item-disponivel',
  severidade: 'critico',
  titulo: 'Nenhum item disponível no cardápio',
  descricao: 'O cliente abre o cardápio e não encontra nada pra pedir.',
  href: '/admin/cardapio',
}

const atencao: PendenciaSetup = {
  id: 'sem-logo',
  severidade: 'atencao',
  titulo: 'Loja sem logotipo',
  descricao: 'A logo é a primeira coisa que o cliente vê.',
  href: '/admin/ajustes',
}

describe('SetupAlerta', () => {
  it('não renderiza nada sem pendência', () => {
    const { container } = render(<SetupAlerta pendencias={[]} onDispensar={vi.fn()} onResolver={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lista as pendências com a severidade de cada uma', () => {
    render(<SetupAlerta pendencias={[critica, atencao]} onDispensar={vi.fn()} onResolver={vi.fn()} />)
    expect(screen.getByText('Nenhum item disponível no cardápio')).toBeInTheDocument()
    expect(screen.getByText('Loja sem logotipo')).toBeInTheDocument()
    expect(screen.getByText('Crítico')).toBeInTheDocument()
    expect(screen.getByText('Atenção')).toBeInTheDocument()
  })

  it('avisa que o pedido pode travar quando há pendência crítica', () => {
    render(<SetupAlerta pendencias={[critica]} onDispensar={vi.fn()} onResolver={vi.fn()} />)
    expect(screen.getByText(/atrapalham o pedido/i)).toBeInTheDocument()
  })

  it('muda o tom quando só há avisos', () => {
    render(<SetupAlerta pendencias={[atencao]} onDispensar={vi.fn()} onResolver={vi.fn()} />)
    expect(screen.getByText(/mais completa/i)).toBeInTheDocument()
    expect(screen.queryByText('Crítico')).not.toBeInTheDocument()
  })

  it('"OK, entendi" dispensa o modal', async () => {
    const onDispensar = vi.fn()
    render(<SetupAlerta pendencias={[critica]} onDispensar={onDispensar} onResolver={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /ok, entendi/i }))
    expect(onDispensar).toHaveBeenCalledTimes(1)
  })

  it('"Resolver agora" leva à primeira pendência crítica, não à primeira da lista', async () => {
    const onResolver = vi.fn()
    render(<SetupAlerta pendencias={[atencao, critica]} onDispensar={vi.fn()} onResolver={onResolver} />)
    await userEvent.click(screen.getByRole('button', { name: /resolver agora/i }))
    expect(onResolver).toHaveBeenCalledWith('/admin/cardapio')
  })

  it('cada pendência tem seu próprio atalho para a seção que a resolve', async () => {
    const onResolver = vi.fn()
    render(<SetupAlerta pendencias={[critica, atencao]} onDispensar={vi.fn()} onResolver={onResolver} />)
    await userEvent.click(screen.getByRole('button', { name: /ir para ajustes/i }))
    expect(onResolver).toHaveBeenCalledWith('/admin/ajustes')
  })
})
