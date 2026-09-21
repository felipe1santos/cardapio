import { describe, it, expect } from 'vitest'
import {
  PAPEIS,
  PERMISSOES,
  pode,
  permissoesDo,
  ehPapel,
  papeisQuePodeGerenciar,
  podeAdministrar,
  podeNotificarCanal,
  podeNoSalao,
  REGRAS_SALAO_PADRAO,
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
  'pedidos.mesa.solicitar_cancelamento': ['dono', 'gerente', 'garcom'],
  'pedidos.balcao.criar': ['dono', 'gerente', 'atendente'],
  'cozinha.pedidos.ver': ['dono', 'gerente', 'cozinha'],
  'cozinha.pedidos.atualizar_status': ['dono', 'gerente', 'cozinha'],
  'mesas.operar': ['dono', 'gerente', 'garcom'],
  'mesas.gerenciar': ['dono', 'gerente'],
  'comanda.ver': ['dono', 'gerente', 'garcom', 'atendente'],
  'comanda.fechar': ['dono', 'gerente', 'atendente'],
  'comanda.transferir': ['dono', 'gerente', 'garcom'],
  'comanda.desconto': ['dono', 'gerente'],
  'comanda.estornar': ['dono', 'gerente'],
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
  // 7 papéis × 31 permissões: nenhuma célula fica implícita.
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

  it('atendente/caixa vê e cobra a conta, mas não lança, não atende chamado nem mexe na mesa', () => {
    const doSalao = PERMISSOES.filter((x) => x.startsWith('pedidos.mesa.') || x.startsWith('mesas.') || x.startsWith('comanda.'))
    const doCaixa = ['comanda.ver', 'comanda.fechar']
    for (const p of doSalao) expect(pode('atendente', p), p).toBe(doCaixa.includes(p))
  })

  it('garçom não recebe, não estorna nem dá desconto por padrão', () => {
    for (const p of ['comanda.fechar', 'comanda.estornar', 'comanda.desconto'] as Permissao[]) {
      expect(pode('garcom', p), p).toBe(false)
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

describe('quem pode notificar o cliente, por canal', () => {
  // Tabela à mão, de novo de propósito: a regra tem que divergir DESTA lista para falhar.
  const ESPERADO_NOTIFICAR: Record<string, Papel[]> = {
    delivery: ['dono', 'gerente', 'atendente', 'logistica'],
    mesa: ['dono', 'gerente', 'garcom', 'cozinha'],
    balcao: ['dono', 'gerente', 'atendente'],
  }

  it('cada canal libera exatamente os papéis da lista', () => {
    for (const [canal, papeis] of Object.entries(ESPERADO_NOTIFICAR)) {
      for (const papel of PAPEIS) {
        expect(podeNotificarCanal(papel, canal), `${papel} x ${canal}`).toBe(papeis.includes(papel))
      }
    }
  })

  it('anônimo não notifica nada — era o furo da rota', () => {
    for (const canal of ['delivery', 'mesa', 'balcao']) {
      expect(podeNotificarCanal(null, canal)).toBe(false)
      expect(podeNotificarCanal(undefined, canal)).toBe(false)
      expect(podeNotificarCanal('', canal)).toBe(false)
    }
  })

  it('garçom não avisa cliente de delivery; atendente não avisa mesa', () => {
    expect(podeNotificarCanal('garcom', 'delivery')).toBe(false)
    expect(podeNotificarCanal('atendente', 'mesa')).toBe(false)
  })

  it('canal desconhecido nega até para o dono: dado novo não abre porta', () => {
    for (const papel of PAPEIS) {
      expect(podeNotificarCanal(papel, 'marketplace')).toBe(false)
      expect(podeNotificarCanal(papel, '')).toBe(false)
    }
  })
})

describe('regras do salão por loja', () => {
  it('sem configuração vale exatamente a matriz', () => {
    for (const permissao of PERMISSOES) {
      for (const papel of PAPEIS) {
        expect(podeNoSalao(papel, permissao), `${papel} ${permissao}`).toBe(pode(papel, permissao))
      }
    }
    expect(REGRAS_SALAO_PADRAO).toEqual({ garcomRecebe: false, garcomTransfere: true, caixaDesconto: false })
  })

  it('"garçom recebe" libera pagamento e fechamento ao garçom — e só isso', () => {
    const regras = { ...REGRAS_SALAO_PADRAO, garcomRecebe: true }
    expect(podeNoSalao('garcom', 'comanda.fechar', regras)).toBe(true)
    for (const p of ['comanda.estornar', 'comanda.desconto', 'dashboard.faturamento'] as Permissao[]) {
      expect(podeNoSalao('garcom', p, regras), p).toBe(false)
    }
  })

  it('"garçom transfere" desligado tira a transferência do garçom, não da gestão', () => {
    const regras = { ...REGRAS_SALAO_PADRAO, garcomTransfere: false }
    expect(podeNoSalao('garcom', 'comanda.transferir', regras)).toBe(false)
    expect(podeNoSalao('gerente', 'comanda.transferir', regras)).toBe(true)
    expect(podeNoSalao('dono', 'comanda.transferir', regras)).toBe(true)
  })

  it('"caixa dá desconto" libera taxa e desconto ao atendente, nunca estorno', () => {
    const regras = { ...REGRAS_SALAO_PADRAO, caixaDesconto: true }
    expect(podeNoSalao('atendente', 'comanda.desconto', regras)).toBe(true)
    expect(podeNoSalao('atendente', 'comanda.estornar', regras)).toBe(false)
    expect(podeNoSalao('garcom', 'comanda.desconto', regras)).toBe(false)
  })

  it('regra nenhuma dá nada a papel desconhecido', () => {
    const tudo = { garcomRecebe: true, garcomTransfere: true, caixaDesconto: true }
    for (const p of PERMISSOES) expect(podeNoSalao('sommelier', p, tudo)).toBe(false)
  })

  /**
   * As oito combinações das três chaves, para garantir que marcar uma não mexe nas
   * outras — é assim que o dono usa a tela ("Quem pode o quê no salão"), marcando e
   * desmarcando itens em qualquer ordem.
   */
  it('as três chaves são independentes nas 8 combinações', () => {
    for (const garcomRecebe of [false, true]) {
      for (const garcomTransfere of [false, true]) {
        for (const caixaDesconto of [false, true]) {
          const regras = { garcomRecebe, garcomTransfere, caixaDesconto }
          const eis = JSON.stringify(regras)

          // Cada chave move exatamente o seu par papel+permissão…
          expect(podeNoSalao('garcom', 'comanda.fechar', regras), eis).toBe(garcomRecebe)
          expect(podeNoSalao('garcom', 'comanda.transferir', regras), eis).toBe(garcomTransfere)
          expect(podeNoSalao('atendente', 'comanda.desconto', regras), eis).toBe(caixaDesconto)

          // …e nada além dele. Lançar na mesa é do garçom independentemente das chaves:
          // com "somente visualização" desligado, o cliente monta a lista e o garçom
          // lança o pedido, por mais restrita que a loja tenha deixado a parte do caixa.
          for (const p of ['mesas.operar', 'comanda.ver', 'pedidos.mesa.criar', 'pedidos.mesa.enviar_cozinha'] as Permissao[]) {
            expect(podeNoSalao('garcom', p, regras), `${eis} ${p}`).toBe(true)
          }
          for (const p of ['comanda.estornar', 'comanda.desconto', 'pedidos.mesa.cancelar', 'mesas.gerenciar'] as Permissao[]) {
            expect(podeNoSalao('garcom', p, regras), `${eis} ${p}`).toBe(false)
          }
          // O caixa cobra e vê a conta, mas nunca atende mesa nem lança pedido.
          expect(podeNoSalao('atendente', 'comanda.fechar', regras), eis).toBe(true)
          for (const p of ['mesas.operar', 'pedidos.mesa.enviar_cozinha', 'comanda.estornar'] as Permissao[]) {
            expect(podeNoSalao('atendente', p, regras), `${eis} ${p}`).toBe(false)
          }
          // A gestão não perde nada com chave desligada.
          for (const papel of ['dono', 'gerente'] as Papel[]) {
            for (const p of ['comanda.fechar', 'comanda.transferir', 'comanda.desconto', 'comanda.estornar'] as Permissao[]) {
              expect(podeNoSalao(papel, p, regras), `${eis} ${papel} ${p}`).toBe(true)
            }
          }
        }
      }
    }
  })
})
