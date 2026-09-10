import { render, screen } from '@testing-library/react'
import { FolhaQr } from './qr-cardapio-folha'
import { modeloEtiqueta, montarEtiquetas, paginarEtiquetas } from '@/lib/qr-cardapio'

const QR = 'data:image/png;base64,iVBORw0KGgo='

function renderFolha({
  mesas = [] as string[],
  quantidade = 1,
  modelo = 'cartao' as const,
  qrDataUrl = QR as string | null,
  logoUrl = null as string | null,
}) {
  const info = modeloEtiqueta(modelo)
  const paginas = paginarEtiquetas(montarEtiquetas({ mesas, quantidade }), info.porPagina)
  return render(
    <FolhaQr
      paginas={paginas}
      modelo={info}
      titulo="Fire House"
      frase="Aponte a câmera"
      url="https://app.menuzia.com.br/loja/fire-house"
      qrDataUrl={qrDataUrl}
      logoUrl={logoUrl}
    />,
  )
}

describe('FolhaQr', () => {
  it('imprime título, frase e URL em cada etiqueta', () => {
    renderFolha({ quantidade: 2 })
    expect(screen.getAllByText('Fire House')).toHaveLength(2)
    expect(screen.getAllByText('Aponte a câmera')).toHaveLength(2)
    expect(screen.getAllByText('https://app.menuzia.com.br/loja/fire-house')).toHaveLength(2)
  })

  it('usa o mesmo QR em todas as etiquetas', () => {
    renderFolha({ mesas: ['Mesa 1', 'Mesa 2'], quantidade: 1 })
    const imgs = screen.getAllByRole('img')
    expect(imgs).toHaveLength(2)
    expect(imgs.every((img) => img.getAttribute('src') === QR)).toBe(true)
  })

  it('escreve o nome da mesa quando ela foi selecionada', () => {
    renderFolha({ mesas: ['Mesa 7'], quantidade: 1 })
    expect(screen.getByText('Mesa 7')).toBeInTheDocument()
    expect(screen.getByAltText('QR Code do cardápio — Mesa 7')).toBeInTheDocument()
  })

  it('mostra placeholder enquanto o QR não chegou', () => {
    renderFolha({ quantidade: 1, qrDataUrl: null })
    expect(screen.getByText('Gerando…')).toBeInTheDocument()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('só imprime a logo quando ela existe', () => {
    const { container, unmount } = renderFolha({ quantidade: 1 })
    expect(container.querySelectorAll('img')).toHaveLength(1)
    unmount()
    const comLogo = renderFolha({ quantidade: 1, logoUrl: 'https://cdn/logo.png' })
    expect(comLogo.container.querySelectorAll('img')).toHaveLength(2)
  })

  it('quebra em folhas A4 conforme o modelo', () => {
    // 6 adesivos por folha: 9 etiquetas = 2 folhas.
    const info = modeloEtiqueta('adesivo')
    const paginas = paginarEtiquetas(montarEtiquetas({ mesas: [], quantidade: 9 }), info.porPagina)
    const { container } = render(
      <FolhaQr paginas={paginas} modelo={info} titulo="X" frase="Y" url="Z" qrDataUrl={QR} />,
    )
    const folhas = container.querySelectorAll('[style*="297mm"]')
    expect(folhas).toHaveLength(2)
    // A última folha não força quebra de página — senão sai uma folha em branco.
    expect((folhas[0] as HTMLElement).style.breakAfter).toBe('page')
    expect((folhas[1] as HTMLElement).style.breakAfter).toBe('auto')
  })
})
