import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FichaDaLoja } from './ficha-loja'

/**
 * A ficha é só leitura e vive num portal. O que se guarda aqui é o caminho de
 * teclado: Escape fecha e o foco volta para o botão do menu que abriu — sem
 * isso o Tab seguinte recomeça do topo da página.
 */
function abrir(onFechar = vi.fn()) {
  return {
    onFechar,
    ...render(
      <FichaDaLoja
        loja={{ nome: 'Fire House', logoUrl: null, bairro: 'Centro', cidade: 'Vila Velha' }}
        onFechar={onFechar}
        onEditar={vi.fn()}
        urlCardapio="https://exemplo/loja/fire-house"
      />,
    ),
  }
}

describe('ficha da loja', () => {
  it('mostra os dados publicados da loja', () => {
    abrir()
    expect(screen.getByRole('dialog', { name: 'Dados de Fire House' })).toBeInTheDocument()
    expect(screen.getByText('Centro')).toBeInTheDocument()
    expect(screen.getByText('Vila Velha')).toBeInTheDocument()
  })

  it('Escape pede o fechamento', () => {
    const { onFechar } = abrir()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onFechar).toHaveBeenCalled()
  })

  it('o foco entra na janela e volta para quem abriu', () => {
    const gatilho = document.createElement('button')
    document.body.appendChild(gatilho)
    gatilho.focus()

    const { unmount } = abrir()
    expect(document.activeElement).not.toBe(gatilho)

    unmount()
    expect(document.activeElement).toBe(gatilho)
    gatilho.remove()
  })
})
