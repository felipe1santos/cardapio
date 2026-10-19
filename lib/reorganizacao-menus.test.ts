import { describe, expect, it } from 'vitest'
import { decidirAcesso, permissaoDaRota } from '@/lib/auth/rotas'
import { areaDoCaminho, caminhoPermitido } from '@/lib/acessos'
import { abasDoAjustes, ABAS_MOVIDAS } from '@/components/admin/ajustes-abas'
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
    const abas = abasDoAjustes({ podeAjustes: true, podeImpressao: true, agenteLiberado: false })
    expect(abas.map((a) => a.id)).toEqual(['loja', 'entrega', 'mesas', 'qrcode', 'conta', 'impressao', 'mensagens', 'robo', 'agente'])
    expect(abas.find((a) => a.id === 'agente')?.bloqueado).toBe(true)
    expect(abas.find((a) => a.id === 'robo')?.icone).not.toBe(abas.find((a) => a.id === 'agente')?.icone)
    expect(abasDoAjustes({ podeAjustes: true, podeImpressao: true, agenteLiberado: true }).find((a) => a.id === 'agente')?.bloqueado).toBe(false)
  })
  it('gerente: só a Impressão', () => {
    expect(abasDoAjustes({ podeAjustes: false, podeImpressao: true, agenteLiberado: true }).map((a) => a.id)).toEqual(['impressao'])
  })
  it('abas antigas redirecionam: modelos e notificações para Campanhas, impressão para a página nova', () => {
    expect(ABAS_MOVIDAS.modelos).toBe('/admin/campanhas?aba=modelos')
    expect(ABAS_MOVIDAS.notificacoes).toBe('/admin/campanhas?aba=notificacoes')
    expect(ABAS_MOVIDAS.impressao).toBe('/admin/ajustes/impressao')
  })
})

describe('cadeados continuam', () => {
  it('Agente de IA: "Quero liberar" abre em Ajustes; a rota antiga e a API seguem travadas pelo módulo', () => {
    expect(INFO_MODULO.agente_ia.href).toBe('/admin/agente-ia') // a página leva para Ajustes › Agente de IA
    expect(moduloDoCaminho('/admin/agente-ia')).toBe('agente_ia')
    expect(moduloDoCaminho('/api/admin/agente-ia')).toBe('agente_ia')
  })
  it('Campanhas (disparos) continua no módulo Disparos; push do app (12/10) e status do pedido são livres', () => {
    expect(moduloDoCaminho('/admin/campanhas')).toBe('disparos')
    expect(moduloDoCaminho('/api/admin/campanhas/push')).toBeNull()
    expect(moduloDoCaminho('/api/admin/campanhas/automaticas')).toBeNull()
  })
})

describe('menu único em todas as lojas (16/10/2026, sem "Novidades em teste")', () => {
  it('Agente de IA e Impressão ficam em Ajustes, fora do menu principal', () => {
    const l = itensDoMenu({ papel: 'dono', moduloMesas: true, usaLogistica: true, financeiro: true, modulos: { financeiro: true, agente_ia: true, disparos: true, entregas_lalamove: true, canal_opendelivery: true, canal_ifood: true, entregas_ifood: true, entregas_foody: true } })
    expect(l.map((i) => i.href)).not.toContain('/admin/agente-ia')
    expect(l.map((i) => i.href)).not.toContain('/admin/impressao')
  })
  it('Ajustes: Impressão e Agente de IA; a aba antiga "Cozinha" leva ao KDS', () => {
    expect(abasDoAjustes({ podeAjustes: true, podeImpressao: true, agenteLiberado: true }).map((a) => a.id))
      .toEqual(['loja', 'entrega', 'mesas', 'qrcode', 'conta', 'impressao', 'mensagens', 'robo', 'agente'])
    expect(ABAS_MOVIDAS.cozinha).toBe('/admin/kds')
  })
})
