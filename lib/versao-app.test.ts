import { describe, expect, it } from 'vitest'
import { versaoMudou } from './versao-app'

describe('versão nova do app', () => {
  it('só avisa quando as duas versões existem e são diferentes', () => {
    expect(versaoMudou('a1', 'b2')).toBe(true)
    expect(versaoMudou('a1', 'a1')).toBe(false)
    expect(versaoMudou('', 'b2')).toBe(false)
    expect(versaoMudou('a1', null)).toBe(false)
    expect(versaoMudou(undefined, undefined)).toBe(false)
  })
})
