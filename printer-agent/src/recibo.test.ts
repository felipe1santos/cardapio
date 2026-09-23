import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * O recibo é protegido (CLAUDE.md §7). A única mudança autorizada: a senha do balcão,
 * SÓ quando o canal é balcão. Este teste compara com a versão anterior do arquivo
 * (do git) — delivery, mesa e o balcão antigo têm que sair idênticos, linha por linha.
 */
const require = createRequire(import.meta.url)
const atual = require('./recibo.js') as { montarReciboLinhas: (...a: unknown[]) => string[] }

function versaoAnterior(): { montarReciboLinhas: (...a: unknown[]) => string[] } | null {
  try {
    const src = execSync('git show 2017e55:printer-agent/src/recibo.js', { encoding: 'utf8' })
    const dir = mkdtempSync(join(tmpdir(), 'recibo-'))
    const arq = join(dir, 'recibo-anterior.cjs')
    writeFileSync(arq, src)
    return require(arq)
  } catch {
    return null
  }
}

const config = { mostrarNumeroItem: true, imprimirLogo: false }
const base = {
  numero: 42, tipo: 'retirada', formaPagamento: 'dinheiro', trocoPara: null, clienteNome: 'Cliente Teste',
  clienteTelefone: '', enderecoRua: '', enderecoNumero: '', enderecoComplemento: '', enderecoBairro: '', enderecoCep: '',
  observacao: '', pago: false, origem: 'cardapio', mesa: null, subtotal: 10, taxaEntrega: 0, total: 10,
  criadoEm: '2026-09-23T15:00:00.000Z',
  itens: [{ nome: 'X', quantidade: 1, precoUnitario: 10, observacao: '', tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '', complementos: [] }],
}

describe('recibo — só o balcão ganha a senha', () => {
  const anterior = versaoAnterior()

  const casos: [string, Record<string, unknown>][] = [
    ['delivery', { ...base, tipo: 'entrega', canal: 'delivery', senha: null, enderecoRua: 'Rua A', enderecoNumero: '1', enderecoBairro: 'Centro' }],
    ['mesa', { ...base, origem: 'pdv', mesa: 'M1', canal: 'mesa', senha: null }],
    ['mesa com senha indevida', { ...base, origem: 'pdv', mesa: 'M1', canal: 'mesa', senha: 7 }],
    ['balcão antigo (sem canal)', { ...base, origem: 'pdv', mesa: null }],
    ['delivery sem canal (Assistente antigo)', { ...base, tipo: 'entrega' }],
  ]
  for (const [nome, pedido] of casos) {
    it(`${nome}: idêntico à versão anterior`, () => {
      expect(anterior).not.toBeNull()
      expect(atual.montarReciboLinhas(pedido, config, 'Loja')).toEqual(anterior!.montarReciboLinhas(pedido, config, 'Loja'))
    })
  }

  it('balcão v2: uma linha a mais, SENHA, logo depois de BALCAO (PDV)', () => {
    const pedido = { ...base, origem: 'pdv', mesa: null, canal: 'balcao', senha: 128 }
    const linhas = atual.montarReciboLinhas(pedido, config, 'Loja')
    const i = linhas.findIndex((l) => l.includes('BALCAO (PDV)'))
    expect(i).toBeGreaterThan(-1)
    expect(linhas[i + 1]).toContain('SENHA 128')
    if (anterior) {
      const antes = anterior.montarReciboLinhas(pedido, config, 'Loja')
      expect(linhas.length).toBe(antes.length + 1)
      expect([...linhas.slice(0, i + 1), ...linhas.slice(i + 2)]).toEqual(antes)
    }
  })
})
