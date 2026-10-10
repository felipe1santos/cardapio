import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _zerarGuarda } from './guarda'
import { agregarIa, chamarIa, custoMicroUsd, limitesIa, type LinhaIa } from './ia'
import { diaSP } from './uso'

describe('custo da IA', () => {
  it('preço por modelo (US$ por 1M tokens) em micro-dólares', () => {
    // gpt-4o-mini: 0,15 entrada + 0,60 saída → 1M+1M = US$ 0,75
    expect(custoMicroUsd('gpt-4o-mini', 1_000_000, 1_000_000, {})).toBe(750_000)
    expect(custoMicroUsd('gpt-4o-mini', 1000, 500, {})).toBe(450) // 150 + 300
  })
  it('modelo com data usa o preço da família; desconhecido cobra como o mais caro', () => {
    expect(custoMicroUsd('gpt-4o-mini-2024-07-18', 1000, 0, {})).toBe(150)
    expect(custoMicroUsd('modelo-novo', 1000, 1000, {})).toBe(12_500)
  })
  it('IA_PRECOS no Coolify sobrepõe a tabela', () => {
    expect(custoMicroUsd('gpt-x', 1000, 1000, { IA_PRECOS: '{"gpt-x":[1,2]}' })).toBe(3000)
    expect(custoMicroUsd('gpt-4o-mini', 1000, 0, { IA_PRECOS: 'quebrado' })).toBe(150)
  })
  it('limites com padrão seguro', () => {
    expect(limitesIa({})).toMatchObject({ usdDia: 5, usdDiaLoja: 1, chamadasDia: 2000, cotacao: 5.5 })
    expect(limitesIa({ LIMITE_IA_USD_DIA: '10', COTACAO_DOLAR: 'x' })).toMatchObject({ usdDia: 10, cotacao: 5.5 })
  })
})

describe('agregação para o Super Admin', () => {
  const l = (dia: string, escopo: string, custo: number, chamadas = 1, modelo = 'gpt-4o-mini'): LinhaIa =>
    ({ dia, escopo, modelo, chamadas, tokens_entrada: 100, tokens_saida: 50, custo_micro_usd: custo })
  it('hoje, mês (sem o mês passado), por loja, por modelo e 7 dias', () => {
    const r = agregarIa([
      l('2026-10-10', 'total', 300, 3), l('2026-10-10', 'L1', 200, 2), l('2026-10-10', 'L2', 100, 1),
      l('2026-10-02', 'total', 1000, 5, 'gpt-4o'), l('2026-10-02', 'L1', 1000, 5, 'gpt-4o'),
      l('2026-09-30', 'total', 9999, 9), l('2026-09-30', 'L1', 9999, 9),
    ], '2026-10-10')
    expect(r.hoje).toMatchObject({ chamadas: 3, custoMicroUsd: 300 })
    expect(r.mes).toMatchObject({ chamadas: 8, custoMicroUsd: 1300 })
    expect(r.porLoja.L1).toMatchObject({ hoje: { custoMicroUsd: 200 }, mes: { custoMicroUsd: 1200, chamadas: 7 } })
    expect(r.porModeloMes['gpt-4o'].custoMicroUsd).toBe(1000)
    expect(r.ultimos7.map((d) => d.custoMicroUsd)).toEqual([0, 0, 0, 0, 0, 0, 300])
  })
})

/** Banco falso: gasto do dia em ia_uso_dia, guarda sem limite, registra o rpc. */
function banco(gastoTotal: number, gastoLoja: number) {
  const rpcs: { fn: string; p: Record<string, unknown> }[] = []
  const inseridos: unknown[] = []
  const admin = {
    rpc: vi.fn(async (fn: string, p: Record<string, unknown>) => {
      rpcs.push({ fn, p })
      if (fn === 'api_uso_contar') return { data: { permitido: true, chamadas: 1, limite: 2000 }, error: null }
      return { data: null, error: null }
    }),
    from: (t: string) => ({
      select: () => ({
        eq: (_c: string, _v: string) => ({
          eq: (_c2: string, escopo: string) => ({
            limit: async () => ({ data: t === 'ia_uso_dia' ? [{ custo_micro_usd: escopo === 'total' ? gastoTotal : gastoLoja }] : [], error: null }),
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
      insert: async (v: unknown) => { inseridos.push(v); return { error: null } },
      update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({}) }) }) }),
    }),
  }
  return { admin: admin as never, rpcs, inseridos }
}

beforeEach(() => _zerarGuarda())

describe('chamarIa: teto em dinheiro + guarda + registro', () => {
  it('chama, registra tokens e custo reais por loja', async () => {
    const b = banco(0, 0)
    const fn = vi.fn(async () => ({ valor: 'resposta', modelo: 'gpt-4o-mini', tokensEntrada: 1000, tokensSaida: 500 }))
    const r = await chamarIa(b.admin, { loja: 'L1', conversa: 'c1' }, fn)
    expect(r).toEqual({ ok: true, valor: 'resposta', custoMicroUsd: 450 })
    const reg = b.rpcs.find((x) => x.fn === 'ia_uso_registrar')!
    expect(reg.p).toMatchObject({ p_loja: 'L1', p_modelo: 'gpt-4o-mini', p_tokens_entrada: 1000, p_tokens_saida: 500, p_custo_micro_usd: 450 })
    expect(diaSP()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('teto do sistema atingido: NÃO chama a IA e alerta', async () => {
    const b = banco(5_000_000, 0)
    const fn = vi.fn()
    expect(await chamarIa(b.admin, { loja: 'L1', conversa: 'c1' }, fn)).toEqual({ ok: false, motivo: 'teto' })
    expect(fn).not.toHaveBeenCalled()
    expect(b.inseridos.some((a) => (a as { nivel: string }).nivel === 'bloqueio')).toBe(true)
  })
  it('teto da loja atingido: NÃO chama (outra loja continua podendo)', async () => {
    const fn = vi.fn(async () => ({ valor: 1, modelo: 'gpt-4o-mini', tokensEntrada: 1, tokensSaida: 1 }))
    expect(await chamarIa(banco(10, 1_000_000).admin, { loja: 'L1', conversa: 'c' }, fn)).toEqual({ ok: false, motivo: 'teto' })
    expect(fn).not.toHaveBeenCalled()
  })
})
