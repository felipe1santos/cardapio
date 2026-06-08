import { render, screen } from '@testing-library/react'
import { Badge } from './badge'

describe('Badge', () => {
  it('renders its label', () => {
    render(<Badge tone="ok">Disponível</Badge>)
    expect(screen.getByText('Disponível')).toBeInTheDocument()
  })

  it('applies price-tone classes', () => {
    render(<Badge tone="ok">Disponível</Badge>)
    const el = screen.getByText('Disponível')
    expect(el.className).toContain('bg-price-bg')
    expect(el.className).toContain('text-price-text')
  })

  it('applies danger-tone classes', () => {
    render(<Badge tone="danger">Esgotado</Badge>)
    const el = screen.getByText('Esgotado')
    expect(el.className).toContain('bg-danger-bg')
    expect(el.className).toContain('text-danger')
  })

  it('applies paused-tone classes', () => {
    render(<Badge tone="paused">Pausado</Badge>)
    const el = screen.getByText('Pausado')
    expect(el.className).toContain('text-purple')
  })
})
