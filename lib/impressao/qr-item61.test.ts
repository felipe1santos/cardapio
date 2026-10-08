import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/url-publica', () => ({ urlPublica: () => 'https://app.menuzia.com.br' }))
process.env.QR_ROTA_CHAVE = 'teste'
import { qrDaPreConta, qrDaRotaImpressa } from './cozinha-beta'

describe('item 61: QR no papel', () => {
  it('comanda de entrega: QR da rota com "ROTA DE ENTREGA"', () => {
    const q = qrDaRotaImpressa('11111111-1111-4111-8111-111111111111')
    expect(q.origem).toBe('rota')
    expect(q.frase).toBe('ROTA DE ENTREGA')
    expect(q.url).toMatch(/^https:\/\/app\.menuzia\.com\.br\/r\/[A-Za-z0-9_-]{30,40}$/)
  })
  it('pré-conta: Instagram da loja; sem Instagram, sem QR (nunca o cardápio)', () => {
    expect(qrDaPreConta('https://instagram.com/ponto400')?.origem).toBe('instagram')
    expect(qrDaPreConta('https://instagram.com/ponto400')?.url).toBe('https://instagram.com/ponto400')
    expect(qrDaPreConta(null)).toBeNull()
    expect(qrDaPreConta('  ')).toBeNull()
  })
})
