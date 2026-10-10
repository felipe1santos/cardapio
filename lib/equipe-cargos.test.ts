import { describe, expect, it } from 'vitest'
import { AREAS, SENSIVEIS, sensivelDaRequisicao } from './acessos'
import {
  alternarPermissao, areasForaDoAlcance, cargoDoUsuario, contarPermissoes, GRUPOS_PERMISSOES, modeloDoCargo,
  papelParaAcessos, situacaoDoUsuario, temPermissao, excedeOCargo, sensiveisSemSerGestor, papelForaDoCargo,
} from './equipe-cargos'

const DONO_OFERECE = ['gerente', 'garcom', 'atendente', 'logistica'] as const
const GERENTE_OFERECE = ['garcom', 'atendente', 'logistica'] as const

describe('cargos da equipe', () => {
  it('cada cargo com modelo cai no papel esperado', () => {
    const esperado = { gerente: 'gerente', caixa: 'atendente', garcom: 'garcom', cozinha: 'atendente', atendente: 'atendente' } as const
    for (const [cargo, papel] of Object.entries(esperado)) {
      const m = modeloDoCargo(cargo as never)!
      expect(papelParaAcessos(cargo as never, m, [...DONO_OFERECE])).toBe(papel)
    }
  })

  it('motoboy (10/10): nenhuma permissão do painel — o servidor grava papel entregador', () => {
    expect(modeloDoCargo('motoboy')).toEqual({ areas: [], sensiveis: [] })
  })

  it('o cargo define o papel: garçom com Painel de Pedidos NÃO sobe (precisa do Personalizado)', () => {
    const a = { areas: ['mesas', 'pedidos'] as never[], sensiveis: [] }
    expect(papelParaAcessos('garcom', a, [...DONO_OFERECE])).toBeNull()
    expect(excedeOCargo('garcom', a)).toEqual(['pedidos'])
    expect(papelParaAcessos('personalizado', a, [...DONO_OFERECE])).toBe('atendente')
  })

  it('caixa com Cardápio: recusado no cargo Caixa; no Personalizado vira gerente se o dono cadastra', () => {
    const a = { areas: ['pdv', 'cardapio'] as never[], sensiveis: [] }
    expect(papelParaAcessos('caixa', a, [...DONO_OFERECE])).toBeNull()
    expect(excedeOCargo('caixa', a)).toEqual(['cardapio'])
    expect(papelParaAcessos('personalizado', a, [...DONO_OFERECE])).toBe('gerente')
    expect(papelParaAcessos('personalizado', a, [...GERENTE_OFERECE])).toBeNull()
    expect(areasForaDoAlcance(a, [...GERENTE_OFERECE])).toEqual(['cardapio'])
  })

  it('aviso: permissões sensíveis de gestor sem ser gerente/dono', () => {
    const fin = { areas: ['mesas'] as never[], sensiveis: ['financeiro', 'sangria', 'estornar', 'desconto'] as never[] }
    expect(sensiveisSemSerGestor('garcom', 'gerente', fin)).toEqual(['financeiro', 'sangria', 'estornar']) // caso garcom123
    expect(sensiveisSemSerGestor('gerente', 'gerente', fin)).toEqual([])
    expect(sensiveisSemSerGestor('caixa', 'atendente', { areas: [], sensiveis: ['aprovar', 'financeiro_exportar'] as never[] })).toEqual(['aprovar', 'financeiro_exportar'])
    expect(sensiveisSemSerGestor('dono', 'dono', fin)).toEqual([])
  })

  it('papel fora do cargo', () => {
    expect(papelForaDoCargo('garcom', 'gerente')).toBe(true)
    expect(papelForaDoCargo('garcom', 'garcom')).toBe(false)
    expect(papelForaDoCargo('motoboy', 'entregador')).toBe(false)
    expect(papelForaDoCargo('personalizado', 'gerente')).toBe(false)
  })

  it('personalizado pega o papel mais restrito que cobre', () => {
    expect(papelParaAcessos('personalizado', { areas: ['mesas'], sensiveis: [] }, [...DONO_OFERECE])).toBe('garcom')
    expect(papelParaAcessos('personalizado', { areas: ['logistica'], sensiveis: [] }, [...DONO_OFERECE])).toBe('logistica')
  })

  it('Integrações/Ajustes (só do dono) não impedem o cadastro', () => {
    expect(papelParaAcessos('atendente', { areas: ['pedidos', 'ajustes'], sensiveis: [] }, [...GERENTE_OFERECE])).toBe('atendente')
  })

  it('cargo deduzido para contas antigas', () => {
    expect(cargoDoUsuario(null, 'dono', null)).toBe('dono')
    expect(cargoDoUsuario(null, 'garcom', null)).toBe('garcom')
    expect(cargoDoUsuario(null, 'atendente', modeloDoCargo('caixa'))).toBe('caixa')
    expect(cargoDoUsuario(null, 'atendente', { areas: ['cardapio'], sensiveis: [] })).toBe('personalizado')
    expect(cargoDoUsuario('motoboy', 'logistica', null)).toBe('motoboy')
  })

  it('situação: desativado sem motivo aparece pausado', () => {
    expect(situacaoDoUsuario(true, 'bloqueado')).toBe('ativo')
    expect(situacaoDoUsuario(false, null)).toBe('pausado')
    expect(situacaoDoUsuario(false, 'bloqueado')).toBe('bloqueado')
    expect(situacaoDoUsuario(false, 'excluido')).toBe('excluido')
  })

  it('contagem e alternância', () => {
    const a = modeloDoCargo('caixa')!
    expect(contarPermissoes(a)).toBe(a.areas.length + a.sensiveis.length)
    expect(contarPermissoes(null)).toBe(0)
    const item = GRUPOS_PERMISSOES[0].itens[0]
    const b = alternarPermissao({ areas: [], sensiveis: [] }, item, true)
    expect(temPermissao(b, item)).toBe(true)
    expect(temPermissao(alternarPermissao(b, item, false), item)).toBe(false)
  })

  it('os grupos cobrem todas as áreas e sensíveis, sem repetir', () => {
    const chaves = GRUPOS_PERMISSOES.flatMap((g) => g.itens.map((i) => `${i.tipo}:${i.chave}`))
    expect(new Set(chaves).size).toBe(chaves.length)
    for (const a of AREAS) expect(chaves).toContain(`area:${a.chave}`)
    for (const s of SENSIVEIS) expect(chaves).toContain(`sensivel:${s.chave}`)
  })

  it('taxas da conta são a ação sensível "taxa"', () => {
    expect(sensivelDaRequisicao('POST', '/api/admin/comandas/abc', { acao: 'taxas' })).toBe('taxa')
    expect(sensivelDaRequisicao('POST', '/api/admin/mesas/m1/conta', { acao: 'taxa_extra' })).toBe('taxa')
    expect(sensivelDaRequisicao('POST', '/api/admin/mesas/m1/conta', { acao: 'ajustar_valores', descontoValor: 5 })).toBe('desconto')
  })
})
