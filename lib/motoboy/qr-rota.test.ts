import { beforeAll, describe, expect, it } from 'vitest'
import { codigoDaRota, lerEntradaDoQr, pedidoDoCodigo, urlDaRota } from './qr-rota'

const ID = '3a29b36d-f15d-4b14-8760-16df7dbe5911'
beforeAll(() => { process.env.QR_ROTA_CHAVE = 'segredo-de-teste' })

describe('QR da rota (item 59)', () => {
  it('ida e volta: código → pedido', () => {
    const c = codigoDaRota(ID)
    expect(c).toMatch(/^[A-Za-z0-9_-]{35}$/)
    expect(pedidoDoCodigo(c)).toBe(ID)
  })
  it('link sem dado pessoal: só o código no caminho /r/', () => {
    expect(urlDaRota(ID)).toMatch(/\/r\/[A-Za-z0-9_-]{35}$/)
  })
  it('link adulterado é recusado', () => {
    const c = codigoDaRota(ID)
    const trocado = (c[3] === 'A' ? 'B' : 'A')
    expect(pedidoDoCodigo(c.slice(0, 3) + trocado + c.slice(4))).toBeNull()
    expect(pedidoDoCodigo(c.slice(0, -1) + (c.endsWith('A') ? 'B' : 'A'))).toBeNull()
    expect(pedidoDoCodigo('x'.repeat(35))).toBeNull()
    expect(pedidoDoCodigo('')).toBeNull()
  })
  it('outra chave não confere', () => {
    const c = codigoDaRota(ID)
    process.env.QR_ROTA_CHAVE = 'outra'
    expect(pedidoDoCodigo(c)).toBeNull()
    process.env.QR_ROTA_CHAVE = 'segredo-de-teste'
  })
  it('entrada do app: link, código ou número digitado', () => {
    const c = codigoDaRota(ID)
    expect(lerEntradaDoQr(`https://app.menuzia.com.br/r/${c}`)).toEqual({ tipo: 'codigo', pedidoId: ID })
    expect(lerEntradaDoQr(c)).toEqual({ tipo: 'codigo', pedidoId: ID })
    expect(lerEntradaDoQr('#172')).toEqual({ tipo: 'numero', numero: 172 })
    expect(lerEntradaDoQr('https://instagram.com/loja')).toBeNull()
  })
})
