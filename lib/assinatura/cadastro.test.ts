import { describe, expect, it } from 'vitest'
import { documentoValido, validarAssinar } from './cadastro'

const base = { plano: 'completo', nome: 'Dona Maria', nomeLoja: 'Burger da Maria', email: 'Maria@Exemplo.com', telefone: '(27) 99999-1234', documento: '529.982.247-25', usuario: 'burgerdamaria', senha: 'segredo1' }

describe('documentoValido', () => {
  it('CPF e CNPJ com dígitos corretos', () => {
    expect(documentoValido('529.982.247-25')).toBe(true)
    expect(documentoValido('52998224725')).toBe(true)
    expect(documentoValido('11.222.333/0001-81')).toBe(true)
  })
  it('recusa dígito errado, repetição e tamanho fora', () => {
    expect(documentoValido('529.982.247-26')).toBe(false)
    expect(documentoValido('111.111.111-11')).toBe(false)
    expect(documentoValido('11.222.333/0001-82')).toBe(false)
    expect(documentoValido('123')).toBe(false)
  })
})

describe('validarAssinar', () => {
  it('normaliza e aceita', () => {
    const r = validarAssinar(base, 'segredo1')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.dados).toEqual({ plano: 'completo', nome: 'Dona Maria', nomeLoja: 'Burger da Maria', email: 'maria@exemplo.com', telefone: '27999991234', documento: '52998224725', usuario: 'burgerdamaria', senha: 'segredo1' })
  })
  it('cada regra tem a sua mensagem', () => {
    expect(validarAssinar({ ...base, plano: 'ouro' }, 'segredo1')).toEqual({ ok: false, erro: 'Escolha um plano.' })
    expect(validarAssinar({ ...base, nome: '' }, 'segredo1')).toEqual({ ok: false, erro: 'Preencha todos os campos.' })
    expect(validarAssinar({ ...base, email: 'sem-arroba' }, 'segredo1')).toEqual({ ok: false, erro: 'E-mail inválido.' })
    expect(validarAssinar({ ...base, telefone: '999' }, 'segredo1')).toEqual({ ok: false, erro: 'Celular inválido. Use DDD + número.' })
    expect(validarAssinar({ ...base, documento: '123' }, 'segredo1')).toEqual({ ok: false, erro: 'CPF ou CNPJ inválido.' })
    expect(validarAssinar({ ...base, usuario: 'a' }, 'segredo1').ok).toBe(false)
    expect(validarAssinar({ ...base, senha: '123' }, '123')).toEqual({ ok: false, erro: 'A senha deve ter no mínimo 6 caracteres.' })
    expect(validarAssinar(base, 'outra')).toEqual({ ok: false, erro: 'As senhas não coincidem.' })
  })
})
