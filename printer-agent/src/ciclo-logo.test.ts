import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { deveBaixarLogoDoCiclo } = require('./ciclo-logo')

describe('logo baixada a cada rodada de pedidos (atraso da impressão, 10/10)', () => {
  it('Beta/Alfa 1: NÃO baixa — a comanda usa a logo em cache (logoParaDesenho); o arquivo baixado nunca era usado', () => {
    expect(deveBaixarLogoDoCiclo({ ehBeta: true, imprimirLogo: true, logoUrl: 'https://x/logo.png' })).toBe(false)
  })
  it('Assistente antigo (recibo de texto) com logo: continua baixando', () => {
    expect(deveBaixarLogoDoCiclo({ ehBeta: false, imprimirLogo: true, logoUrl: 'https://x/logo.png' })).toBe(true)
  })
  it('sem logo ou com logo desligada: não baixa', () => {
    expect(deveBaixarLogoDoCiclo({ ehBeta: false, imprimirLogo: false, logoUrl: 'https://x/logo.png' })).toBe(false)
    expect(deveBaixarLogoDoCiclo({ ehBeta: false, imprimirLogo: true, logoUrl: null })).toBe(false)
  })
})
