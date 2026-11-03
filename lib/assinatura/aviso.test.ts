import { describe, expect, it } from 'vitest'
import { avisoDaAssinatura } from './aviso'

/** 03/11/2026: faixa no topo do painel quando a mensalidade venceu e a loja está na carência (ou o Asaas avisou atraso). */
const agora = Date.parse('2026-12-04T15:00:00Z')
describe('avisoDaAssinatura', () => {
  it('venceu e ainda dentro da validade (carência) → aviso com a data limite e a fatura', () => {
    const a = avisoDaAssinatura({ status: 'em_dia', proximoVencimento: '2026-12-02', acessoExpiraEm: '2026-12-08T02:59:59.000Z', faturaUrl: 'https://f' }, agora)
    expect(a).toEqual({ tipo: 'carencia', ateIso: '2026-12-08T02:59:59.000Z', faturaUrl: 'https://f' })
  })
  it('Asaas marcou atrasada → aviso mesmo antes do vencimento calculado', () => {
    expect(avisoDaAssinatura({ status: 'atrasada', proximoVencimento: '2026-12-10', acessoExpiraEm: '2026-12-15T02:59:59.000Z', faturaUrl: null }, agora)?.tipo).toBe('carencia')
  })
  it('em dia e antes do vencimento, vitalícia, ou sem assinatura → sem aviso', () => {
    expect(avisoDaAssinatura({ status: 'em_dia', proximoVencimento: '2026-12-10', acessoExpiraEm: '2027-01-15T02:59:59.000Z', faturaUrl: null }, agora)).toBeNull()
    expect(avisoDaAssinatura({ status: 'em_dia', proximoVencimento: '2026-12-02', acessoExpiraEm: null, faturaUrl: null }, agora)).toBeNull()
    expect(avisoDaAssinatura(null, agora)).toBeNull()
  })
  it('cancelada → sem aviso de carência (quem cancelou não é cobrado pelo painel)', () => {
    expect(avisoDaAssinatura({ status: 'cancelada', proximoVencimento: '2026-12-02', acessoExpiraEm: '2026-12-08T02:59:59.000Z', faturaUrl: null }, agora)).toBeNull()
  })
})
