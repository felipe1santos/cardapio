import { describe, it, expect } from 'vitest'
import { validarNovoFuncionario, validarSenha, emailTecnico } from './equipe'
import { sanearSelecoesVistas } from './mesa-sessao'

const BASE = { nome: 'João Silva', usuario: 'joao.silva', papel: 'garcom', senha: 'segura123' }

describe('validarNovoFuncionario', () => {
  it('dono cadastra garçom', () => {
    expect(validarNovoFuncionario(BASE, 'dono')).toEqual([])
  })

  it('ninguém cria dono', () => {
    expect(validarNovoFuncionario({ ...BASE, papel: 'dono' }, 'dono')).toContain('Você não pode criar um funcionário com esse papel.')
  })

  it('gerente não cria gerente', () => {
    expect(validarNovoFuncionario({ ...BASE, papel: 'gerente' }, 'gerente')).toContain('Você não pode criar um funcionário com esse papel.')
    expect(validarNovoFuncionario(BASE, 'gerente')).toEqual([])
  })

  it('garçom não cria ninguém', () => {
    expect(validarNovoFuncionario(BASE, 'garcom')).toContain('Você não pode criar um funcionário com esse papel.')
  })

  it('não oferece papéis de portal por token', () => {
    for (const papel of ['cozinha', 'logistica', 'entregador']) {
      expect(validarNovoFuncionario({ ...BASE, papel }, 'dono').length).toBeGreaterThan(0)
    }
  })

  it('recusa nome curto e login inválido', () => {
    expect(validarNovoFuncionario({ ...BASE, nome: 'J' }, 'dono')).toContain('Informe o nome do funcionário.')
    for (const ruim of ['ab', 'João', 'com espaço', '-comeca', 'termina.']) {
      expect(validarNovoFuncionario({ ...BASE, usuario: ruim }, 'dono').some((e) => e.startsWith('Login inválido'))).toBe(true)
    }
  })

  it('aceita login com sublinhado — o defeito do ilike não pode voltar', () => {
    expect(validarNovoFuncionario({ ...BASE, usuario: 'joao_silva' }, 'dono')).toEqual([])
  })
})

describe('validarSenha', () => {
  it('exige ao menos 8 caracteres', () => {
    expect(validarSenha('1234567')).toHaveLength(1)
    expect(validarSenha('12345678')).toEqual([])
  })

  it('recusa senha absurda de longa', () => {
    expect(validarSenha('x'.repeat(100))).toHaveLength(1)
  })
})

describe('emailTecnico', () => {
  it('usa domínio que não resolve e não traz a senha', () => {
    const e = emailTecnico('joao.silva', 'a1b2c3d4-0000-0000-0000-000000000000')
    expect(e).toBe('joao.silva.a1b2c3d4@equipe.menuzia.local')
    expect(e.endsWith('.local')).toBe(true)
  })
})

describe('sanearSelecoesVistas', () => {
  const ID = '11111111-1111-4111-8111-111111111111'

  it('aceita id e versão válidos', () => {
    expect(sanearSelecoesVistas([{ id: ID, versao: 3 }])).toEqual([{ id: ID, versao: 3 }])
  })

  it('descarta versão inválida e id que não é uuid', () => {
    expect(sanearSelecoesVistas([{ id: ID, versao: 0 }, { id: ID, versao: 1.5 }, { id: 'x', versao: 1 }])).toEqual([])
  })

  it('não repete a mesma seleção', () => {
    expect(sanearSelecoesVistas([{ id: ID, versao: 2 }, { id: ID, versao: 9 }])).toEqual([{ id: ID, versao: 2 }])
  })

  it('aguenta lixo', () => {
    for (const v of [null, undefined, 'x', 1, {}]) expect(sanearSelecoesVistas(v)).toEqual([])
  })
})
