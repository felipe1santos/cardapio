import { redirect } from 'next/navigation'
import Page from './page'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

describe('Home page', () => {
  it('manda a raiz para o login', () => {
    // A home deixou de ter conteúdo próprio: quem chega em "/" vai para /login
    // (e o middleware devolve pro painel quem já está logado).
    Page()
    expect(redirect).toHaveBeenCalledWith('/login')
  })
})
