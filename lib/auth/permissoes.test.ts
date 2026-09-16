import { describe, it, expect } from 'vitest'
import {
  PAPEIS,
  PERMISSOES,
  pode,
  permissoesDo,
  ehPapel,
  papeisQuePodeGerenciar,
  podeAdministrar,
  type Papel,
  type Permissao,
} from './permissoes'

/**
 * A matriz esperada, escrita à mão. Existe de propósito: se alguém mexer no módulo, o
 * teste falha por divergir DESTA tabela, não por reexecutar a mesma lógica.
 */
const ESPERADO: Record<Permissao, Papel[]> = {
  'pedidos.delivery.ver': ['dono', 'gerente', 'atendente', 'logistica'],
  'pedidos.delivery.criar': ['dono', 'gerente', 'atendente'],
  'pedidos.delivery.avancar': ['dono', 'gerente', 'atendente', 'logistica'],
  'pedidos.delivery.cancelar': ['dono', 'gerente', 'atendente'],
  'pedidos.mesa.ver': ['dono', 'gerente', 'garcom', 'cozinha'],
  'pedidos.mesa.criar': ['dono', 'gerente', 'garcom'],
  'pedidos.mesa.enviar_cozinha': ['dono', 'gerente', 'garcom'],
  'pedidos.mesa.cancelar': ['dono', 'gerente'],
  'pedidos.balcao.criar': ['dono', 'gerente', 'atendente'],
  'cozinha.pedidos.ver': ['dono', 'gerente', 'cozinha'],
  'cozinha.pedidos.atualizar_status': ['dono', 'gerente', 'cozinha'],
  'mesas.operar': ['dono', 'gerente', 'garcom'],
  'mesas.gerenciar': ['dono', 'gerente'],
  'comanda.fechar': ['dono', 'gerente', 'garcom'],
  'comanda.transferir': ['dono', 'gerente', 'garcom'],
  'comanda.desconto': ['dono', 'gerente'],
  'clientes.ver': ['dono', 'gerente', 'atendente'],
  'dashboard.faturamento': ['dono', 'gerente'],
  'cardapio.editar': ['dono', 'gerente'],
  'campanhas.gerenciar': ['dono', 'gerente'],
  'fidelidade.gerenciar': ['dono', 'gerente'],
  'logistica.operar': ['dono', 'gerente', 'logistica'],
  'auditoria.ver': ['dono', 'gerente'],
  'integracoes.gerenciar': ['dono'],
  'ajustes.editar': ['dono'],
  'equipe.gerenciar': ['dono', 'gerente'],
}

describe('matriz de permissões — célula a célula', () => {
  // 7 papéis × 26 permissões: nenhuma célula fica implícita.
  for (const permissao of PERMISSOES) {
    for (const papel of PAPEIS) {
      const deveria = ESPERADO[permissao].includes(papel)
      it(`${papel} ${deveria ? 'TEM' : 'não tem'} ${permissao}`, () => {
        expect(pode(papel, permissao)).toBe(deveria)
      })
    }
  }

  it('toda permissão tem decisão registrada para os 7 papéis', () => {
    // Permissão nova sem linha no ESPERADO reprova aqui, não em produção.
    expect(Object.keys(ESPERADO).sort()).toEqual([...PERMISSOES].sort())
  })
})

describe('separação por canal', () => {
  it('garçom não enxerga nada de delivery', () => {
    const delivery = PERMISSOES.filter((p) => p.startsWith('pedidos.delivery.'))
    for (const p of delivery) expect(pode('garcom', p)).toBe(false)
  })

  it('garçom não vê clientes, faturamento, auditoria nem ajustes', () => {
    for (const p of ['clientes.ver', 'dashboard.faturamento', 'auditoria.ver', 'ajustes.editar'] as Permissao[]) {
      expect(pode('garcom', p)).toBe(false)
    }
  })

  it('garçom não entra no balcão/PDV', () => {
    expect(pode('garcom', 'pedidos.balcao.criar')).toBe(false)
  })

  it('garçom lança e envia, mas não prepara nem avança status de cozinha', () => {
    expect(pode('garcom', 'pedidos.mesa.criar')).toBe(true)
    expect(pode('garcom', 'pedidos.mesa.enviar_cozinha')).toBe(true)
    expect(pode('garcom', 'cozinha.pedidos.atualizar_status')).toBe(false)
  })

  it('não existe permissão de entrega pelo garçom', () => {
    // O fluxo presencial não tem "pronto → entregue": o garçom serve e pronto.
    expect(PERMISSOES.some((p) => /entregar|entrega\b/.test(p) && p.startsWith('pedidos.mesa'))).toBe(false)
  })

  it('atendente do delivery não opera mesa', () => {
    for (const p of PERMISSOES.filter((x) => x.startsWith('pedidos.mesa.') || x.startsWith('mesas.') || x.startsWith('comanda.'))) {
      expect(pode('atendente', p)).toBe(false)
    }
  })

  it('cozinha só enxerga produção', () => {
    expect(permissoesDo('cozinha').sort()).toEqual(
      ['cozinha.pedidos.atualizar_status', 'cozinha.pedidos.ver', 'pedidos.mesa.ver'].sort(),
    )
  })
})

describe('papel desconhecido e ausente', () => {
  it('não tem permissão nenhuma', () => {
    for (const papel of [null, undefined, '', 'sommelier', 'admin', 'DONO']) {
      expect(permissoesDo(papel)).toEqual([])
      for (const p of PERMISSOES) expect(pode(papel, p)).toBe(false)
    }
  })

  it('ehPapel reconhece só os papéis do enum', () => {
    expect(ehPapel('garcom')).toBe(true)
    expect(ehPapel('sommelier')).toBe(false)
    expect(ehPapel(null)).toBe(false)
  })
})

describe('papéis oferecidos na tela de Equipe', () => {
  it('dono cria gerente, garçom e atendente — nunca outro dono', () => {
    expect(papeisQuePodeGerenciar('dono').sort()).toEqual(['atendente', 'garcom', 'gerente'])
  })

  it('gerente cria garçom e atendente — nunca outro gerente', () => {
    expect(papeisQuePodeGerenciar('gerente').sort()).toEqual(['atendente', 'garcom'])
  })

  it('quem não gerencia equipe não cria ninguém', () => {
    for (const papel of ['garcom', 'atendente', 'cozinha', 'logistica', 'entregador']) {
      expect(papeisQuePodeGerenciar(papel)).toEqual([])
    }
  })

  it('cozinha, logística e entregador não são oferecidos enquanto forem por token', () => {
    for (const papel of ['dono', 'gerente']) {
      const oferecidos = papeisQuePodeGerenciar(papel)
      expect(oferecidos).not.toContain('cozinha')
      expect(oferecidos).not.toContain('logistica')
      expect(oferecidos).not.toContain('entregador')
      expect(oferecidos).not.toContain('dono')
    }
  })
})

describe('travas de administração de usuário', () => {
  const dono = { id: 'u-dono', papel: 'dono' }
  const gerente = { id: 'u-gerente', papel: 'gerente' }
  const garcom = { id: 'u-garcom', papel: 'garcom', outrosAdminsAtivos: 1 }

  it('dono administra garçom', () => {
    expect(podeAdministrar(dono, garcom)).toEqual({ ok: true })
  })

  it('garçom não administra ninguém', () => {
    expect(podeAdministrar({ id: 'x', papel: 'garcom' }, garcom)).toEqual({ ok: false, motivo: 'sem_permissao' })
  })

  it('ninguém mexe na própria conta pela tela de equipe', () => {
    expect(podeAdministrar(gerente, { id: 'u-gerente', papel: 'gerente', outrosAdminsAtivos: 3 }))
      .toEqual({ ok: false, motivo: 'proprio_usuario' })
  })

  it('gerente não toca em outro gerente nem no dono', () => {
    expect(podeAdministrar(gerente, { id: 'outro', papel: 'gerente', outrosAdminsAtivos: 3 }))
      .toEqual({ ok: false, motivo: 'nivel_igual_ou_superior' })
    expect(podeAdministrar(gerente, { id: 'u-dono', papel: 'dono', outrosAdminsAtivos: 3 }))
      .toEqual({ ok: false, motivo: 'nivel_igual_ou_superior' })
  })

  it('a loja nunca fica sem administrador ativo', () => {
    // Dono tentando desativar o único gerente restante: barrado, porque o próprio dono
    // não conta como "outro admin ativo" na contagem passada pelo chamador.
    expect(podeAdministrar(dono, { id: 'g', papel: 'gerente', outrosAdminsAtivos: 0 }))
      .toEqual({ ok: false, motivo: 'ultimo_administrador' })
    expect(podeAdministrar(dono, { id: 'g', papel: 'gerente', outrosAdminsAtivos: 1 }))
      .toEqual({ ok: true })
  })

  it('desativar quem não é administrador não depende da contagem', () => {
    expect(podeAdministrar(dono, { id: 'g', papel: 'garcom', outrosAdminsAtivos: 0 })).toEqual({ ok: true })
  })
})
