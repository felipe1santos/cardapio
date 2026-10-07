import { describe, expect, it } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { escolherEnvioAuto, ESQUECER_FALHA_MS } = require('./envio-auto.js')

describe('envio automático (beta.10, 0157)', () => {
  it('impressora virtual sempre pelo driver', () => {
    expect(escolherEnvioAuto({ nomeSistema: 'Microsoft Print to PDF', diagnostico: { driver: 'Microsoft Print To PDF' } }).envio).toBe('driver')
    expect(escolherEnvioAuto({ nomeSistema: 'Microsoft Print to PDF', redeIp: '192.168.0.50' }).envio).toBe('driver')
  })
  it('com IP: direto pela rede', () => {
    expect(escolherEnvioAuto({ nomeSistema: 'Cozinha', redeIp: '192.168.0.50' })).toMatchObject({ envio: 'raw_rede' })
  })
  it('driver de térmica: direto pela fila USB', () => {
    for (const driver of ['POS-80C', 'POS-58', 'Generic / Text Only', 'EPSON TM-T20 Receipt', 'ELGIN i9', 'MP-4200 TH Bematech', 'XP-80C']) {
      expect(escolherEnvioAuto({ nomeSistema: 'Impressora', diagnostico: { driver } }).envio, driver).toBe('raw_fila')
    }
  })
  it('impressora comum (jato de tinta, laser): driver', () => {
    expect(escolherEnvioAuto({ nomeSistema: 'HP DeskJet 2700', diagnostico: { driver: 'HP DeskJet 2700 series PCL-3' } }).envio).toBe('driver')
    expect(escolherEnvioAuto({ nomeSistema: 'Brother', diagnostico: null }).envio).toBe('driver')
  })
  it('falha recente do direto: driver por 10 min, depois tenta de novo', () => {
    const agora = 1_000_000_000
    expect(escolherEnvioAuto({ nomeSistema: 'POS-80', falhouEm: agora - 1000, agora }).envio).toBe('driver')
    expect(escolherEnvioAuto({ nomeSistema: 'POS-80', falhouEm: agora - ESQUECER_FALHA_MS - 1, agora }).envio).toBe('raw_fila')
  })
})
