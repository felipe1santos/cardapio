import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Baseline da ficha da cozinha (2026-09-23, antes da impressão com várias impressoras).
 * O recibo é protegido (CLAUDE.md §7): qualquer diferença aqui é mudança de layout ou de
 * conteúdo e precisa de autorização explícita. A renderização em pixel (print.ps1) é
 * comparada fora do Git por scripts/impressao/renderizar-virtual.mjs.
 */
const require = createRequire(import.meta.url)
const { montarReciboLinhas } = require('./recibo.js') as { montarReciboLinhas: (...a: unknown[]) => string[] }
const { FIXTURES, CONFIGS } = require('../test/fixtures-recibo.cjs') as {
  FIXTURES: Record<string, Record<string, unknown>>
  CONFIGS: Record<string, Record<string, unknown>>
}
const golden = JSON.parse(readFileSync(join(__dirname, '..', 'test', 'golden-recibo.json'), 'utf8')) as Record<string, string[]>

describe('recibo da cozinha — idêntico ao baseline', () => {
  for (const [nome, pedido] of Object.entries(FIXTURES)) {
    for (const [nc, config] of Object.entries(CONFIGS)) {
      it(`${nome} / ${nc}`, () => {
        const linhas = montarReciboLinhas(pedido, config, 'Cantina Demonstração', false).map((l) =>
          l.replace(/\x01/g, '<SOH>').replace(/\x02/g, '<STX>'),
        )
        expect(linhas).toEqual(golden[`${nome}.${nc}`])
      })
    }
  }
  it('o baseline cobre delivery, mesa, balcão, complementos, observação e acentos', () => {
    const tudo = JSON.stringify(golden)
    for (const t of ['ENTREGA', 'MESA Mesa 01', 'BALCAO (PDV)', 'SENHA 12', '+ 2x Bacon', 'Obs:', 'ÇÃÉÕÍÚ']) expect(tudo).toContain(t)
  })
})
