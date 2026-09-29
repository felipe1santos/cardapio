import { describe, expect, it } from 'vitest'
import { nomeInstancia } from './evolution'

describe('nome de instância nova do WhatsApp', () => {
  it('é aleatório e não carrega o id da loja', () => {
    const a = nomeInstancia()
    const b = nomeInstancia()
    expect(a).toMatch(/^menuzia-[0-9a-f]{24}$/)
    expect(a).not.toBe(b)
  })
})
