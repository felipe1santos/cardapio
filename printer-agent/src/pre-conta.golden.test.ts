import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Baseline do Recibo/Extrato REAL (2026-09-25, antes do Recibo/Extrato de teste). O teste
 * usa o mesmo renderizador com blocos opcionais que a conta real não tem: para ela, as
 * linhas têm de ser exatamente estas.
 */
const require = createRequire(import.meta.url)
const { montarPreContaLinhas } = require('./pre-conta.js') as { montarPreContaLinhas: (s: unknown) => string[] }
const { CONTAS } = require('../test/fixtures-pre-conta.cjs') as { CONTAS: Record<string, unknown> }
const golden = JSON.parse(readFileSync(join(__dirname, '..', 'test', 'golden-pre-conta.json'), 'utf8')) as Record<string, string[]>

describe('Recibo/Extrato real — idêntico ao baseline', () => {
  for (const [nome, conta] of Object.entries(CONTAS)) {
    it(nome, () => {
      expect(montarPreContaLinhas(conta).map((l) => l.replace(/\x01/g, '<SOH>').replace(/\x02/g, '<STX>'))).toEqual(golden[nome])
    })
  }
})
