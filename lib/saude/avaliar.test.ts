import { describe, expect, it } from 'vitest'
import { assistentesFora, avaliar, cronsAtrasados, horaDoResumo, medidasVazias, podeEnviar, referenciaReq, textoResumo, type Medidas } from './avaliar'

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
    const mh = { reqReferenciaMesmoHorario: true }
    expect(assuntos(base({ reqPorMin: 500, reqMediaPorMin: 240, ...mh }))).toEqual(['requisicoes:amarelo'])
    expect(assuntos(base({ reqPorMin: 1000, reqMediaPorMin: 240, ...mh }))).toEqual(['requisicoes:vermelho'])
    expect(assuntos(base({ reqPorMin: 40, reqMediaPorMin: 10, ...mh }))).toEqual([])
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
    // WhatsApp de loja caído NÃO vira alerta do vigia (28/10): o aviso é único e sai do monitor quando ela cai.
    expect(assuntos(m)).toEqual(['cron-pix-online:vermelho'])
  })
})

describe('Assistente de impressão desligado com a loja aberta (29/10)', () => {
  it('vira alerta vermelho por loja, com os minutos', () => {
    const a = avaliar(base({ assistentesFora: [{ loja: 'Villa', minutos: 42 }] }))
    expect(a.map((x) => `${x.assunto}:${x.nivel}`)).toEqual(['assistente-Villa:vermelho'])
    expect(a[0].texto).toMatch(/42 min/)
    expect(a[0].texto).toMatch(/impressora/)
  })
})

describe('assistentesFora (quem entra no alerta)', () => {
  const agora = Date.parse('2026-10-29T23:00:00Z')
  const min = (m: number) => new Date(agora - m * 60_000).toISOString()
  it('só loja ABERTA, que usou o Assistente nos últimos 7 dias, sem sinal há 15 min ou mais', () => {
    const r = assistentesFora([
      { nome: 'Aberta sem sinal', aberta: true, ultimoSinal: min(40) },
      { nome: 'Aberta com sinal', aberta: true, ultimoSinal: min(1) },
      { nome: 'Fechada', aberta: false, ultimoSinal: min(300) },
      { nome: 'Nunca usou', aberta: true, ultimoSinal: null },
      { nome: 'Abandonou há 10 dias', aberta: true, ultimoSinal: min(10 * 24 * 60) },
      { nome: 'Quase', aberta: true, ultimoSinal: min(14) },
    ], agora)
    expect(r).toEqual([{ loja: 'Aberta sem sinal', minutos: 40 }])
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

describe('referenciaReq (normal do mesmo horário)', () => {
  // Agora = 29/10 21:43Z = 18:43 em São Paulo. Fotos dos dias anteriores: jantar (18:30–19:00 SP) a 400, tarde a 130.
  const agora = Date.parse('2026-10-29T21:43:00Z')
  const foto = (diasAtras: number, horaMinSP: string, rpm: number) => {
    const [h, mi] = horaMinSP.split(':').map(Number)
    const dia = new Date(Date.parse('2026-10-29T00:00:00Z') - diasAtras * 86400_000)
    return { em: new Date(Date.UTC(dia.getUTCFullYear(), dia.getUTCMonth(), dia.getUTCDate(), h + 3, mi)).toISOString(), rpm }
  }
  it('jantar de hoje com jantares anteriores → média só deles, mesmoHorario', () => {
    const fotos = [
      foto(1, '18:20', 380), foto(1, '18:40', 420), foto(2, '18:45', 400), foto(2, '19:00', 400), foto(3, '18:35', 400), foto(3, '19:25', 400),
      foto(1, '15:00', 130), foto(2, '03:00', 70), foto(1, '12:00', 100),
    ]
    expect(referenciaReq(fotos, agora)).toMatchObject({ valor: 400, mesmoHorario: true })
  })
  it('janela atravessa a meia-noite (00:20 usa 23:20–01:20)', () => {
    const a = Date.parse('2026-10-29T03:20:00Z') // 00:20 SP
    const fotos = [foto(2, '23:20', 60), foto(2, '23:50', 60), foto(2, '00:10', 60), foto(2, '01:20', 60), foto(3, '00:40', 60), foto(3, '23:30', 60), foto(2, '12:00', 999), foto(3, '23:10', 999), foto(2, '01:30', 999)]
    expect(referenciaReq(fotos, a)).toMatchObject({ valor: 60, mesmoHorario: true })
  })
  it('poucas amostras do mesmo horário → média geral (fora dos últimos 30 min)', () => {
    const fotos = [foto(1, '18:40', 400), ...Array.from({ length: 14 }, (_, i) => foto(1 + (i % 3), `${String(2 + i).padStart(2, '0')}:00`, 100))]
    const r = referenciaReq(fotos.filter((f) => !f.em.includes('T21:40')), agora)
    expect(r.mesmoHorario).toBe(false)
    expect(r.valor).not.toBeNull()
  })
  it('ignora rpm inválido e fotos dos últimos 30 min na média geral; vazio → null', () => {
    expect(referenciaReq([], agora)).toMatchObject({ valor: null, mesmoHorario: false })
    const recentes = Array.from({ length: 20 }, (_, i) => ({ em: new Date(agora - (i + 1) * 60_000).toISOString(), rpm: 900 })).filter((f) => agora - Date.parse(f.em) < 1800_000)
    expect(referenciaReq([...recentes, { em: foto(2, '10:00', 1).em, rpm: NaN }, { em: foto(2, '10:05', 1).em, rpm: -5 }], agora)).toMatchObject({ valor: null, mesmoHorario: false })
  })
})

describe('referenciaReq.geral (base do egress)', () => {
  it('não muda entre jantar e madrugada com as mesmas fotos', () => {
    const fotos = Array.from({ length: 20 }, (_, i) => ({ em: new Date(Date.parse('2026-10-26T12:00:00Z') + i * 3 * 3600_000).toISOString(), rpm: 50 + (i % 8) * 60 }))
    const jantar = referenciaReq(fotos, Date.parse('2026-10-29T21:43:00Z'))
    const noite = referenciaReq(fotos, Date.parse('2026-10-29T05:10:00Z'))
    expect(jantar.geral).not.toBeNull()
    expect(jantar.geral).toBeCloseTo(noite.geral as number, 6)
  })
})

describe('avaliar requisições com referência do mesmo horário', () => {
  const mh = { reqReferenciaMesmoHorario: true }
  it('377/min contra o normal do jantar (400) → nada', () => {
    expect(assuntos(base({ reqPorMin: 377, reqMediaPorMin: 400, ...mh }))).toEqual([])
  })
  it('377/min contra média geral 181 (2,1×) → nada (limiar do fallback é 4×)', () => {
    expect(assuntos(base({ reqPorMin: 377, reqMediaPorMin: 181 }))).toEqual([])
  })
  it('900 contra 400 do mesmo horário (2,25×) → amarelo', () => {
    expect(assuntos(base({ reqPorMin: 900, reqMediaPorMin: 400, ...mh }))).toEqual(['requisicoes:amarelo'])
  })
  it('1700 contra 400 do mesmo horário → vermelho', () => {
    expect(assuntos(base({ reqPorMin: 1700, reqMediaPorMin: 400, ...mh }))).toEqual(['requisicoes:vermelho'])
  })
  it('800 contra média geral 181 (4,4×) → amarelo; 1500 (8,3×) → vermelho', () => {
    expect(assuntos(base({ reqPorMin: 800, reqMediaPorMin: 181 }))).toEqual(['requisicoes:amarelo'])
    expect(assuntos(base({ reqPorMin: 1500, reqMediaPorMin: 181 }))).toEqual(['requisicoes:vermelho'])
  })
  it('texto diz de qual referência vem', () => {
    expect(avaliar(base({ reqPorMin: 900, reqMediaPorMin: 400, ...mh }))[0].texto).toMatch(/normal deste horário 400\/min, 2\.3×/)
    expect(avaliar(base({ reqPorMin: 800, reqMediaPorMin: 181 }))[0].texto).toMatch(/média geral 181\/min, 4\.4×/)
  })
})
