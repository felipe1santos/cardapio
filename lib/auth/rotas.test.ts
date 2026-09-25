import { describe, it, expect } from 'vitest'
import { decidirAcesso, permissaoDaRota, superficie, telaInicialDoPapel, PERMISSAO_PADRAO, ehRotaDoModuloMesas } from './rotas'

describe('superficie', () => {
  it('separa página, API e o resto', () => {
    expect(superficie('/admin/dashboard')).toBe('pagina')
    expect(superficie('/api/admin/equipe')).toBe('api')
    expect(superficie('/loja/pizza')).toBe('fora')
    expect(superficie('/mesa/abc')).toBe('fora')
    expect(superficie('/api/mesa/abc/selecao')).toBe('fora')
    // Prefixo parecido não conta.
    expect(superficie('/administrativo')).toBe('fora')
    expect(superficie('/api/administrativo')).toBe('fora')
  })
})

describe('garçom tentando entrar pela URL', () => {
  const PROIBIDAS = [
    '/admin/dashboard',
    '/admin/clientes',
    '/admin/ajustes',
    '/admin/pedidos',
    '/admin/pdv',
    '/admin/logistica',
    '/admin/cardapio',
    '/admin/campanhas',
    '/admin/fidelidade',
    '/admin/integracoes',
    '/admin/equipe',
  ]

  for (const rota of PROIBIDAS) {
    it(`página ${rota} redireciona o garçom para Mesas`, () => {
      expect(decidirAcesso(rota, 'garcom')).toEqual({ tipo: 'redirecionar', para: '/admin/mesas' })
    })
  }

  it('subpágina também é barrada', () => {
    expect(decidirAcesso('/admin/ajustes/impressao', 'garcom')).toEqual({ tipo: 'redirecionar', para: '/admin/mesas' })
  })

  it('API administrativa devolve 403 para o garçom', () => {
    for (const api of ['/api/admin/equipe', '/api/admin/pdv/pedido', '/api/admin/pedidos/x/cancelar', '/api/admin/campanhas', '/api/admin/whatsapp/status']) {
      expect(decidirAcesso(api, 'garcom')).toEqual({ tipo: 'negar', status: 403 })
    }
  })

  it('garçom entra no que é dele', () => {
    expect(decidirAcesso('/admin/mesas', 'garcom')).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/admin/mesas/123', 'garcom')).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/api/admin/mesas/123/lancamento', 'garcom')).toEqual({ tipo: 'seguir' })
  })
})

describe('dono não perde nada', () => {
  it('passa em todas as páginas e APIs mapeadas', () => {
    for (const r of ['/admin/dashboard', '/admin/ajustes', '/admin/equipe', '/admin/mesas', '/api/admin/equipe', '/api/admin/nexta/config', '/api/admin/whatsapp/status']) {
      expect(decidirAcesso(r, 'dono')).toEqual({ tipo: 'seguir' })
    }
  })

  it('passa em rota que ninguém mapeou', () => {
    expect(decidirAcesso('/admin/rota-nova', 'dono')).toEqual({ tipo: 'seguir' })
  })
})

describe('regras gerais', () => {
  it('sem papel: página vai ao login, API é 401', () => {
    expect(decidirAcesso('/admin/mesas', null)).toEqual({ tipo: 'redirecionar', para: '/login' })
    expect(decidirAcesso('/api/admin/mesas/1/lancamento', null)).toEqual({ tipo: 'negar', status: 401 })
  })

  it('fora do painel o middleware não se mete, nem sem sessão', () => {
    expect(decidirAcesso('/mesa/token', null)).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/loja/x', null)).toEqual({ tipo: 'seguir' })
  })

  it('rota administrativa não mapeada exige gestão — tela nova não nasce aberta', () => {
    expect(permissaoDaRota('/admin/rota-nova')).toBe(PERMISSAO_PADRAO)
    expect(permissaoDaRota('/api/admin/rota-nova')).toBe(PERMISSAO_PADRAO)
    expect(decidirAcesso('/admin/rota-nova', 'garcom')).toEqual({ tipo: 'redirecionar', para: '/admin/mesas' })
    expect(decidirAcesso('/api/admin/rota-nova', 'atendente')).toEqual({ tipo: 'negar', status: 403 })
  })

  it('/admin puro leva à tela inicial do papel', () => {
    expect(decidirAcesso('/admin', 'garcom')).toEqual({ tipo: 'redirecionar', para: '/admin/mesas' })
    expect(decidirAcesso('/admin', 'dono')).toEqual({ tipo: 'redirecionar', para: '/admin/dashboard' })
  })

  it('Nexta: configurar é integração, despachar é logística', () => {
    expect(permissaoDaRota('/api/admin/nexta/config')).toBe('integracoes.gerenciar')
    expect(permissaoDaRota('/api/admin/nexta/despachar')).toBe('logistica.operar')
  })

  it('ordem do Gestor de Cardápio (0101): quem edita o catálogo; garçom e atendente não', () => {
    expect(permissaoDaRota('/api/admin/cardapio/ordem')).toBe('cardapio.editar')
  })

  it('atendente/caixa entra no salão para cobrar — cada ação confere a sua permissão por dentro', () => {
    expect(decidirAcesso('/admin/mesas', 'atendente')).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/admin/mesas/1', 'atendente')).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/api/admin/mesas/1/conta', 'atendente')).toEqual({ tipo: 'seguir' })
    expect(permissaoDaRota('/api/admin/mesas/1/lancamento')).toBe('comanda.ver')
  })

  it('cozinha, logística e entregador não entram no salão pelo painel', () => {
    for (const papel of ['cozinha', 'logistica', 'entregador']) {
      expect(decidirAcesso('/api/admin/mesas/1/conta', papel)).toEqual({ tipo: 'negar', status: 403 })
    }
  })

  it('papel desconhecido não entra em nada', () => {
    expect(decidirAcesso('/admin/mesas', 'sommelier')).toEqual({ tipo: 'redirecionar', para: '/login' })
  })
})

describe('telaInicialDoPapel', () => {
  it('cada papel na sua tela', () => {
    expect(telaInicialDoPapel('dono')).toBe('/admin/dashboard')
    expect(telaInicialDoPapel('gerente')).toBe('/admin/dashboard')
    expect(telaInicialDoPapel('garcom')).toBe('/admin/mesas')
    expect(telaInicialDoPapel('atendente')).toBe('/admin/pedidos')
    expect(telaInicialDoPapel('logistica')).toBe('/admin/pedidos')
    expect(telaInicialDoPapel(null)).toBe('/login')
  })
})

describe('feature flag do módulo de mesas', () => {
  it('desligada: API do salão é 404 para todo mundo, inclusive o dono', () => {
    for (const papel of ['dono', 'gerente', 'garcom', 'atendente']) {
      for (const rota of ['/api/admin/mesas/1/conta', '/api/admin/mesas/1/lancamento', '/api/admin/mesas/chamados', '/api/admin/mesas/configuracao']) {
        expect(decidirAcesso(rota, papel, false), `${papel} ${rota}`).toEqual({ tipo: 'negar', status: 404 })
      }
    }
  })

  it('desligada: página do salão manda para a tela inicial, sem laço', () => {
    expect(decidirAcesso('/admin/mesas', 'dono', false)).toEqual({ tipo: 'redirecionar', para: '/admin/dashboard' })
    expect(decidirAcesso('/admin/mesas/1', 'atendente', false)).toEqual({ tipo: 'redirecionar', para: '/admin/pedidos' })
    // O garçom não tem tela fora do salão: vai para o login, que não passa pelo porteiro.
    expect(decidirAcesso('/admin/mesas', 'garcom', false)).toEqual({ tipo: 'redirecionar', para: '/login' })
    expect(decidirAcesso('/admin', 'garcom', false)).toEqual({ tipo: 'redirecionar', para: '/login' })
  })

  it('desligada: o resto do painel não muda', () => {
    expect(decidirAcesso('/admin/pedidos', 'atendente', false)).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/admin/pdv', 'dono', false)).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/api/admin/pdv/comanda', 'dono', false)).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/admin/equipe', 'dono', false)).toEqual({ tipo: 'seguir' })
  })

  it('não confunde prefixo parecido', () => {
    expect(ehRotaDoModuloMesas('/admin/mesas')).toBe(true)
    expect(ehRotaDoModuloMesas('/api/admin/mesas/x')).toBe(true)
    expect(ehRotaDoModuloMesas('/admin/mesasx')).toBe(false)
    expect(ehRotaDoModuloMesas('/admin/pdv')).toBe(false)
  })
})
