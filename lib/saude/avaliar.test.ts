import { describe, expect, it } from 'vitest'
import { avaliar, cronsAtrasados, horaDoResumo, medidasVazias, podeEnviar, textoResumo, type Medidas } from './avaliar'

const base = (p: Partial<Medidas> = {}): Medidas => ({ ...medidasVazias('2026-10-28T21:00:00Z'), ...p })
const assuntos = (m: Medidas) => avaliar(m).map((a) => `${a.assunto}:${a.nivel}`)

describe('avaliar', () => {
  it('tudo normal → nenhum alerta', () => {
    expect(avaliar(base({ reqPorMin: 300, reqMediaPorMin: 250, discoUsadoPct: 48, memLivrePct: 60, cpuPct: 40, cpuAltaSeguidas: 0 }))).toEqual([])
  })

  it('Supabase bloqueado (402 de 27/10) é vermelho na hora', () => {
    const [a] = avaliar(base({ bancoRestrito: 'Service for this project is restricted ... exceed_egress_quota' }))
    expect(a.assunto).toBe('supabase-bloqueado')
    expect(a.nivel).toBe('vermelho')
    expect(a.texto).toMatch(/O que fazer/)
  })

  it('requisições: 2× a média = amarelo, 4× = vermelho; madrugada com pouco volume não alerta', () => {
    expect(assuntos(base({ reqPorMin: 500, reqMediaPorMin: 240 }))).toEqual(['requisicoes:amarelo'])
    expect(assuntos(base({ reqPorMin: 1000, reqMediaPorMin: 240 }))).toEqual(['requisicoes:vermelho'])
    expect(assuntos(base({ reqPorMin: 40, reqMediaPorMin: 10 }))).toEqual([])
  })

  it('egress projetado no mês: 70% amarelo, 90% vermelho', () => {
    expect(assuntos(base({ egressMesGb: 180, egressCotaGb: 250 }))).toEqual(['egress:amarelo'])
    expect(assuntos(base({ egressMesGb: 230, egressCotaGb: 250 }))).toEqual(['egress:vermelho'])
  })

  it('API paga do dia: um assunto por API', () => {
    const m = base({ apis: [{ api: 'geocoding', chamadas: 220, limite: 300 }, { api: 'directions', chamadas: 290, limite: 300 }, { api: 'uber', chamadas: 3, limite: 600 }] })
    expect(assuntos(m)).toEqual(['api-geocoding:amarelo', 'api-directions:vermelho'])
  })

  it('IA em dólar e loja que puxa quase tudo de uma API', () => {
    expect(assuntos(base({ iaUsd: { gasto: 4.6, teto: 5 } }))).toEqual(['ia-usd:vermelho'])
    const m = base({ lojasApi: [{ loja: 'Villa', api: 'geocoding', chamadas: 160, totalApi: 180, limite: 300 }] })
    expect(assuntos(m)).toEqual(['loja-api-geocoding:amarelo'])
    // Loja dominante mas volume baixo: normal (uma loja só usando).
    expect(assuntos(base({ lojasApi: [{ loja: 'Villa', api: 'geocoding', chamadas: 20, totalApi: 20, limite: 300 }] }))).toEqual([])
  })

  it('VPS: disco, memória e carga', () => {
    expect(assuntos(base({ discoUsadoPct: 75 }))).toEqual(['vps-disco:amarelo'])
    expect(assuntos(base({ discoUsadoPct: 93, memLivrePct: 8, cpuPct: 99, cpuAltaSeguidas: 6 }))).toEqual(['vps-disco:vermelho', 'vps-memoria:vermelho', 'vps-cpu:vermelho'])
  })

  it('CPU: só alerta com 90%+ por 3 fotos seguidas (15 min) — um deploy de 10 min não vira alarme', () => {
    expect(assuntos(base({ cpuPct: 100, cpuAltaSeguidas: 2 }))).toEqual([])
    expect(assuntos(base({ cpuPct: 95, cpuAltaSeguidas: 3 }))).toEqual(['vps-cpu:amarelo'])
    expect(assuntos(base({ cpuPct: 97, cpuAltaSeguidas: 6 }))).toEqual(['vps-cpu:vermelho'])
  })

  it('cron parado e WhatsApp de loja caído', () => {
    const m = base({ cronsAtrasados: [{ nome: 'pix-online', minutos: 25 }], whatsappCaido: [{ loja: 'Ponto 400', minutos: 30 }] })
    expect(assuntos(m)).toEqual(['cron-pix-online:vermelho', 'whatsapp-Ponto 400:amarelo'])
  })
})

describe('cronsAtrasados', () => {
  const agora = Date.parse('2026-10-28T21:00:00Z')
  it('só os que já bateram alguma vez; folga de 3× o intervalo (mínimo 10 min)', () => {
    const r = cronsAtrasados([
      { nome: 'whatsapp', ultima_em: '2026-10-28T20:58:00Z' },
      { nome: 'pix-online', ultima_em: '2026-10-28T20:40:00Z' },
      { nome: 'financeiro-vigia', ultima_em: '2026-10-28T20:30:00Z' },
      { nome: 'financeiro-diario', ultima_em: '2026-10-28T16:00:00Z' },
    ], agora)
    expect(r).toEqual([{ nome: 'pix-online', minutos: 20 }, { nome: 'financeiro-diario', minutos: 300 }])
  })
})

describe('podeEnviar (no máximo 1 do mesmo assunto a cada 6 h)', () => {
  const agora = Date.parse('2026-10-28T21:00:00Z')
  it('repetido em 6 h não sai; passou de 6 h sai', () => {
    expect(podeEnviar([{ assunto: 'egress', nivel: 'amarelo', criado_em: '2026-10-28T17:00:00Z' }], { assunto: 'egress', nivel: 'amarelo' }, agora)).toBe(false)
    expect(podeEnviar([{ assunto: 'egress', nivel: 'amarelo', criado_em: '2026-10-28T14:00:00Z' }], { assunto: 'egress', nivel: 'amarelo' }, agora)).toBe(true)
  })
  it('WhatsApp de loja caído repete só a cada 24 h', () => {
    const h = [{ assunto: 'whatsapp-Nossa Cozinha', nivel: 'amarelo', criado_em: '2026-10-28T10:00:00Z' }]
    expect(podeEnviar(h, { assunto: 'whatsapp-Nossa Cozinha', nivel: 'amarelo' }, agora)).toBe(false)
    expect(podeEnviar(h, { assunto: 'whatsapp-Nossa Cozinha', nivel: 'amarelo' }, Date.parse('2026-10-29T10:01:00Z'))).toBe(true)
  })
  it('amarelo que vira vermelho sai na hora (uma vez)', () => {
    expect(podeEnviar([{ assunto: 'egress', nivel: 'amarelo', criado_em: '2026-10-28T20:00:00Z' }], { assunto: 'egress', nivel: 'vermelho' }, agora)).toBe(true)
    expect(podeEnviar([{ assunto: 'egress', nivel: 'vermelho', criado_em: '2026-10-28T20:30:00Z' }], { assunto: 'egress', nivel: 'vermelho' }, agora)).toBe(false)
  })
})

describe('resumo diário', () => {
  it('sai a partir das 09:00 de Brasília, uma vez por dia', () => {
    expect(horaDoResumo(new Date('2026-10-29T11:59:00Z'), null)).toBe(false) // 08:59 BRT
    expect(horaDoResumo(new Date('2026-10-29T12:01:00Z'), null)).toBe(true)
    expect(horaDoResumo(new Date('2026-10-29T15:00:00Z'), '2026-10-29T12:02:00Z')).toBe(false)
    expect(horaDoResumo(new Date('2026-10-30T12:05:00Z'), '2026-10-29T12:02:00Z')).toBe(true)
  })
  it('"tudo ok" sem alertas; lista o que precisa de atenção', () => {
    expect(textoResumo(base({ reqMediaPorMin: 240 }), [])).toMatch(/Tudo ok/)
    expect(textoResumo(base(), avaliar(base({ discoUsadoPct: 75 })))).toMatch(/Disco da VPS/)
  })
})
