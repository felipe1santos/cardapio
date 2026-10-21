import { describe, expect, it } from 'vitest'
import { SENHA_PADRAO, estaComSenhaPadrao, loginParaMostrar, temGoogleVinculado, textoDoReset } from './senha-padrao'

describe('senha padrão (reset pelo Super Admin)', () => {
  it('só a marca true no app_metadata conta', () => {
    expect(estaComSenhaPadrao({ app_metadata: { senha_padrao: true } })).toBe(true)
    expect(estaComSenhaPadrao({ app_metadata: { senha_padrao: false } })).toBe(false)
    expect(estaComSenhaPadrao({ app_metadata: { senha_padrao: 'true' } })).toBe(false)
    expect(estaComSenhaPadrao({ app_metadata: {} })).toBe(false)
    expect(estaComSenhaPadrao(null)).toBe(false)
  })

  it('dono aparece pelo e-mail; equipe pelo usuário (e-mail sintético ninguém digita)', () => {
    expect(loginParaMostrar({ email: 'dono@loja.com', usuario: 'dono' })).toEqual({ rotulo: 'E-mail', valor: 'dono@loja.com' })
    expect(loginParaMostrar({ email: 'joao.ab12cd34@equipe.menuzia.local', usuario: 'joao' })).toEqual({ rotulo: 'Usuário', valor: 'joao' })
  })

  it('texto para copiar', () => {
    expect(SENHA_PADRAO).toBe('123456')
    expect(textoDoReset({ rotulo: 'E-mail', valor: 'x@y.com' })).toBe('E-mail: x@y.com · Senha: 123456')
  })

  it('Google vinculado pela identidade', () => {
    expect(temGoogleVinculado({ identities: [{ provider: 'email' }, { provider: 'google' }] })).toBe(true)
    expect(temGoogleVinculado({ identities: [{ provider: 'email' }] })).toBe(false)
    expect(temGoogleVinculado(null)).toBe(false)
  })
})
