import { describe, expect, it } from 'vitest'
import { postgrestFalso } from '@/lib/teste/postgrest-falso'
import { lerGastoLojas } from './gasto-lojas'
import { lerUsoIa } from './ia'
import { lerUsoApis } from './uso'

/**
 * 01/11/2026 (Fase 4 da auditoria de infraestrutura): o PostgREST devolve no máximo 1.000 linhas por resposta
 * (max_rows, supabase/config.toml) — `.limit(20000)` não muda isso. As leituras do mês do Super Admin passavam de
 * 1.000 linhas perto do dia 26 e erravam em silêncio. Este banco falso corta como o PostgREST: `.limit(n)` devolve
 * no máximo 1.000; `.range(de, ate)` devolve a fatia pedida.
 */
const agora = new Date('2026-10-27T15:00:00Z')
const dias = (n: number) => Array.from({ length: n }, (_, i) => `2026-10-${String(1 + (i % 26)).padStart(2, '0')}`)

describe('leituras do mês do Super Admin pagina além de 1.000 linhas', () => {
  it('lerGastoLojas: 1.300 linhas de geocoding (1 chamada cada) somam 1.300 no mês', async () => {
    const api = dias(1300).map((dia) => ({ dia, escopo: 'L1', api: 'geocoding', chamadas: 1 }))
    const admin = postgrestFalso({ api_uso_dia: api, ia_uso_dia: [] })
    const r = await lerGastoLojas(admin, ['L1'], agora)
    expect(r.lojas[0].mes.geocoding).toBe(1300)
  })
  it('lerUsoIa: 1.200 linhas do mês somam 1.200 respostas; cotação vem do Super Admin (plataforma_config)', async () => {
    const ia = dias(1200).map((dia) => ({ dia, escopo: 'total', modelo: 'claude-haiku-5-5', chamadas: 1, tokens_entrada: 1, tokens_saida: 1, custo_micro_usd: 10 }))
    const admin = postgrestFalso({ ia_uso_dia: ia, api_uso_dia: [], whatsapp_robo_config: [] }, { plataforma_config: { valor: 6.2 } })
    const r = await lerUsoIa(admin, agora)
    expect(r.mes.chamadas).toBe(1200)
    expect(r.limites.cotacao).toBe(6.2)
  })
  it('lerUsoApis: 1.100 linhas de hoje (1 por loja) somam 1.100 no total do dia', async () => {
    const hoje = '2026-10-27'
    const linhas = Array.from({ length: 1100 }, (_, i) => ({ api: 'maps_js', escopo: i === 0 ? 'total' : `L${i}`, dia: hoje, chamadas: i === 0 ? 1100 : 1 }))
    const admin = postgrestFalso({ api_uso_dia: linhas, api_alertas: [] })
    const r = await lerUsoApis(admin, agora)
    expect(r.total.maps_js).toBe(1100)
    expect(Object.keys(r.porLoja)).toHaveLength(1099)
  })
})
