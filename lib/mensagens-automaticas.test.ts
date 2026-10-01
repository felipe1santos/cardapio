import { describe, expect, it } from 'vitest'
import { montarMensagemStatus } from './whatsapp'
import { textoAgendado } from './agendamento'
import {
  configEfetiva, decidirMensagem, etapaDoStatus, normalizarConfig, PADRAO, problemaNoTexto, renderizar, tipoAutomatico,
} from './mensagens-automaticas'
import type { Pedido } from './queries/pedidos'

const pedido = (extra: Partial<Pedido> = {}) => ({ numero: 1234, tipo: 'entrega', canal: 'delivery', clienteNome: 'Maria Souza', agendadoPara: null, ...extra }) as Pedido
const vars = (p: Pedido) => ({ nome: 'Maria', numero: String(p.numero), loja: 'Loja', tipo: p.tipo === 'retirada' ? 'retirada' : 'entrega', horario: p.agendadoPara ? textoAgendado(p.agendadoPara) : '' })

describe('mensagens automáticas', () => {
  it('os modelos padrão renderizam EXATAMENTE o texto que já saía', () => {
    const casos: [keyof typeof PADRAO, Pedido, Parameters<typeof montarMensagemStatus>[1]][] = [
      ['recebido', pedido(), 'recebido'],
      ['agendado', pedido({ agendadoPara: '2026-10-02T22:30:00Z' }), 'recebido'],
      ['agendado', pedido({ tipo: 'retirada', agendadoPara: '2026-10-02T22:30:00Z' }), 'recebido'],
      ['pronto_retirada', pedido({ tipo: 'retirada' }), 'pronto'],
      ['pronto_entrega', pedido(), 'pronto'],
      ['em_rota', pedido(), 'em_rota'],
      ['entregue', pedido(), 'entregue'],
    ]
    for (const [etapa, p, status] of casos) expect(renderizar(PADRAO[etapa], vars(p))).toBe(montarMensagemStatus(p, status))
  })

  it('sem configuração tudo sai com o texto padrão', () => {
    expect(decidirMensagem(null, 'recebido', 'entrega')).toEqual({ sai: true, texto: null })
    expect(decidirMensagem(normalizarConfig(null), 'aceito', 'local')).toEqual({ sai: true, texto: null })
  })

  it('desliga geral, por tipo e por etapa', () => {
    expect(decidirMensagem({ ativo: false }, 'recebido', 'entrega').sai).toBe(false)
    expect(decidirMensagem({ tipos: { local: false } }, 'pronto_entrega', 'local').sai).toBe(false)
    expect(decidirMensagem({ tipos: { local: false } }, 'pronto_entrega', 'entrega').sai).toBe(true)
    expect(decidirMensagem({ etapas: { em_rota: { ativo: false } } }, 'em_rota', 'entrega').sai).toBe(false)
  })

  it('texto próprio só nas etapas personalizáveis', () => {
    expect(decidirMensagem({ etapas: { entregue: { texto: 'Valeu {nome}!' } } }, 'entregue', 'entrega').texto).toBe('Valeu {nome}!')
    expect(normalizarConfig({ etapas: { aceito: { texto: 'x' } } })?.etapas?.aceito?.texto).toBeUndefined()
    expect(renderizar('Oi {nome}, pedido #{numero} da {loja}', { nome: 'Ana', numero: '7', loja: 'Cantina', tipo: '', horario: '' })).toBe('Oi Ana, pedido #7 da Cantina')
  })

  it('etapa e tipo do pedido', () => {
    expect(etapaDoStatus('recebido', 'entrega', true)).toBe('agendado')
    expect(etapaDoStatus('preparando', 'entrega', false)).toBe('aceito')
    expect(etapaDoStatus('pronto', 'retirada', false)).toBe('pronto_retirada')
    expect(etapaDoStatus('cancelado', 'entrega', false)).toBeNull()
    expect(tipoAutomatico('mesa', 'entrega')).toBe('local')
    expect(tipoAutomatico('delivery', 'retirada')).toBe('retirada')
  })

  it('validação do texto', () => {
    expect(problemaNoTexto('')).toMatch(/vazia/)
    expect(problemaNoTexto('Oi {cliente}')).toMatch(/desconhecida: \{cliente\}/)
    expect(problemaNoTexto('Oi {nome}, #{numero}')).toBeNull()
  })

  it('config efetiva preenche os padrões', () => {
    const e = configEfetiva({ tipos: { local: false }, etapas: { entregue: { ativo: false } } })
    expect(e.ativo).toBe(true)
    expect(e.tipos).toEqual({ entrega: true, retirada: true, local: false })
    expect(e.etapas.entregue.ativo).toBe(false)
    expect(e.etapas.recebido).toEqual({ ativo: true, texto: null })
  })
})
