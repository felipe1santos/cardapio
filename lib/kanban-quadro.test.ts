import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pedido } from './queries/pedidos'
import { aplicarNoQuadro, criarColetorEventos, criarFila, idsDoEvento, mesclarConcluidos, novosSemItens, QUADRO_VAZIO, type Quadro } from './kanban-quadro'

describe('criarFila (recargas em fila, uma de cada vez)', () => {
  it('recargas completas pedidas enquanto outra ESPERA na fila viram uma só', async () => {
    const fila = criarFila()
    let soltar: () => void = () => {}
    const rodando = new Promise<void>((r) => { soltar = r })
    const feitas: string[] = []
    const a = fila.rodar(async () => { feitas.push('a'); await rodando })
    const b = fila.rodarCompleto(async () => { feitas.push('b') })
    const c = fila.rodarCompleto(async () => { feitas.push('c') })
    const d = fila.rodarCompleto(async () => { feitas.push('d') })
    soltar()
    await Promise.all([a, b, c, d])
    expect(feitas).toEqual(['a', 'b']) // carga inicial + UMA sincronização
  })

  it('pedida depois que a anterior começou, roda de novo (pode ter mudado no meio)', async () => {
    const fila = criarFila()
    const feitas: number[] = []
    await fila.rodarCompleto(async () => { feitas.push(1) })
    await fila.rodarCompleto(async () => { feitas.push(2) })
    expect(feitas).toEqual([1, 2])
  })

  it('trabalhos curtos (encaixe de evento) nunca são descartados', async () => {
    const fila = criarFila()
    const feitas: string[] = []
    await Promise.all([fila.rodar(async () => { feitas.push('x') }), fila.rodar(async () => { feitas.push('y') })])
    expect(feitas).toEqual(['x', 'y'])
  })
})

/**
 * Achado #5 da auditoria (25/10): todo evento em `pedidos` relia o Kanban inteiro (ativos + logística + TODOS os
 * concluídos do dia, ~2,2 KB por pedido), sem debounce. Agora o evento busca só o pedido que mudou e o encaixa na coluna
 * certa — as mesmas regras das consultas de lista (listarPedidosKanban, listarPedidosLogistica, listarPedidosConcluidos).
 */

const INICIO_DIA = '2026-10-25T03:00:00.000Z'
const AGORA = new Date('2026-10-25T20:00:00.000Z')
const ctx = { agora: AGORA, liberaMin: 30, inicioDia: INICIO_DIA }

function p(id: string, extra: Partial<Pedido> = {}): Pedido {
  return { id, numero: Number(id.replace(/\D/g, '')) || 1, tipo: 'entrega', status: 'recebido', criadoEm: '2026-10-25T19:00:00.000Z', atualizadoEm: '2026-10-25T19:00:00.000Z', agendadoPara: null, itens: [], ...extra } as Pedido
}

const ids = (l: Pedido[]) => l.map((x) => x.id)

describe('aplicarNoQuadro', () => {
  it('pedido novo "recebido" entra nos ativos, em ordem de criação', () => {
    const q: Quadro = { ...QUADRO_VAZIO, orders: [p('p1', { criadoEm: '2026-10-25T18:00:00.000Z' }), p('p3', { criadoEm: '2026-10-25T19:30:00.000Z' })] }
    const r = aplicarNoQuadro(q, [p('p2', { criadoEm: '2026-10-25T19:00:00.000Z' })], [], ctx)
    expect(ids(r.orders)).toEqual(['p1', 'p2', 'p3'])
  })

  it('mudança de status dentro do Kanban troca a linha no lugar', () => {
    const q: Quadro = { ...QUADRO_VAZIO, orders: [p('p1'), p('p2')] }
    const r = aplicarNoQuadro(q, [p('p1', { status: 'preparando' })], [], ctx)
    expect(r.orders.map((x) => [x.id, x.status])).toEqual([['p1', 'preparando'], ['p2', 'recebido']])
  })

  it('entrega que saiu (em_rota) deixa os ativos e entra em trânsito', () => {
    const q: Quadro = { ...QUADRO_VAZIO, orders: [p('p1', { status: 'pronto' })] }
    const r = aplicarNoQuadro(q, [p('p1', { status: 'em_rota' })], [], ctx)
    expect(ids(r.orders)).toEqual([])
    expect(ids(r.transit)).toEqual(['p1'])
  })

  it('retirada em_rota não aparece em trânsito (a logística só lista entregas)', () => {
    const r = aplicarNoQuadro(QUADRO_VAZIO, [p('p1', { tipo: 'retirada', status: 'em_rota' })], [], ctx)
    expect(ids(r.transit)).toEqual([])
    expect(ids(r.orders)).toEqual([])
  })

  it('entregue hoje sai do trânsito e entra no topo dos concluídos', () => {
    const q: Quadro = { ...QUADRO_VAZIO, transit: [p('p1', { status: 'em_rota' })], concluded: [p('p9', { status: 'entregue', atualizadoEm: '2026-10-25T19:10:00.000Z' })] }
    const r = aplicarNoQuadro(q, [p('p1', { status: 'entregue', atualizadoEm: '2026-10-25T19:50:00.000Z' })], [], ctx)
    expect(ids(r.transit)).toEqual([])
    expect(ids(r.concluded)).toEqual(['p1', 'p9'])
  })

  it('concluído com atualização de antes de hoje não entra', () => {
    const r = aplicarNoQuadro(QUADRO_VAZIO, [p('p1', { status: 'cancelado', atualizadoEm: '2026-10-24T22:00:00.000Z' })], [], ctx)
    expect(ids(r.concluded)).toEqual([])
  })

  it('agendado ainda fora da janela vai para a faixa de agendados, ordenado pelo horário', () => {
    const q: Quadro = { ...QUADRO_VAZIO, agendados: [p('p5', { agendadoPara: '2026-10-25T23:00:00.000Z' })] }
    const r = aplicarNoQuadro(q, [p('p1', { agendadoPara: '2026-10-25T22:00:00.000Z' })], [], ctx)
    expect(ids(r.orders)).toEqual([])
    expect(ids(r.agendados)).toEqual(['p1', 'p5'])
  })

  it('agendado dentro da janela já vai para os ativos', () => {
    const r = aplicarNoQuadro(QUADRO_VAZIO, [p('p1', { agendadoPara: '2026-10-25T20:20:00.000Z' })], [], ctx)
    expect(ids(r.orders)).toEqual(['p1'])
    expect(ids(r.agendados)).toEqual([])
  })

  it('"aguardando_pagamento" (Pix online) não aparece em coluna nenhuma', () => {
    const q: Quadro = { ...QUADRO_VAZIO, orders: [p('p1')] }
    const r = aplicarNoQuadro(q, [p('p1', { status: 'aguardando_pagamento' as Pedido['status'] })], [], ctx)
    expect(ids(r.orders)).toEqual([])
  })

  it('pedido apagado sai de todas as listas', () => {
    const q: Quadro = { orders: [p('p1')], agendados: [], transit: [p('p2', { status: 'em_rota' })], concluded: [p('p3', { status: 'entregue' })] }
    const r = aplicarNoQuadro(q, [], ['p1', 'p2', 'p3'], ctx)
    expect([...r.orders, ...r.transit, ...r.concluded]).toEqual([])
  })

  it('id alterado mas não devolvido pela busca (sumiu da RLS) também sai', () => {
    const q: Quadro = { ...QUADRO_VAZIO, orders: [p('p1')] }
    const r = aplicarNoQuadro(q, [], ['p1'], ctx)
    expect(r.orders).toEqual([])
  })
})

describe('mesclarConcluidos: pedido que voltou para os ativos (revisão 26/10)', () => {
  it('sai dos concluídos quando aparece entre os ativos', () => {
    const atual = [p('a', { status: 'entregue', atualizadoEm: '2026-10-25T19:00:00.000Z' }), p('b', { status: 'entregue', atualizadoEm: '2026-10-25T19:10:00.000Z' })]
    const r = mesclarConcluidos(atual, [], INICIO_DIA, new Set(['a']))
    expect(ids(r)).toEqual(['b'])
  })
})

describe('mesclarConcluidos (delta do relógio)', () => {
  it('troca por id, ordena do mais recente e larga o que é de antes de hoje', () => {
    const atual = [p('a', { status: 'entregue', atualizadoEm: '2026-10-25T19:00:00.000Z' }), p('velho', { status: 'entregue', atualizadoEm: '2026-10-24T23:00:00.000Z' })]
    const delta = [p('a', { status: 'entregue', atualizadoEm: '2026-10-25T19:40:00.000Z', total: 99 }), p('b', { status: 'cancelado', atualizadoEm: '2026-10-25T19:20:00.000Z' })]
    const r = mesclarConcluidos(atual, delta, INICIO_DIA)
    expect(ids(r)).toEqual(['a', 'b'])
    expect(r[0].total).toBe(99)
  })
})

describe('novosSemItens (revisão 26/10)', () => {
  it('pedido recebido que chegou sem itens é buscado de novo; os outros não', () => {
    const lista = [p('p1', { status: 'recebido', itens: [] }), p('p2', { status: 'recebido', itens: [{} as Pedido['itens'][number]] }), p('p3', { status: 'preparando', itens: [] })]
    expect(novosSemItens(lista)).toEqual(['p1'])
  })
})

describe('idsDoEvento', () => {
  it('UPDATE/INSERT dão o id alterado; DELETE dá o id removido', () => {
    expect(idsDoEvento({ eventType: 'UPDATE', new: { id: 'p1' }, old: { id: 'p1' } })).toEqual({ alterado: 'p1' })
    expect(idsDoEvento({ eventType: 'INSERT', new: { id: 'p2' }, old: {} })).toEqual({ alterado: 'p2' })
    expect(idsDoEvento({ eventType: 'DELETE', new: {}, old: { id: 'p3' } })).toEqual({ removido: 'p3' })
    expect(idsDoEvento({ eventType: 'UPDATE', new: {}, old: {} })).toEqual({})
  })
})

describe('criarColetorEventos (debounce)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('rajada de eventos vira UMA busca, com os ids sem repetição', () => {
    const descarregar = vi.fn()
    const c = criarColetorEventos({ esperaMs: 400, maxIds: 25, descarregar })
    c.pedido({ alterado: 'p1' })
    c.pedido({ alterado: 'p1' })
    c.pedido({ alterado: 'p2' })
    c.pedido({ removido: 'p3' })
    expect(descarregar).not.toHaveBeenCalled()
    vi.advanceTimersByTime(400)
    expect(descarregar).toHaveBeenCalledTimes(1)
    const lote = descarregar.mock.calls[0][0]
    expect([...lote.alterados].sort()).toEqual(['p1', 'p2'])
    expect([...lote.removidos]).toEqual(['p3'])
    expect(lote.completo).toBe(false)
  })

  it('a espera conta do primeiro evento: evento contínuo não adia a busca para sempre', () => {
    const descarregar = vi.fn()
    const c = criarColetorEventos({ esperaMs: 400, maxIds: 25, descarregar })
    for (let i = 0; i < 10; i++) { c.pedido({ alterado: `p${i}` }); vi.advanceTimersByTime(100) }
    expect(descarregar.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('muitos pedidos de uma vez viram uma recarga completa', () => {
    const descarregar = vi.fn()
    const c = criarColetorEventos({ esperaMs: 400, maxIds: 3, descarregar })
    for (const id of ['a', 'b', 'c', 'd']) c.pedido({ alterado: id })
    vi.advanceTimersByTime(400)
    expect(descarregar.mock.calls[0][0].completo).toBe(true)
  })

  it('corridas e solicitações só pedem a própria lista', () => {
    const descarregar = vi.fn()
    const c = criarColetorEventos({ esperaMs: 400, maxIds: 25, descarregar })
    c.tabela('entregas_provedor')
    c.tabela('pedido_solicitacoes')
    vi.advanceTimersByTime(400)
    expect(descarregar.mock.calls[0][0]).toMatchObject({ corridas: true, solicitacoes: true, completo: false })
    expect(descarregar.mock.calls[0][0].alterados.size).toBe(0)
  })

  it('cancelar não descarrega depois de desmontar', () => {
    const descarregar = vi.fn()
    const c = criarColetorEventos({ esperaMs: 400, maxIds: 25, descarregar })
    c.pedido({ alterado: 'p1' })
    c.cancelar()
    vi.advanceTimersByTime(1000)
    expect(descarregar).not.toHaveBeenCalled()
  })
})
