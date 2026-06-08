import { render, screen } from '@testing-library/react'
import Page from './page'

describe('Home page', () => {
  it('renders the Menuzia heading', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { name: /menuzia/i })).toBeInTheDocument()
  })
})
