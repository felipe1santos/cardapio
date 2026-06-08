import { render, screen } from '@testing-library/react'
import { Button } from './button'

describe('Button', () => {
  it('renders its label', () => {
    render(<Button>Avançar etapa</Button>)
    expect(screen.getByRole('button', { name: 'Avançar etapa' })).toBeInTheDocument()
  })

  it('applies the primary variant classes by default', () => {
    render(<Button>Salvar</Button>)
    const btn = screen.getByRole('button', { name: 'Salvar' })
    expect(btn.className).toContain('bg-primary')
    expect(btn.className).toContain('rounded-menuzia')
  })

  it('applies the secondary variant classes when requested', () => {
    render(<Button variant="secondary">Cancelar</Button>)
    const btn = screen.getByRole('button', { name: 'Cancelar' })
    expect(btn.className).toContain('bg-border')
  })

  it('applies the success variant classes when requested', () => {
    render(<Button variant="success">Pronto</Button>)
    const btn = screen.getByRole('button', { name: 'Pronto' })
    expect(btn.className).toContain('bg-status-ready')
  })
})
