import { describe, expect, it } from 'vitest'
import { classificar } from './classificador'
import { decidir, ehAlteracaoDePedido, ESTADO_VAZIO } from './decisao'
import { menu, responder, type DadosLojaAuto } from './respostas'
import { planoAlteracao } from '@/lib/agente-ia/pos-pedido'

const agora = new Date('2026-10-18T22:00:00Z')
const base = (texto: string, extra = {}) => ({ classificacao: classificar(texto, {}), texto, estado: ESTADO_VAZIO, agora, ...extra })

describe('robô: alterar ou cancelar meu pedido (18/10)', () => {
  it('"mudar meu pedido" / "cancelar" COM pedido editável: pergunta o que mudar (não vai para o atendente)', () => {
    for (const t of ['quero mudar meu pedido', 'cancelar', 'esqueci de pedir a coca']) {
      const d = decidir(base(t, { pedidoEditavelId: 'p1' }))
      expect(d.acao, t).toBe('alterar_pedido_perguntar'); expect(d.estado.autoEstado).toBe('alterar_pedido:p1'); expect(d.silenciar).toBeUndefined()
    }
  })
  it('as mesmas frases SEM pedido editável: atendente, como antes', () => {
    expect(decidir(base('quero mudar meu pedido')).acao).toBe('atendente')
  })
  it('"7" do menu abre o fluxo só com pedido editável', () => {
    expect(decidir(base('8', { pedidoEditavelId: 'p1' })).acao).toBe('alterar_pedido_perguntar')
    expect(decidir(base('8')).acao).not.toBe('alterar_pedido_perguntar')
  })
  it('esperando o que mudar: a mensagem seguinte vira registro (com o id do pedido); atendente explícito continua atendente', () => {
    const estado = { ...ESTADO_VAZIO, autoEstado: 'alterar_pedido:p1' as const, autoEstadoEm: agora.toISOString() }
    const d = decidir(base('tirar a cebola do x-tudo', { estado }))
    expect(d.acao).toBe('alterar_pedido_registrar'); expect(d.pedidoId).toBe('p1'); expect(d.estado.autoEstado).toBeNull()
    expect(decidir(base('quero falar com atendente', { estado })).acao).toBe('atendente')
  })
  it('esperando o que mudar: "cancelar" / "quero cancelar" / "tirar do pedido" viram registro (o robô pediu para escrever cancelar), não a pergunta de novo', () => {
    // 19/10 (teste real local): "cancela meu pedido" → pergunta; "quero cancelar" → perguntava DE NOVO, em loop, porque
    // essas palavras são do assunto "atendente" e a espera só aceitava o que não fosse atendente.
    const estado = { ...ESTADO_VAZIO, autoEstado: 'alterar_pedido:p1' as const, autoEstadoEm: agora.toISOString() }
    for (const t of ['cancelar', 'quero cancelar', 'cancela o pedido', 'tirar do pedido a cebola']) {
      const d = decidir(base(t, { estado, pedidoEditavelId: 'p1' }))
      expect(d.acao, t).toBe('alterar_pedido_registrar'); expect(d.pedidoId, t).toBe('p1'); expect(d.estado.autoEstado, t).toBeNull()
    }
  })
  it('ehAlteracaoDePedido reconhece cancelar/mudar/tirar/acrescentar', () => {
    expect(ehAlteracaoDePedido('quero cancelar o pedido')).toBe(true); expect(ehAlteracaoDePedido('falar com atendente')).toBe(false)
  })
  it('menu: opção 8 (era 7 até 20/10) só com pedido editável; responder usa a mensagem do servidor', () => {
    const loja = { nome: 'Loja', link: 'https://x', textos: {}, bairros: [], aceitaEntrega: true, aberta: true } as unknown as DadosLojaAuto
    expect(menu(loja, true, true)).toContain('*8* Alterar ou cancelar meu pedido')
    expect(menu(loja, true, false)).not.toContain('*8*')
    const r = responder({ acao: 'alterar_pedido_registrar', intencao: 'status_pedido', estado: ESTADO_VAZIO, naoEntendida: false, pedidoId: 'p1' }, loja, { agora, solicitacaoMensagem: 'Anotei!' })
    expect(r.mensagens).toEqual(['Anotei!']); expect(r.autoEstado).toBeNull()
    const q = responder({ acao: 'alterar_pedido_perguntar', intencao: 'status_pedido', estado: ESTADO_VAZIO, naoEntendida: false, pedidoId: 'p1' }, loja, { agora })
    expect(q.mensagens[0]).toContain('Alterar o pedido'); expect(q.autoEstado).toBe('alterar_pedido:p1')
  })
})

describe('IA: planoAlteracao com pedido editável (18/10)', () => {
  const p = { id: 'p', numero: 1, status: 'preparando', forma_pagamento: 'dinheiro', pago: false, pagamento_online: false, impresso: true, cancelado_motivo: null, total: 30 }
  const loja = { pixOnline: false, pixChave: true }
  it('itens/endereço/outro editável → solicitação alterar; cancelar → solicitação cancelar', () => {
    expect(planoAlteracao(p, 'alterar_itens', undefined, loja, true)).toEqual({ tipo: 'solicitacao', tipoSol: 'alterar' })
    expect(planoAlteracao(p, 'alterar_endereco', undefined, loja, true)).toEqual({ tipo: 'solicitacao', tipoSol: 'alterar' })
    expect(planoAlteracao(p, 'cancelar', undefined, loja, true)).toEqual({ tipo: 'solicitacao', tipoSol: 'cancelar' })
  })
  it('não editável (despachado): atendente, como antes; Pix pendente continua cancelando a cobrança', () => {
    expect(planoAlteracao({ ...p, status: 'em_rota' }, 'alterar_itens', undefined, loja, false)).toMatchObject({ tipo: 'atendente' })
    expect(planoAlteracao({ ...p, status: 'aguardando_pagamento' }, 'cancelar', undefined, loja, true)).toEqual({ tipo: 'cancelar_pix_pendente' })
  })
})
