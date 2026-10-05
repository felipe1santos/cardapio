import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { cifrar, decifrar, criptografiaPronta } from './cripto'
import { assinarComoMp, assinaturaMpValida, manifestoMp } from './assinatura-mp'

describe('criptografia dos tokens', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('cifra e decifra; a cifra não contém o texto e muda a cada vez', () => {
    vi.stubEnv('PAGAMENTOS_CHAVE', randomBytes(32).toString('base64'))
    const token = 'APP_USR-1234567890-segredo'
    const a = cifrar(token), b = cifrar(token)
    expect(a).not.toContain('segredo')
    expect(a).not.toBe(b)
    expect(decifrar(a)).toBe(token)
  })
  it('cifra adulterada ou chave trocada: falha (nunca devolve lixo)', () => {
    vi.stubEnv('PAGAMENTOS_CHAVE', randomBytes(32).toString('base64'))
    const a = cifrar('token')
    const partes = a.split('.'); partes[3] = Buffer.from('outro').toString('base64url')
    expect(() => decifrar(partes.join('.'))).toThrow()
    vi.stubEnv('PAGAMENTOS_CHAVE', randomBytes(32).toString('base64'))
    expect(() => decifrar(a)).toThrow()
  })
  it('sem chave ou chave curta: não está pronta', () => {
    vi.stubEnv('PAGAMENTOS_CHAVE', '')
    expect(criptografiaPronta()).toBe(false)
    vi.stubEnv('PAGAMENTOS_CHAVE', Buffer.from('curta').toString('base64'))
    expect(criptografiaPronta()).toBe(false)
  })
})

describe('assinatura do webhook do Mercado Pago', () => {
  const segredo = 'segredo-do-webhook'
  const agora = 1_759_600_000_000
  it('manifesto no formato do MP (id em minúsculas)', () => {
    expect(manifestoMp({ dataId: 'ABC123', requestId: 'req-1', ts: '1' })).toBe('id:abc123;request-id:req-1;ts:1;')
    expect(manifestoMp({ dataId: null, requestId: null, ts: '1' })).toBe('ts:1;')
  })
  it('aceita a assinatura certa', () => {
    const x = assinarComoMp({ dataId: '987', requestId: 'r1', ts: String(agora), segredo })
    expect(assinaturaMpValida({ xSignature: x, requestId: 'r1', dataId: '987', segredo, agoraMs: agora })).toBe(true)
  })
  it('recusa: segredo errado, id trocado, request-id trocado, ts velho, sem cabeçalho, sem segredo', () => {
    const x = assinarComoMp({ dataId: '987', requestId: 'r1', ts: String(agora), segredo })
    expect(assinaturaMpValida({ xSignature: x, requestId: 'r1', dataId: '987', segredo: 'outro', agoraMs: agora })).toBe(false)
    expect(assinaturaMpValida({ xSignature: x, requestId: 'r1', dataId: '988', segredo, agoraMs: agora })).toBe(false)
    expect(assinaturaMpValida({ xSignature: x, requestId: 'r2', dataId: '987', segredo, agoraMs: agora })).toBe(false)
    expect(assinaturaMpValida({ xSignature: x, requestId: 'r1', dataId: '987', segredo, agoraMs: agora + 11 * 60_000 })).toBe(false)
    expect(assinaturaMpValida({ xSignature: null, requestId: 'r1', dataId: '987', segredo, agoraMs: agora })).toBe(false)
    expect(assinaturaMpValida({ xSignature: x, requestId: 'r1', dataId: '987', segredo: undefined, agoraMs: agora })).toBe(false)
    expect(assinaturaMpValida({ xSignature: 'ts=1,v1=zz', requestId: 'r1', dataId: '987', segredo, agoraMs: agora })).toBe(false)
  })
})

describe('Pix online: conferência do pagamento (antifraude)', async () => {
  const { divergencias, expiracaoMp } = await import('./pix-online')
  const base = { id: '1', status: 'approved', statusDetail: null, externalReference: 'ped-1', valor: 42.5, moeda: 'BRL', coletorId: '9001', taxa: 0.42, liquido: 42.08, aprovadoEm: null, metodo: 'pix' }
  const reg = { pedido_id: 'ped-1', valor: 42.5, mp_user_id: '9001' }
  it('tudo certo: nenhuma divergência', () => { expect(divergencias(base, reg, '9001', 42.5)).toEqual([]) })
  it('valor alterado (no MP ou no pedido): diverge', () => {
    expect(divergencias({ ...base, valor: 1 }, reg, '9001', 42.5)).toContain('valor')
    expect(divergencias(base, reg, '9001', 50)).toContain('valor')
  })
  it('pagamento de OUTRA loja (coletor diferente) ou de outro pedido: diverge', () => {
    expect(divergencias({ ...base, coletorId: '7777' }, reg, '9001', 42.5)).toContain('coletor')
    expect(divergencias({ ...base, externalReference: 'ped-2' }, reg, '9001', 42.5)).toContain('referencia')
  })
  it('moeda e método errados: diverge', () => {
    expect(divergencias({ ...base, moeda: 'USD' }, reg, '9001', 42.5)).toContain('moeda')
    expect(divergencias({ ...base, metodo: 'credit_card' }, reg, '9001', 42.5)).toContain('metodo')
  })
  it('expiração no fuso de São Paulo', () => {
    expect(expiracaoMp(new Date('2026-10-05T02:15:00.000Z'))).toBe('2026-10-04T23:15:00.000-03:00')
  })
})
