import { describe, expect, it } from 'vitest'
import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { conviteDoLink, conviteDosArgumentos, conviteDoNomeArquivo, conviteNosDownloads } = require('./convite.js')

const C = 'ABCDEFGHJKMNPQRSTUVWXYZ2'
describe('pareamento sem código (beta.10)', () => {
  it('lê o convite do link menuzia://', () => {
    expect(conviteDoLink(`menuzia://parear?c=${C}`)).toBe(C)
    expect(conviteDoLink(`menuzia://parear/?c=${C.toLowerCase()}`)).toBe(C)
    expect(conviteDoLink('menuzia://parear?c=CURTO')).toBeNull()
    expect(conviteDoLink(`https://evil/parear?c=${C}`)).toBeNull()
    expect(conviteDosArgumentos(['C:\app.exe', '--hidden', `menuzia://parear?c=${C}`])).toBe(C)
  })
  it('lê o convite do nome do instalador (com " (1)" do navegador)', () => {
    expect(conviteDoNomeArquivo(`AssistenteMenuziaBeta-Setup-0.2.0-beta.10-c${C}.exe`)).toBe(C)
    expect(conviteDoNomeArquivo(`AssistenteMenuziaBeta-Setup-0.2.0-beta.10-c${C} (1).exe`)).toBe(C)
    expect(conviteDoNomeArquivo('AssistenteMenuziaBeta-Setup-0.2.0-beta.10.exe')).toBeNull()
    // "0", "1", "I", "L", "O" não existem no alfabeto
    expect(conviteDoNomeArquivo(`AssistenteMenuziaBeta-Setup-0.2.0-beta.10-c${'O'.repeat(24)}.exe`)).toBeNull()
  })
  it('em Downloads: o mais novo de até 24 h', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'mz-conv-'))
    const velho = 'ZZZZZZZZZZZZZZZZZZZZZZZZ', novo = C, vencido = 'YYYYYYYYYYYYYYYYYYYYYYYY'
    const agora = Date.now()
    for (const [c, horas] of [[velho, 5], [novo, 1], [vencido, 30]] as const) {
      const f = join(pasta, `AssistenteMenuziaBeta-Setup-0.2.0-beta.10-c${c}.exe`)
      writeFileSync(f, 'x')
      const t = (agora - horas * 3_600_000) / 1000
      utimesSync(f, t, t)
    }
    expect(conviteNosDownloads(pasta, agora)).toBe(novo)
    expect(conviteNosDownloads(join(pasta, 'nao-existe'), agora)).toBeNull()
  })
})
