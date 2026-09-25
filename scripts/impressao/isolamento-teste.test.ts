import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const require = createRequire(import.meta.url)
const { REAIS, exigirIsolamento } = require('./isolamento-teste.cjs') as {
  REAIS: { temp: string; log: string; dados: string[]; instalacoes: string[] }
  exigirIsolamento: (o: { temp?: string; pastas?: string[] }) => void
}

describe('proteção dos arquivos reais do Assistente', () => {
  it('aborta com o %TEMP% real (onde fica menuzia-print.log)', () => {
    expect(() => exigirIsolamento({ temp: REAIS.temp })).toThrow(/ABORTADO/)
    expect(() => exigirIsolamento({ temp: REAIS.temp.toUpperCase() + '\\' })).toThrow(/ABORTADO/)
  })
  it('aborta sem pasta temporária própria', () => {
    expect(() => exigirIsolamento({})).toThrow(/sem pasta temporária/)
  })
  it('aborta com dados ou saída dentro da configuração ou instalação real', () => {
    for (const r of [...REAIS.dados, ...REAIS.instalacoes]) {
      expect(() => exigirIsolamento({ temp: join(tmpdir(), 'x-teste'), pastas: [join(r, 'sub')] })).toThrow(/pasta real/)
    }
  })
  it('aceita pasta exclusiva do teste (subpasta do temporário)', () => {
    expect(() => exigirIsolamento({ temp: join(REAIS.temp, 'menuzia-teste-123'), pastas: [join(REAIS.temp, 'menuzia-teste-123', 'dados')] })).not.toThrow()
  })
})
