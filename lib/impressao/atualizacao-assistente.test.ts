import { describe, expect, it } from 'vitest'
import { ATUALIZACAO_ASSISTENTE, latestYml } from './atualizacao-assistente'
import { DOWNLOAD_ASSISTENTE_BETA } from './rotulos'
import { VERSAO_IMPRESSAO_V3, compararVersao } from '@/lib/avisos-painel'

describe('atualização automática do Assistente', () => {
  it('latest.yml no formato do electron-updater, com o instalador do GitHub', () => {
    const y = latestYml()!
    expect(y).toMatch(/^version: 0\.2\.0-beta\.\d+\n/)
    expect(y).toContain(`  - url: ${ATUALIZACAO_ASSISTENTE.url}`)
    expect(y).toMatch(/sha512: [A-Za-z0-9+/]{86}==\n/)
    expect(y).toMatch(/size: \d{7,}\n/)
  })
  it('desligada ou incompleta: nada (o Assistente fica onde está)', () => {
    expect(latestYml({ ...ATUALIZACAO_ASSISTENTE, ligada: false })).toBeNull()
    expect(latestYml({ ...ATUALIZACAO_ASSISTENTE, sha512: '' })).toBeNull()
  })
  it('download, atualização e aviso falam da MESMA versão', () => {
    expect(DOWNLOAD_ASSISTENTE_BETA.versao).toBe(ATUALIZACAO_ASSISTENTE.versao)
    expect(DOWNLOAD_ASSISTENTE_BETA.url).toBe(ATUALIZACAO_ASSISTENTE.url)
    // O aviso mira a 1ª versão que se atualiza sozinha (beta.11); o download/feed pode estar à frente.
    expect(compararVersao(VERSAO_IMPRESSAO_V3, ATUALIZACAO_ASSISTENTE.versao)).toBeLessThanOrEqual(0)
    expect(compararVersao(VERSAO_IMPRESSAO_V3, '0.2.0-beta.11')).toBeGreaterThanOrEqual(0)
  })
})
