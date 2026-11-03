import { describe, expect, it } from 'vitest'
import { CHECAGEM_CARDS_MS, IMAGENS_MAX, ROTULO_RECORRENTE, TIPOS_RECORRENTES, cabemNaJanela, checagemDevida, intervaloChecagemCards, validarPatchRecorrente } from './recorrentes'

/** 03/11/2026: regras puras dos cards recorrentes (docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md). */

describe('checagemDevida: o cron olha os cards no máximo a cada 10 min', () => {
  const t = 1_700_000_000_000
  it('sem lembrança (deploy) checa', () => expect(checagemDevida(null, t)).toBe(true))
  it('menos de 10 min depois não checa', () => expect(checagemDevida(t - 599_999, t)).toBe(false))
  it('10 min depois checa', () => expect(checagemDevida(t - CHECAGEM_CARDS_MS, t)).toBe(true))
  it('intervalo encurtado (só a suíte local, provedor simulado) checa a cada chamada', () => expect(checagemDevida(t - 1, t, 0)).toBe(true))
  it('intervaloChecagemCards: 10 min por padrão; 0 só com provedor simulado', () => {
    expect(intervaloChecagemCards({})).toBe(CHECAGEM_CARDS_MS)
    expect(intervaloChecagemCards({ CAMPANHA_CHECAGEM_CARDS_MS: '0' })).toBe(CHECAGEM_CARDS_MS)
    expect(intervaloChecagemCards({ WHATSAPP_PROVEDOR: 'simulado', CAMPANHA_CHECAGEM_CARDS_MS: '0' })).toBe(0)
  })
})

describe('rótulos', () => {
  it('três tipos, cada um com nome, público e mensagem padrão com {nome} e {link}', () => {
    expect(TIPOS_RECORRENTES).toEqual(['recuperacao', 'nunca_compraram', 'promocoes'])
    for (const t of TIPOS_RECORRENTES) {
      expect(ROTULO_RECORRENTE[t].nome.length).toBeGreaterThan(3)
      expect(ROTULO_RECORRENTE[t].publico.length).toBeGreaterThan(10)
      expect(ROTULO_RECORRENTE[t].mensagemPadrao).toContain('{nome}')
      expect(ROTULO_RECORRENTE[t].mensagemPadrao).toContain('{link}')
    }
    expect(IMAGENS_MAX).toBe(5)
  })
})

describe('cabemNaJanela: 60–150 s por mensagem (média 105 s)', () => {
  it('17:00–19:00 com teto 150 → 68', () => expect(cabemNaJanela('17:00', '19:00', 150)).toBe(68))
  it('teto da loja menor que a janela vence', () => expect(cabemNaJanela('09:00', '21:30', 50)).toBe(50))
  it('janela invertida → 1', () => expect(cabemNaJanela('19:00', '17:00', 150)).toBe(1))
})

describe('validarPatchRecorrente', () => {
  const ok = (r: ReturnType<typeof validarPatchRecorrente>) => { if (!r.ok) throw new Error(r.erro); return r }
  it('dias vazios é erro', () => {
    const r = validarPatchRecorrente('promocoes', { diasSemana: [] })
    expect(r).toEqual({ ok: false, erro: 'Escolha pelo menos um dia.' })
  })
  it('dias fora de 0–6 ou repetidos é erro; válidos viram smallint[] ordenado', () => {
    expect(validarPatchRecorrente('promocoes', { diasSemana: [7] }).ok).toBe(false)
    expect(ok(validarPatchRecorrente('promocoes', { diasSemana: [5, 1, 5] })).row.dias_semana).toEqual([1, 5])
  })
  it('mais de 5 imagens é erro; url sem https é erro', () => {
    expect(validarPatchRecorrente('promocoes', { imagens: Array(6).fill('https://x/a.jpg') }).ok).toBe(false)
    expect(validarPatchRecorrente('promocoes', { imagens: ['http://x/a.jpg'] }).ok).toBe(false)
    expect(ok(validarPatchRecorrente('promocoes', { imagens: ['https://x/a.jpg'] })).row.imagens).toEqual(['https://x/a.jpg'])
  })
  it('variável desconhecida é erro; {ultimo_item} só na Recuperação', () => {
    expect(validarPatchRecorrente('promocoes', { mensagem: 'Oi {cupom}', incluirLink: true }).ok).toBe(false)
    expect(validarPatchRecorrente('promocoes', { mensagem: 'Oi {nome}, {ultimo_item}', incluirLink: true })).toEqual({ ok: false, erro: 'Esta variável só vale na Recuperação.' })
    expect(ok(validarPatchRecorrente('recuperacao', { mensagem: 'Oi {nome}, {ultimo_item}', incluirLink: true })).row.mensagem).toBe('Oi {nome}, {ultimo_item}')
  })
  it('hora e fim são encaixados em 09:00–21:30', () => {
    const r = ok(validarPatchRecorrente('promocoes', { hora: '08:00', janelaFim: '23:00' }))
    expect(r.row.hora).toBe('09:00')
    expect(r.row.janela_fim).toBe('21:30')
  })
  it('pularHoje grava a data de hoje (Brasília) e avisa a rota', () => {
    const r = ok(validarPatchRecorrente('promocoes', { pularHoje: true }))
    expect(String(r.row.pular_ate)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(r.pularHoje).toBe(true)
  })
  it('ativa precisa ser boolean; patch vazio é erro', () => {
    expect(validarPatchRecorrente('promocoes', { ativa: 'sim' }).ok).toBe(false)
    expect(ok(validarPatchRecorrente('promocoes', { ativa: true })).row.ativa).toBe(true)
    expect(validarPatchRecorrente('promocoes', {}).ok).toBe(false)
  })
})
