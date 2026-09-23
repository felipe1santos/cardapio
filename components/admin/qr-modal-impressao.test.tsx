import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ModalImpressaoQr, type PecaQr } from './qr-modal-impressao'

/**
 * A janela de impressão trava a rolagem do painel enquanto está aberta e pinta
 * uma película escura por cima. As duas coisas vivem num portal no `<body>`, e
 * foi exatamente isso que sobrou na tela quando a aba de QR deixou de estar
 * visível sem desmontar: o painel ficou escurecido e sem rolar.
 *
 * Aqui prendemos a parte que é do modal — desmontar devolve a rolagem.
 */
const peca: PecaQr = { id: 'm1', nome: 'Mesa 01', url: 'https://x/mesa/t', qrDataUrl: null }

function abrir() {
  return render(
    <ModalImpressaoQr
      titulo="Imprimir o QR da Mesa 01"
      pecas={[peca]}
      destino="mesa"
      nomeLoja="Loja"
      logoUrl={null}
      fraseInicial="Aponte a câmera"
      onFechar={vi.fn()}
    />,
  )
}

describe('janela de impressão de QR', () => {
  it('abre com a folha à vista e trava a rolagem atrás', () => {
    const { unmount } = abrir()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
  })

  it('ao fechar, devolve a rolagem do painel', () => {
    const anterior = document.body.style.overflow
    const { unmount } = abrir()
    unmount()
    expect(document.body.style.overflow).toBe(anterior)
  })

  it('não deixa película nenhuma no body depois de fechar', () => {
    const { unmount } = abrir()
    unmount()
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(0)
    expect(document.getElementById('qr-print-root')).toBeNull()
  })
})
