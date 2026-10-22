import { describe, expect, it, vi } from 'vitest'

// 22/10: o "Conectar" testa ANTES de ligar; com a integração desligada o teste recusava ("está desligado") e a loja
// nunca conseguia religar. O teste de conexão não exige ligado; cotar/chamar continuam exigindo.
const cfgDesligada = { ativo: false, ambiente: 'producao', contaId: 'b82dec7e-0000', chaves: { apiKey: 'cid', apiSecret: 'sec' } }
vi.mock('./queries', async (orig) => ({ ...(await orig<typeof import('./queries')>()), buscarConfig: vi.fn(async () => cfgDesligada) }))

const { configProvedorPronta } = await import('./provedores')
const admin = {} as never

describe('configProvedorPronta com a integração desligada', () => {
  it('cotar/chamar: recusa', async () => {
    await expect(configProvedorPronta(admin, 'loja', 'uber')).rejects.toThrow(/desligado/)
  })
  it('testar a conexão: aceita e devolve a conta', async () => {
    const r = await configProvedorPronta(admin, 'loja', 'uber', { exigirLigado: false })
    expect(r.contaUber).toMatchObject({ customerId: 'b82dec7e-0000', clientId: 'cid', teste: false })
  })
})
