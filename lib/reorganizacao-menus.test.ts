import { describe, expect, it } from 'vitest'
import { decidirAcesso, permissaoDaRota } from '@/lib/auth/rotas'
import { areaDoCaminho, caminhoPermitido } from '@/lib/acessos'
import { abasDoAjustes, abasMovidas } from '@/components/admin/ajustes-abas'
import { itensDoMenu } from '@/lib/menu-lateral'
import { INFO_MODULO, moduloDoCaminho } from '@/lib/modulos'

/** Reorganização dos menus (10/10/2026): só muda onde as telas ficam — permissões iguais às de antes. */
describe('Impressão dentro de Ajustes: mesma permissão de antes', () => {
  it('/admin/ajustes/impressao exige impressao.configurar (e não ajustes.editar)', () => {
    expect(permissaoDaRota('/admin/ajustes/impressao')).toBe('impressao.configurar')
    expect(permissaoDaRota('/admin/ajustes')).toBe('ajustes.editar')
  })
  it('dono e gerente abrem; garçom e atendente não; motoboy vai para o app', () => {
    expect(decidirAcesso('/admin/ajustes/impressao', 'dono')).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/admin/ajustes/impressao', 'gerente')).toEqual({ tipo: 'seguir' })
    expect(decidirAcesso('/admin/ajustes/impressao', 'garcom').tipo).toBe('redirecionar')
    expect(decidirAcesso('/admin/ajustes/impressao', 'atendente').tipo).toBe('redirecionar')
    expect(decidirAcesso('/admin/ajustes/impressao', 'entregador')).toEqual({ tipo: 'redirecionar', para: '/motoboy' })
    // O resto dos Ajustes continua só do dono.
    expect(decidirAcesso('/admin/ajustes', 'gerente').tipo).toBe('redirecionar')
  })
  it('acesso por funcionário: a página nova é da área Impressão', () => {
    expect(areaDoCaminho('/admin/ajustes/impressao')).toBe('impressao')
    expect(areaDoCaminho('/admin/impressao')).toBe('impressao')
    const soImpressao = { areas: ['impressao' as const], sensiveis: [] }
    expect(caminhoPermitido('/admin/ajustes/impressao', 'gerente', soImpressao)).toBe(true)
    expect(caminhoPermitido('/admin/ajustes', 'gerente', soImpressao)).toBe(false)
  })
})

describe('seções de Ajustes', () => {
  it('dono: Impressão e, no grupo WhatsApp, Mensagens, Robô e Agente de IA (cadeado sem o módulo)', () => {
    const abas = abasDoAjustes({ podeAjustes: true, podeImpressao: true, agenteLiberado: false, novidades: true })
    expect(abas.map((a) => a.id)).toEqual(['loja', 'entrega', 'mesas', 'qrcode', 'conta', 'impressao', 'mensagens', 'robo', 'agente'])
    expect(abas.find((a) => a.id === 'agente')?.bloqueado).toBe(true)
    expect(abas.find((a) => a.id === 'robo')?.icone).not.toBe(abas.find((a) => a.id === 'agente')?.icone)
    expect(abasDoAjustes({ podeAjustes: true, podeImpressao: true, agenteLiberado: true, novidades: true }).find((a) => a.id === 'agente')?.bloqueado).toBe(false)
  })
  it('gerente: só a Impressão', () => {
    expect(abasDoAjustes({ podeAjustes: false, podeImpressao: true, agenteLiberado: true, novidades: true }).map((a) => a.id)).toEqual(['impressao'])
  })
  it('abas antigas redirecionam: modelos e notificações para Campanhas, impressão para a página nova', () => {
    expect(abasMovidas(true).modelos).toBe('/admin/campanhas?aba=modelos')
    expect(abasMovidas(true).notificacoes).toBe('/admin/campanhas?aba=notificacoes')
    expect(abasMovidas(true).impressao).toBe('/admin/ajustes/impressao')
  })
})

describe('cadeados continuam', () => {
  it('Agente de IA: "Quero liberar" abre em Ajustes; a rota antiga e a API seguem travadas pelo módulo', () => {
    expect(INFO_MODULO.agente_ia.href).toBe('/admin/agente-ia') // com as novidades, a página leva para Ajustes
    expect(moduloDoCaminho('/admin/agente-ia')).toBe('agente_ia')
    expect(moduloDoCaminho('/api/admin/agente-ia')).toBe('agente_ia')
  })
  it('Campanhas (com Modelos e Notificações do app) continua no módulo Disparos; status do pedido segue livre', () => {
    expect(moduloDoCaminho('/admin/campanhas')).toBe('disparos')
    expect(moduloDoCaminho('/api/admin/campanhas/push')).toBe('disparos')
    expect(moduloDoCaminho('/api/admin/campanhas/automaticas')).toBeNull()
  })
})

describe('"Novidades em teste" desligada (0178): tudo como antes', () => {
  it('menu de sempre, com Agente de IA e Impressão', () => {
    const l = itensDoMenu({ papel: 'dono', moduloMesas: true, usaLogistica: true, financeiro: true, modulos: { financeiro: true, agente_ia: true, disparos: true } })
    expect(l.map((i) => i.href)).toContain('/admin/agente-ia')
    expect(l.map((i) => i.href)).toContain('/admin/impressao')
    const g = itensDoMenu({ papel: 'gerente', moduloMesas: true, usaLogistica: true, modulos: null })
    expect(g.some((i) => i.label === 'Ajustes')).toBe(false)
    expect(g.some((i) => i.href === '/admin/impressao')).toBe(true)
  })
  it('Ajustes de sempre: Modelos, Notificações do app e Robô (sem Impressão nem Agente)', () => {
    expect(abasDoAjustes({ podeAjustes: true, podeImpressao: true, agenteLiberado: true, novidades: false }).map((a) => a.id))
      .toEqual(['loja', 'entrega', 'mesas', 'qrcode', 'conta', 'mensagens', 'modelos', 'notificacoes', 'robo'])
    expect(abasMovidas(false)).toEqual({ impressao: '/admin/impressao', cozinha: '/admin/cozinha' })
  })
})
