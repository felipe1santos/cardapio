import { limparNomeArquivo } from './bulk-upload-nome'

describe('limparNomeArquivo', () => {
  it('limpa hífens/underscores e capitaliza palavras', () => {
    expect(limparNomeArquivo('x-burger-duplo.jpg')).toBe('X Burger Duplo')
    expect(limparNomeArquivo('acai_500ml.png')).toBe('Acai 500ml')
    expect(limparNomeArquivo('Coca Cola Lata.webp')).toBe('Coca Cola Lata')
  })

  it('colapsa espaços e separadores repetidos', () => {
    expect(limparNomeArquivo('combo__casal--especial.jpeg')).toBe('Combo Casal Especial')
  })

  it('retorna null para nomes genéricos de câmera/app', () => {
    expect(limparNomeArquivo('IMG_2034.jpg')).toBeNull()
    expect(limparNomeArquivo('DSC00123.JPG')).toBeNull()
    expect(limparNomeArquivo('WhatsApp Image 2026-07-10 at 14.22.01.jpeg')).toBeNull()
    expect(limparNomeArquivo('Screenshot 2026-01-01 123456.png')).toBeNull()
    expect(limparNomeArquivo('PXL_20260101_123456.jpg')).toBeNull()
    expect(limparNomeArquivo('foto.jpg')).toBeNull()
    // Bug 2026-09-30: UUID e hash viravam nome de produto.
    expect(limparNomeArquivo('b2ab1fe1-dd8c-4b89-9070-35c9b6531642.jpg')).toBeNull()
    expect(limparNomeArquivo('65205105_A2CC_43C3_BC10_DB256CCFA40F.webp')).toBeNull()
    expect(limparNomeArquivo('b2ab1fe1-dd8c-4b89-9070-35c9b6531642 (1).png')).toBeNull()
    expect(limparNomeArquivo('9f86d081884c7d659a2feaa0c55ad015.jpg')).toBeNull()
    expect(limparNomeArquivo('download (3).jpg')).toBeNull()
    expect(limparNomeArquivo('cafe-expresso.jpg')).toBe('Cafe Expresso')
    expect(limparNomeArquivo('bacon-cheddar-2024.jpg')).toBe('Bacon Cheddar 2024')
    expect(limparNomeArquivo('image (3).png')).toBeNull()
  })

  it('retorna null para nomes só com números ou símbolos', () => {
    expect(limparNomeArquivo('12345.png')).toBeNull()
    expect(limparNomeArquivo('---.jpg')).toBeNull()
    expect(limparNomeArquivo('.jpg')).toBeNull()
  })

  it('mantém números que fazem parte do nome real', () => {
    expect(limparNomeArquivo('pizza-2-sabores.png')).toBe('Pizza 2 Sabores')
  })
})
