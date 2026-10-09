import { describe, expect, it } from 'vitest'
import { passosAtivacao, podeAtivar, type DadosAtivacao } from './controle-caixa'
import { nivelDe } from './nivel'

const pronto: DadosAtivacao = {
  aprovadoresComPin: ['Dono'], contasAntigas: [], motoboysPendentes: [], entregasEmRota: 0,
  fundoCentavos: 5000, toleranciaCentavos: 200, topComCusto: 3, topTotal: 15,
}
const ok = (d: Partial<DadosAtivacao>) => Object.fromEntries(passosAtivacao({ ...pronto, ...d }).map((p) => [p.id, p.ok]))

describe('ativar controle de caixa (nível 2)', () => {
  it('tudo resolvido → pode ativar, mesmo sem custo cadastrado (passo 5 é recomendado)', () => {
    expect(podeAtivar(passosAtivacao(pronto))).toBe(true)
    expect(ok({}).custo).toBe(false)
  })
  it('cada pendência obrigatória bloqueia', () => {
    for (const d of [
      { aprovadoresComPin: [] },
      { contasAntigas: [{ numero: 31, desde: '2026-10-04T12:00:00Z', totalCentavos: 12550 }] },
      { motoboysPendentes: [{ nome: 'Zé', centavos: 3000 }] },
      { entregasEmRota: 1 },
      { fundoCentavos: null },
    ] as Partial<DadosAtivacao>[]) expect(podeAtivar(passosAtivacao({ ...pronto, ...d }))).toBe(false)
  })
  it('detalhe da conta antiga mostra número e valor', () => {
    const p = passosAtivacao({ ...pronto, contasAntigas: [{ numero: 31, desde: '2026-10-04T12:00:00Z', totalCentavos: 12550 }] }).find((x) => x.id === 'contas')!
    expect(p.detalhe).toContain('#31')
    expect(p.detalhe).toContain('125,50')
  })
  it('custo completo marca o passo 5', () => { expect(ok({ topComCusto: 15 }).custo).toBe(true) })
})

describe('nível do financeiro', () => {
  it('controle só vale com o financeiro ligado', () => {
    expect(nivelDe({ financeiro_ativo: true, controle_caixa_ativo: true })).toEqual({ financeiro: true, controleCaixa: true })
    expect(nivelDe({ financeiro_ativo: true, controle_caixa_ativo: false })).toEqual({ financeiro: true, controleCaixa: false })
    expect(nivelDe({ financeiro_ativo: false, controle_caixa_ativo: true })).toEqual({ financeiro: false, controleCaixa: false })
    expect(nivelDe(null)).toEqual({ financeiro: false, controleCaixa: false })
  })
})
