import { describe, it, expect } from 'vitest'
import { sanearDados } from './auditoria'

describe('sanearDados', () => {
  it('mantém campos simples', () => {
    expect(sanearDados({ mesa: 'Mesa 01', itens: 3, ok: true })).toEqual({ mesa: 'Mesa 01', itens: 3, ok: true })
  })

  it('remove qualquer coisa que pareça segredo', () => {
    const saida = sanearDados({
      mesa: 'Mesa 01',
      senha: 'hunter2',
      password: 'x',
      token: 'abc',
      cookie: 'y',
      secret: 'z',
      apiKey: 'k',
      authorization: 'Bearer ...',
    })
    expect(saida).toEqual({ mesa: 'Mesa 01' })
  })

  it('remove e-mail e telefone — auditoria registra quem fez, não dado pessoal', () => {
    expect(sanearDados({ acao: 'x', email: 'a@b.c', telefone: '5527999990000' })).toEqual({ acao: 'x' })
  })

  it('pega a chave proibida mesmo embutida no nome', () => {
    expect(sanearDados({ senhaNova: '1', tokenDeAcesso: '2', emailCliente: '3', ok: 1 })).toEqual({ ok: 1 })
  })

  it('limpa também um nível aninhado', () => {
    expect(sanearDados({ alvo: { nome: 'João', senha: 'x' } })).toEqual({ alvo: { nome: 'João' } })
  })

  it('descarta arrays — o que importa é o resumo, não o conteúdo', () => {
    expect(sanearDados({ itens: [{ nome: 'a' }], qtd: 1 })).toEqual({ qtd: 1 })
  })

  it('para de descer depois de alguns níveis', () => {
    const fundo = { a: { b: { c: { d: { e: 'muito fundo' } } } } }
    expect(JSON.stringify(sanearDados(fundo))).not.toContain('muito fundo')
  })

  it('corta texto longo', () => {
    expect((sanearDados({ obs: 'x'.repeat(900) }).obs as string)).toHaveLength(200)
  })

  it('aguenta lixo', () => {
    for (const v of [null, undefined, 'texto', 42, []]) expect(sanearDados(v)).toEqual({})
  })
})
