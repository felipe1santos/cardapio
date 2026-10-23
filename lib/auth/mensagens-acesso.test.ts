import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MSG_LOGIN_INVALIDO, falhaDeCredencial, resultadoRecuperacao } from './mensagens-acesso'

describe('login e recuperação não revelam se a conta existe', () => {
  it('recuperação: qualquer erro (inclusive "usuário não encontrado") vira "enviamos"; só o limite de tentativas avisa', () => {
    expect(resultadoRecuperacao(null)).toBe('enviado')
    expect(resultadoRecuperacao({ status: 400 })).toBe('enviado')
    expect(resultadoRecuperacao({ status: 404 })).toBe('enviado')
    expect(resultadoRecuperacao({ status: 500 })).toBe('enviado')
    expect(resultadoRecuperacao({ status: 429 })).toBe('limite')
  })
  it('login: usuário inexistente e senha errada usam a MESMA mensagem; o texto cru do provedor nunca aparece', () => {
    const src = readFileSync('app/(auth)/login/actions.ts', 'utf8')
    expect(src).not.toMatch(/Usuário ou senha inválidos/)
    expect((src.match(/MSG_LOGIN_INVALIDO/g) ?? []).length).toBeGreaterThanOrEqual(3) // import + os 2 casos
    expect(MSG_LOGIN_INVALIDO).toBe('Login ou senha inválidos.')
    const rec = readFileSync('app/(auth)/recuperar-senha/actions.ts', 'utf8')
    expect(rec).not.toMatch(/error\.message/)
  })
})

describe('limite de tentativas só conta senha errada (queda do Supabase em 23/10)', () => {
  it('credencial recusada (400) conta; servidor fora, tempo esgotado ou erro de rede não contam', () => {
    expect(falhaDeCredencial({ status: 400 })).toBe(true)
    expect(falhaDeCredencial({ status: 0 })).toBe(false)
    expect(falhaDeCredencial({ status: 500 })).toBe(false)
    expect(falhaDeCredencial({ status: 504 })).toBe(false)
    expect(falhaDeCredencial({ status: 429 })).toBe(false)
    expect(falhaDeCredencial({})).toBe(false)
  })
})
