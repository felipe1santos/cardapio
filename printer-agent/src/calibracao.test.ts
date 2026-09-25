import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { montarCalibracao, larguraEfetiva } = require('./calibracao.js') as {
  montarCalibracao: (s: Record<string, unknown>, d?: Record<string, unknown>) => string
  larguraEfetiva: (mm: unknown, pontos: unknown) => number
}

describe('página de calibração do Assistente Beta', () => {
  it('largura efetiva: perfil válido ou padrão do papel', () => {
    expect(larguraEfetiva(80, null)).toBe(576)
    expect(larguraEfetiva(58, null)).toBe(384)
    expect(larguraEfetiva(80, 512)).toBe(512)
    expect(larguraEfetiva(80, 5000)).toBe(576)
  })
  it('traz régua, bordas, diagnóstico, largura aplicada e valores', () => {
    const t = montarCalibracao(
      { loja: 'Cantina', impressora: 'Caixa', nome_sistema: 'POS-8370', largura_mm: 80, largura_pontos: 512, deslocamento_pontos: 4, operador: 'Gerente' },
      { driver: 'POS-80C', dpiX: 203, dpiY: 203, areaImprimivelLarguraMm: 72, pontosImprimiveis: 575 },
    )
    expect(t.split('\n').filter((l) => l === '\x01K')).toHaveLength(2)
    for (const s of ['CALIBRAÇÃO DA IMPRESSORA', 'POS-80C', '203 x 203', '72 mm', '575', '512 pontos', '4 pontos', '1:1', 'R$ 12.345,67', 'calibrado']) expect(t).toContain(s)
  })
  it('sem diagnóstico: traços, sem quebrar', () => {
    const t = montarCalibracao({ largura_mm: 58 })
    expect(t).toContain('384 pontos')
    expect(t).toContain('padrão do papel')
  })
})
