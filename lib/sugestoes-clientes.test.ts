import { describe, expect, it } from 'vitest'
import { sugestoesDeClientes } from './sugestoes-clientes'

const L = (nome: string, tel: string, em: string) => ({ cliente_nome: nome, cliente_telefone: tel, criado_em: em })

describe('sugestoesDeClientes', () => {
  const linhas = [
    L('João Silva', '5527999990001', '2026-09-01T10:00:00Z'),
    L('João S.', '5527999990001', '2026-09-20T10:00:00Z'),
    L('Maria João', '5527999990002', '2026-09-25T10:00:00Z'),
    L('Cliente Balcão', '5527999990003', '2026-09-26T10:00:00Z'),
    L('Sem telefone', '', '2026-09-26T10:00:00Z'),
  ]
  it('agrupa por telefone (nome mais recente) e ignora genéricos/sem telefone', () => {
    const r = sugestoesDeClientes(linhas, 'jo')
    expect(r.map((s) => s.nome)).toEqual(['João S.', 'Maria João'])
    expect(r[0].ultimaCompraEm).toBe('2026-09-20T10:00:00Z')
  })
  it('busca por telefone e sem acento', () => {
    expect(sugestoesDeClientes(linhas, '9990002')[0].nome).toBe('Maria João')
    expect(sugestoesDeClientes(linhas, 'joao').length).toBe(2)
  })
})
