import { describe, expect, it } from 'vitest'
import { limparRotulo, normalizarLoteEventos, origemDoReferrer } from './vitrine-eventos'
import { diasDoIntervalo, formatarDuracao, funilDaVitrine, resumoEntrega } from './dashboard-metricas'

const AGORA = new Date(2026, 8, 23, 15, 0).getTime()
const base = { visitanteId: 'abcdef123456', sessaoId: 'sessao987654' }

describe('normalizarLoteEventos', () => {
  it('descarta lote sem ids válidos', () => {
    expect(normalizarLoteEventos({ ...base, visitanteId: 'x', eventos: [{ tipo: 'visita' }] }, AGORA)).toEqual([])
    expect(normalizarLoteEventos(null, AGORA)).toEqual([])
  })

  it('descarta evento de tipo desconhecido e clique sem rótulo', () => {
    const r = normalizarLoteEventos({ ...base, eventos: [{ tipo: 'hack' }, { tipo: 'clique', alvo: '  ' }, { tipo: 'checkout' }] }, AGORA)
    expect(r.map((e) => e.tipo)).toEqual(['checkout'])
  })

  it('usa a idade do evento em vez do relógio do aparelho, com teto de 15 min', () => {
    const [a, b] = normalizarLoteEventos({ ...base, eventos: [{ tipo: 'sacola', idade: 3000 }, { tipo: 'sacola', idade: 99e9 }] }, AGORA)
    expect(new Date(a.criado_em).getTime()).toBe(AGORA - 3000)
    expect(new Date(b.criado_em).getTime()).toBe(AGORA - 15 * 60_000)
  })

  it('só aceita item_id em formato uuid e origem só na visita', () => {
    const [v, s] = normalizarLoteEventos(
      { ...base, eventos: [{ tipo: 'visita', origem: 'instagram.com', itemId: 'x' }, { tipo: 'sacola', origem: 'y', itemId: '6f1c2a4e-1b2c-4d5e-8f90-123456789abc' }] },
      AGORA,
    )
    expect(v.origem).toBe('instagram.com')
    expect(v.item_id).toBeNull()
    expect(s.origem).toBeNull()
    expect(s.item_id).toBe('6f1c2a4e-1b2c-4d5e-8f90-123456789abc')
  })

  it('corta o lote em 50 eventos', () => {
    const eventos = Array.from({ length: 80 }, () => ({ tipo: 'clique', alvo: 'Promoções' }))
    expect(normalizarLoteEventos({ ...base, eventos }, AGORA)).toHaveLength(50)
  })
})

describe('limparRotulo', () => {
  it('esconde telefone, CEP e e-mail', () => {
    expect(limparRotulo('Enviar para (27) 99999-1234')).toBe('Enviar para #')
    expect(limparRotulo('CEP 29100-000')).toBe('CEP #')
    expect(limparRotulo('fulano@x.com')).toBeNull()
  })
  it('tira valores e contadores para o mesmo botão somar numa linha só', () => {
    expect(limparRotulo('Adicionar  R$ 32,90')).toBe('Adicionar')
    expect(limparRotulo('Continuar para pagamento R$ 1.017,40')).toBe('Continuar para pagamento')
    expect(limparRotulo('Bacon + R$ 3,50')).toBe('Bacon')
    expect(limparRotulo('Sacola 12 R$ 22,40')).toBe('Sacola')
    expect(limparRotulo('Coca-Cola 600ml')).toBe('Coca-Cola 600ml')
  })
  it('corta rótulo longo', () => {
    expect(limparRotulo('a'.repeat(80))?.length).toBe(48)
  })
})

describe('origemDoReferrer', () => {
  it('interno ou vazio é Direto; utm tem prioridade', () => {
    expect(origemDoReferrer('', 'app.menuzia.com.br')).toBe('Direto')
    expect(origemDoReferrer('https://app.menuzia.com.br/loja/x', 'app.menuzia.com.br')).toBe('Direto')
    expect(origemDoReferrer('https://www.google.com/', 'app.menuzia.com.br')).toBe('google.com')
    expect(origemDoReferrer('https://l.instagram.com/', 'app.menuzia.com.br', 'WhatsApp')).toBe('whatsapp')
  })
})

describe('funilDaVitrine', () => {
  it('calcula participação, rampa e série diária', () => {
    const dias = ['2026-09-22', '2026-09-23']
    const f = funilDaVitrine(
      {
        funil: { visita: 200, visualizacao: 100, sacola: 50, checkout: 40, pedido: 20 },
        funilAnterior: { visita: 100, visualizacao: 60, sacola: 0, checkout: 0, pedido: 10 },
        porDia: [
          { dia: '2026-09-23', tipo: 'visita', qtd: 120 },
          { dia: '2026-09-22', tipo: 'visita', qtd: 80 },
        ],
      },
      dias,
    )
    expect(f.map((e) => e.pct)).toEqual([100, 50, 25, 20, 10])
    expect(f[0].pctProxima).toBe(50)
    expect(f[4].pctProxima).toBe(10)
    expect(f[0].variacao).toBe(100)
    expect(f[2].variacao).toBeNull()
    expect(f[1].pctAnterior).toBe(60)
    expect(f[0].serie).toEqual([80, 120])
  })

  it('sem visitas não divide por zero', () => {
    const f = funilDaVitrine({ funil: {}, funilAnterior: {}, porDia: [] }, ['2026-09-23'])
    expect(f.every((e) => e.pct === 0 && e.pctAnterior === null)).toBe(true)
  })
})

describe('diasDoIntervalo', () => {
  it('não passa de hoje', () => {
    const inicio = new Date(2026, 8, 20).getTime()
    const dias = diasDoIntervalo({ inicio, fim: new Date(2026, 8, 27).getTime() }, AGORA)
    expect(dias).toEqual(['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23'])
  })
})

describe('resumoEntrega', () => {
  const intervalo = { inicio: new Date(2026, 8, 23).getTime(), fim: new Date(2026, 8, 24).getTime() }
  const t = (h: number, m: number) => new Date(2026, 8, 23, h, m).toISOString()

  it('média só das entregas do período e ignora rota esquecida', () => {
    const r = resumoEntrega(
      [
        { criadoEm: t(12, 0), emRotaEm: t(12, 30), entregueEm: t(12, 50) }, // 20 min de rota
        { criadoEm: t(13, 0), emRotaEm: t(13, 20), entregueEm: t(13, 50) }, // 30 min
        { criadoEm: t(1, 0), emRotaEm: t(1, 10), entregueEm: t(9, 0) }, // esquecido: fora
        { criadoEm: '2026-09-20T12:00:00Z', emRotaEm: '2026-09-20T12:10:00Z', entregueEm: '2026-09-20T12:30:00Z' }, // outro dia
      ],
      intervalo,
    )
    expect(r.amostra).toBe(2)
    expect(r.rota).toBe(25 * 60)
    expect(r.total).toBe(50 * 60)
  })

  it('sem amostra devolve null', () => {
    expect(resumoEntrega([], intervalo)).toEqual({ rota: null, total: null, amostra: 0 })
  })
})

describe('formatarDuracao', () => {
  it('escolhe a unidade pelo tamanho', () => {
    expect(formatarDuracao(null)).toBe('—')
    expect(formatarDuracao(45)).toBe('45s')
    expect(formatarDuracao(84)).toBe('1min 24s')
    expect(formatarDuracao(38 * 60)).toBe('38min')
    expect(formatarDuracao(65 * 60)).toBe('1h 05min')
  })
})
