import { describe, expect, it } from 'vitest'
import { CHECAGEM_CARDS_MS, IMAGENS_MAX, ROTULO_RECORRENTE, TIPOS_RECORRENTES, cabemNaJanela, checagemDevida, intervaloChecagemCards, limiteAquecimento, pendenciasDoCard, pendenciasDoCardV2, validarAnuncios, PUBLICOS, CORES_ANUNCIO, validarPatchRecorrente } from './recorrentes'

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
    expect(ok(validarPatchRecorrente('promocoes', { imagens: ['https://x/a.jpg'] })).row.imagens).toEqual([{ url: 'https://x/a.jpg', mensagem: '' }])
    expect(ok(validarPatchRecorrente('promocoes', { imagens: [{ url: 'https://x/b.jpg', mensagem: 'Promo de terça {nome}' }] })).row.imagens).toEqual([{ url: 'https://x/b.jpg', mensagem: 'Promo de terça {nome}' }])
    expect(validarPatchRecorrente('promocoes', { imagens: [{ url: 'https://x/b.jpg', mensagem: 'Oi {cupom}' }] }).ok).toBe(false)
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
  it('ativa precisa ser boolean; patch vazio é erro', () => {
    expect(validarPatchRecorrente('promocoes', { ativa: 'sim' }).ok).toBe(false)
    expect(ok(validarPatchRecorrente('promocoes', { ativa: true })).row.ativa).toBe(true)
    expect(validarPatchRecorrente('promocoes', {}).ok).toBe(false)
  })
})

describe('limiteAquecimento: 15 nos 5 primeiros dias, +5 a cada 5 dias (0247)', () => {
  it('dia 0 a 4 → 15; dia 5 a 9 → 20; dia 10 → 25', () => {
    expect([0, 4, 5, 9, 10, 27].map(limiteAquecimento)).toEqual([15, 15, 20, 20, 25, 40])
  })
  it('dias negativos (relógio) contam como 0', () => expect(limiteAquecimento(-3)).toBe(15))
})

describe('pendenciasDoCard: o toggle só liga com tudo pronto', () => {
  const base = { imagens: [{ url: 'https://x/a.jpg', mensagem: '' }], mensagem: 'Oi {nome}', diasSemana: [1], hora: '17:00', janelaFim: '19:00' }
  it('card pronto: sem pendência', () => expect(pendenciasDoCard(base)).toEqual([]))
  it('sem imagem', () => expect(pendenciasDoCard({ ...base, imagens: [] })).toContain('Adicione pelo menos 1 imagem.'))
  it('sem mensagem padrão e imagem sem mensagem', () => expect(pendenciasDoCard({ ...base, mensagem: '  ' })).toContain('Escreva a mensagem padrão ou uma mensagem em cada imagem.'))
  it('sem mensagem padrão mas toda imagem com mensagem: ok', () => expect(pendenciasDoCard({ ...base, mensagem: '', imagens: [{ url: 'https://x/a.jpg', mensagem: 'Promo' }] })).toEqual([]))
  it('sem dia', () => expect(pendenciasDoCard({ ...base, diasSemana: [] })).toContain('Escolha pelo menos um dia.'))
})

describe('0248: públicos, anúncios e copies', () => {
  it('13 públicos, chaves únicas; 5 cores distintas', () => {
    expect(PUBLICOS).toHaveLength(13)
    expect(new Set(PUBLICOS.map((p) => p.chave)).size).toBe(13)
    expect(new Set(CORES_ANUNCIO).size).toBe(5)
  })
  const anuncio = { nome: 'Terça do hambúrguer', cor: '#1d4ed8', mensagem: 'Oi {nome}! {link}', imagens: ['https://x/a.jpg'], diasSemana: [2], hora: '17:00', janelaFim: '19:00', publicos: [] as string[] }
  it('promoção: 1 imagem só; anúncio pronto vira linha com ordem', () => {
    const r = validarAnuncios('promocoes', [anuncio])
    expect(r.ok && r.rows[0]).toMatchObject({ ordem: 0, nome: 'Terça do hambúrguer', imagens: ['https://x/a.jpg'], dias_semana: [2], hora: '17:00', janela_fim: '19:00', publicos: [] })
    expect(validarAnuncios('promocoes', [{ ...anuncio, imagens: ['https://x/a.jpg', 'https://x/b.jpg'] }]).ok).toBe(false)
  })
  it('personalizado: até 5 imagens, públicos válidos; inválido é recusado', () => {
    expect(validarAnuncios('nunca_compraram', [{ ...anuncio, imagens: Array(5).fill('https://x/a.jpg'), publicos: ['recorrentes', 'sem_compra_30d'] }]).ok).toBe(true)
    expect(validarAnuncios('nunca_compraram', [{ ...anuncio, imagens: Array(6).fill('https://x/a.jpg') }]).ok).toBe(false)
    expect(validarAnuncios('nunca_compraram', [{ ...anuncio, publicos: ['inventado'] }]).ok).toBe(false)
  })
  it('no máximo 5 anúncios; {ultimo_item} fora da Recuperação é recusado; cor padrão por posição', () => {
    expect(validarAnuncios('promocoes', Array(6).fill(anuncio)).ok).toBe(false)
    expect(validarAnuncios('promocoes', [{ ...anuncio, mensagem: 'Volta {ultimo_item}' }]).ok).toBe(false)
    const r = validarAnuncios('nunca_compraram', [{ ...anuncio, cor: 'vermelho' }, { ...anuncio, cor: '' }])
    expect(r.ok && r.rows.map((x) => x.cor)).toEqual([CORES_ANUNCIO[0], CORES_ANUNCIO[1]])
  })
  it('Recuperação: até 6 imagens e até 5 copies', () => {
    const img = (n: number) => Array(n).fill({ url: 'https://x/a.jpg', mensagem: '' })
    expect(validarPatchRecorrente('recuperacao', { imagens: img(6) }).ok).toBe(true)
    expect(validarPatchRecorrente('recuperacao', { imagens: img(7) }).ok).toBe(false)
    expect(validarPatchRecorrente('recuperacao', { mensagens: ['A {nome}', 'B {ultimo_item}'] }).ok).toBe(true)
    expect(validarPatchRecorrente('recuperacao', { mensagens: Array(6).fill('x') }).ok).toBe(false)
    expect(validarPatchRecorrente('recuperacao', { mensagens: ['Oi {cupom}'] }).ok).toBe(false)
  })
  it('pendências v2 por tipo', () => {
    const base = { imagens: [], mensagem: '', mensagens: [], diasSemana: [1], hora: '17:00', janelaFim: '19:00', anuncios: [] }
    expect(pendenciasDoCardV2('recuperacao', base)).toEqual(['Adicione pelo menos 1 imagem.', 'Escreva pelo menos 1 copy.'])
    expect(pendenciasDoCardV2('recuperacao', { ...base, imagens: [{ url: 'https://x', mensagem: '' }], mensagens: ['Oi'] })).toEqual([])
    expect(pendenciasDoCardV2('promocoes', base)).toEqual(['Crie pelo menos 1 promoção.'])
    expect(pendenciasDoCardV2('nunca_compraram', { ...base, anuncios: [{ ...anuncio, publicos: [] }] })).toEqual(['Anúncio 1: escolha pelo menos um público.'])
  })
})
