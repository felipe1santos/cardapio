import { beforeAll, describe, expect, it } from 'vitest'
import { cifrar, decifrar } from './cripto'

beforeAll(() => {
  process.env.PAGAMENTOS_CHAVE = Buffer.alloc(32, 7).toString('base64')
})

describe('cripto dos tokens de pagamento (AES-256-GCM)', () => {
  it('cifra e decifra', () => {
    expect(decifrar(cifrar('token-secreto'))).toBe('token-secreto')
  })

  it('recusa tag de autenticação encurtada (auditoria 10/10: GCM sem conferir o tamanho da tag)', () => {
    const [v, iv, tag, dados] = cifrar('token-secreto').split('.')
    const curta = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url')
    expect(() => decifrar([v, iv, curta, dados].join('.'))).toThrow()
  })

  it('recusa cifra adulterada', () => {
    const [v, iv, tag, dados] = cifrar('token-secreto').split('.')
    const b = Buffer.from(dados, 'base64url'); b[0] ^= 1
    expect(() => decifrar([v, iv, tag, b.toString('base64url')].join('.'))).toThrow()
  })
})
