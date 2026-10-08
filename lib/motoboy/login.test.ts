import { describe, expect, it } from 'vitest'
import { nomeComparavel, usuarioDoNome } from './login'

describe('login do motoboy por nome', () => {
  it('acento, maiúscula e espaço não importam', () => {
    expect(nomeComparavel('  João   da Silva ')).toBe(nomeComparavel('JOAO DA SILVA'))
    expect(nomeComparavel('José-Maria')).toBe('jose maria')
  })
  it('usuário técnico a partir do nome', () => {
    expect(usuarioDoNome('João da Silva')).toBe('joao.da.silva')
    expect(usuarioDoNome('!!!')).toBe('motoboy')
  })
})
