import { describe, expect, it } from 'vitest'
import { avaliarModos, ehImpressoraVirtual, modoDependeDoAgente, pareamentoAntigo, type AgenteRegra, type DispositivoRegra } from './regras-modo'

const AGORA = new Date('2026-09-27T22:00:00Z').getTime()
const on = new Date(AGORA - 5_000).toISOString()
const off = new Date(AGORA - 10 * 60_000).toISOString()

const pc = (id: string, o: Partial<AgenteRegra> = {}): AgenteRegra => ({ id, nome: 'PC-PRINCIPAL', vistoEm: on, revogado: false, criadoEm: '2026-09-27T20:00:00Z', ...o })
const imp = (id: string, agenteId: string, nomeSistema = 'POS-80'): DispositivoRegra => ({ id, agenteId, nomeSistema })

describe('regra dos modos do Assistente Beta', () => {
  it('Somente teste sempre pode; sem impressoras, os modos reais ficam bloqueados com o motivo', () => {
    const r = avaliarModos({ agentes: [], dispositivos: [], funcoes: { cozinha: null, caixa: null } }, AGORA)
    expect(r.modos.teste.ok).toBe(true)
    expect(r.modos.caixa).toMatchObject({ ok: false, motivo: 'Escolha uma impressora para Recibo/Extrato' })
    expect(r.modos.cozinha_caixa).toMatchObject({ ok: false, motivo: 'Escolha uma impressora para Cozinha' })
  })

  it('Somente Caixa só com Recibo/Extrato válido; Cozinha e Caixa exige as duas', () => {
    const base = { agentes: [pc('a')], dispositivos: [imp('d1', 'a'), imp('d2', 'a', 'POS80-USB')] }
    const soCozinha = avaliarModos({ ...base, funcoes: { cozinha: 'd1', caixa: null } }, AGORA)
    expect(soCozinha.modos.caixa.ok).toBe(false)
    expect(soCozinha.modos.cozinha_caixa).toMatchObject({ ok: false, motivo: 'Escolha uma impressora para Recibo/Extrato' }) // o caso da Villa em 27/09
    const soCaixa = avaliarModos({ ...base, funcoes: { cozinha: null, caixa: 'd2' } }, AGORA)
    expect(soCaixa.modos.caixa.ok).toBe(true)
    expect(soCaixa.modos.cozinha_caixa).toMatchObject({ ok: false, motivo: 'Escolha uma impressora para Cozinha' })
    expect(avaliarModos({ ...base, funcoes: { cozinha: 'd1', caixa: 'd2' } }, AGORA).modos.cozinha_caixa.ok).toBe(true)
    expect(avaliarModos({ ...base, funcoes: { cozinha: 'd1', caixa: 'd1' } }, AGORA).modos.cozinha_caixa.ok).toBe(true) // uma impressora só
  })

  it('computador desconectado, sem sinal, pareamento antigo e impressora virtual bloqueiam', () => {
    const f = (agentes: AgenteRegra[], dispositivos: DispositivoRegra[]) => avaliarModos({ agentes, dispositivos, funcoes: { cozinha: null, caixa: 'd' } }, AGORA).modos.caixa
    expect(f([pc('a', { revogado: true })], [imp('d', 'a')]).motivo).toMatch(/desconectado/)
    expect(f([pc('a', { vistoEm: off })], [imp('d', 'a')]).motivo).toMatch(/sem sinal/)
    expect(f([pc('a', { vistoEm: off, criadoEm: '2026-09-26T18:00:00Z' }), pc('b')], [imp('d', 'a')]).motivo).toBe('Remova o pareamento antigo e pareie novamente')
    expect(f([pc('a')], [imp('d', 'a', 'Microsoft Print to PDF')]).motivo).toMatch(/virtual/)
  })

  it('sem sinal momentâneo não derruba um modo já ligado (exigirSinal = false)', () => {
    const e = { agentes: [pc('a', { vistoEm: off })], dispositivos: [imp('d', 'a')], funcoes: { cozinha: null, caixa: 'd' } }
    expect(avaliarModos(e, AGORA).modos.caixa.ok).toBe(false)
    expect(avaliarModos(e, AGORA, false).modos.caixa.ok).toBe(true)
  })

  it('pareamento antigo: só o registro mais velho, sem sinal, com um mais novo do mesmo nome', () => {
    const velho = pc('a', { vistoEm: off, criadoEm: '2026-09-26T18:00:00Z' })
    const novo = pc('b')
    expect(pareamentoAntigo(velho, [velho, novo], AGORA)).toBe(true)
    expect(pareamentoAntigo(novo, [velho, novo], AGORA)).toBe(false)
    expect(pareamentoAntigo(velho, [velho, pc('c', { nome: 'CAIXA' })], AGORA)).toBe(false)
  })

  it('virtuais do Windows reconhecidas; térmicas não', () => {
    for (const n of ['Microsoft Print to PDF', 'Microsoft XPS Document Writer', 'Fax', 'OneNote for Windows 10']) expect(ehImpressoraVirtual(n)).toBe(true)
    for (const n of ['POS-80', 'POS80-USB/COZINHA', 'Elgin i9']) expect(ehImpressoraVirtual(n)).toBe(false)
  })

  it('desconectar computador: o modo depende dele?', () => {
    const d = [imp('d1', 'a'), imp('d2', 'b')]
    expect(modoDependeDoAgente('caixa', 'a', d, { cozinha: null, caixa: 'd1' })).toBe(true)
    expect(modoDependeDoAgente('caixa', 'b', d, { cozinha: 'd2', caixa: 'd1' })).toBe(false) // cozinha é do antigo nesse modo
    expect(modoDependeDoAgente('cozinha_caixa', 'b', d, { cozinha: 'd2', caixa: 'd1' })).toBe(true)
    expect(modoDependeDoAgente('teste', 'a', d, { cozinha: 'd1', caixa: 'd1' })).toBe(false)
  })
})
