import { describe, it, expect } from 'vitest'
import { areaDoCaminho, caminhoPermitido, MODELOS, normalizarAcessos, podeSensivel, primeiraTela, resumoAcessos } from './acessos'

describe('acessos por funcionário (Fase 6)', () => {
  it('normaliza: nulo/inválido = sem limite; filtra chaves desconhecidas', () => {
    expect(normalizarAcessos(null)).toBeNull()
    expect(normalizarAcessos({ areas: 'x' })).toBeNull()
    expect(normalizarAcessos({ areas: ['pdv', 'hack', 'pdv'], sensiveis: ['desconto', 'root'] })).toEqual({ areas: ['pdv'], sensiveis: ['desconto'] })
  })
  it('área do caminho: páginas e APIs; central de atendimento é neutra', () => {
    expect(areaDoCaminho('/admin/pdv')).toBe('pdv')
    expect(areaDoCaminho('/api/admin/comandas/123')).toBe('pdv')
    expect(areaDoCaminho('/api/admin/whatsapp/robo')).toBe('integracoes')
    expect(areaDoCaminho('/api/admin/whatsapp/atendimento/conversas')).toBeNull()
    expect(areaDoCaminho('/api/admin/conta/senha')).toBeNull()
  })
  it('dono e acessos nulos: tudo; com acessos: só as áreas marcadas', () => {
    const garcom = MODELOS.find((m) => m.chave === 'garcom')!.acessos
    expect(caminhoPermitido('/admin/campanhas', 'dono', garcom)).toBe(true)
    expect(caminhoPermitido('/admin/campanhas', 'garcom', null)).toBe(true)
    expect(caminhoPermitido('/admin/mesas', 'garcom', garcom)).toBe(true)
    expect(caminhoPermitido('/admin/campanhas', 'garcom', garcom)).toBe(false)
    expect(caminhoPermitido('/api/admin/campanhas', 'garcom', garcom)).toBe(false)
  })
  it('sensíveis', () => {
    const caixa = MODELOS.find((m) => m.chave === 'caixa')!.acessos
    expect(podeSensivel('atendente', caixa, 'desconto')).toBe(true)
    expect(podeSensivel('atendente', caixa, 'cancelar_pedido')).toBe(false)
    expect(podeSensivel('dono', caixa, 'cancelar_pedido')).toBe(true)
    expect(podeSensivel('atendente', null, 'cancelar_pedido')).toBe(true)
  })
  it('primeira tela e resumo', () => {
    expect(primeiraTela({ areas: ['mesas'], sensiveis: [] })).toBe('/admin/mesas')
    expect(resumoAcessos('garcom', { areas: ['mesas', 'pdv'], sensiveis: [] })).toBe('Garçom + PDV')
    expect(resumoAcessos('garcom', { areas: ['mesas'], sensiveis: [] })).toBe('Garçom')
    expect(resumoAcessos('dono', null)).toBe('Acesso total (dono)')
    expect(resumoAcessos('garcom', null)).toBe('Padrão do papel')
  })
})

describe('ações sensíveis na requisição', async () => {
  const { sensivelDaRequisicao, caminhoPermitidoCompleto } = await import('./acessos')
  it('cancelar, desconto, fechar caixa, disparar campanha', () => {
    expect(sensivelDaRequisicao('POST', '/api/admin/pedidos/abc/cancelar', {})).toBe('cancelar_pedido')
    expect(sensivelDaRequisicao('POST', '/api/admin/comandas/abc', { acao: 'cancelar_item' })).toBe('cancelar_pedido')
    expect(sensivelDaRequisicao('POST', '/api/admin/mesas/abc/conta', { acao: 'ajustar_valores', descontoValor: 5 })).toBe('desconto')
    expect(sensivelDaRequisicao('POST', '/api/admin/mesas/abc/conta', { acao: 'ajustar_valores', descontoValor: 0, taxa: 10 })).toBeNull()
    expect(sensivelDaRequisicao('POST', '/api/admin/caixa', { acao: 'fechar' })).toBe('fechar_caixa')
    expect(sensivelDaRequisicao('POST', '/api/admin/caixa', { acao: 'abrir' })).toBeNull()
    expect(sensivelDaRequisicao('PATCH', '/api/admin/campanhas/x', { disparar: true })).toBe('disparar_campanhas')
    expect(sensivelDaRequisicao('POST', '/api/admin/campanhas/push/avulsas', { titulo: 'x' })).toBe('disparar_campanhas')
    expect(sensivelDaRequisicao('POST', '/api/admin/campanhas/push/teste', {})).toBe('disparar_campanhas')
    expect(sensivelDaRequisicao('PUT', '/api/admin/campanhas/push/config', {})).toBeNull()
    expect(sensivelDaRequisicao('POST', '/api/admin/campanhas', { nome: 'rascunho' })).toBeNull()
    expect(sensivelDaRequisicao('GET', '/api/admin/pedidos/abc/cancelar', {})).toBeNull()
  })
  it('dashboard exige financeiro', () => {
    expect(caminhoPermitidoCompleto('/admin/dashboard', 'gerente', { areas: ['dashboard'], sensiveis: [] })).toBe(false)
    expect(caminhoPermitidoCompleto('/admin/dashboard', 'gerente', { areas: ['dashboard'], sensiveis: ['financeiro'] })).toBe(true)
  })
})
