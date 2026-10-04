import { describe, expect, it } from 'vitest'
import {
  BOM, atalhoDoPeriodo, corDiferenca, dataBR, dataHoraBR, filtrosParaQuery, gerarCsvBR, lerFiltros, periodoDoAtalho, protegerFormula, valorBR,
} from './fluxo-regras'

// 2026-10-04 10:00 em São Paulo (13:00 UTC).
const AGORA = new Date('2026-10-04T13:00:00Z')

describe('fluxo de caixa: períodos', () => {
  it('atalhos', () => {
    expect(periodoDoAtalho('hoje', AGORA)).toEqual({ de: '2026-10-04', ate: '2026-10-04' })
    expect(periodoDoAtalho('ontem', AGORA)).toEqual({ de: '2026-10-03', ate: '2026-10-03' })
    expect(periodoDoAtalho('7d', AGORA)).toEqual({ de: '2026-09-28', ate: '2026-10-04' })
    expect(periodoDoAtalho('30d', AGORA)).toEqual({ de: '2026-09-05', ate: '2026-10-04' })
    expect(periodoDoAtalho('mes', AGORA)).toEqual({ de: '2026-10-01', ate: '2026-10-04' })
    expect(periodoDoAtalho('mes_passado', AGORA)).toEqual({ de: '2026-09-01', ate: '2026-09-30' })
    expect(periodoDoAtalho('mes_passado', new Date('2026-03-10T15:00:00Z'))).toEqual({ de: '2026-02-01', ate: '2026-02-28' })
  })
  it('meia-noite em São Paulo (UTC já virou o dia)', () => {
    expect(periodoDoAtalho('hoje', new Date('2026-10-05T02:30:00Z'))).toEqual({ de: '2026-10-04', ate: '2026-10-04' })
  })
  it('qual atalho o período representa', () => {
    expect(atalhoDoPeriodo('2026-09-28', '2026-10-04', AGORA)).toBe('7d')
    expect(atalhoDoPeriodo('2026-09-10', '2026-09-12', AGORA)).toBeNull()
  })
})

describe('fluxo de caixa: filtros na URL', () => {
  it('ida e volta, ignorando lixo', () => {
    const f = lerFiltros(new URLSearchParams('de=2026-09-01&ate=2026-09-30&origem=delivery,hack,mesa&forma=pix&status=divergente&operador=11111111-1111-1111-1111-111111111111&produto=nao-e-uuid'), AGORA)
    expect(f).toMatchObject({ de: '2026-09-01', ate: '2026-09-30', origens: ['delivery', 'mesa'], formas: ['pix'], situacoes: ['divergente'], operador: '11111111-1111-1111-1111-111111111111', produto: null })
    expect(lerFiltros(new URLSearchParams(filtrosParaQuery(f)), AGORA)).toEqual(f)
  })
  it('sem período: últimos 7 dias; invertido: corrige', () => {
    expect(lerFiltros(new URLSearchParams(''), AGORA)).toMatchObject({ de: '2026-09-28', ate: '2026-10-04' })
    expect(lerFiltros(new URLSearchParams('de=2026-10-04&ate=2026-10-01'), AGORA)).toMatchObject({ de: '2026-10-01', ate: '2026-10-04' })
  })
})

describe('fluxo de caixa: CSV para o Excel em português', () => {
  it('valores 1.234,56 com sinal e datas dd/mm/aaaa hh:mm', () => {
    expect(valorBR(123456)).toBe('1.234,56')
    expect(valorBR(-5)).toBe('-0,05')
    expect(valorBR(100000000)).toBe('1.000.000,00')
    expect(valorBR(null)).toBe('')
    expect(dataHoraBR('2026-10-04T03:05:00Z')).toBe('04/10/2026 00:05')
    expect(dataBR('2026-10-04')).toBe('04/10/2026')
  })
  it('BOM, separador ";", aspas e acentos', () => {
    const csv = gerarCsvBR([['Descrição', 'Valor'], ['Pão de açúcar; "especial"', { n: -150 }]])
    expect(csv.startsWith(BOM)).toBe(true)
    expect(csv).toBe(`${BOM}Descrição;Valor\r\n"Pão de açúcar; ""especial""";-1,50\r\n`)
  })
  it('injeção de fórmula: texto com = + - @ vira texto; números do relatório não', () => {
    expect(protegerFormula('=HYPERLINK("http://x")')).toBe(`'=HYPERLINK("http://x")`)
    for (const s of ['+1', '-2+3', '@SUM(A1)', '\t=1']) expect(protegerFormula(s).startsWith("'")).toBe(true)
    expect(protegerFormula('Troco ok')).toBe('Troco ok')
    const csv = gerarCsvBR([['=1+1', { n: -100 }]])
    expect(csv).toBe(`${BOM}'=1+1;-1,00\r\n`)
  })
})

describe('fluxo de caixa: cor da diferença', () => {
  it('verde zero, vermelho falta, âmbar sobra', () => {
    expect(corDiferenca(0)).toBe('#15803D')
    expect(corDiferenca(-100)).toBe('#B91C1C')
    expect(corDiferenca(100)).toBe('#B45309')
    expect(corDiferenca(null)).toBeNull()
  })
})
