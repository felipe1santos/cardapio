import { describe, expect, it } from 'vitest'
import { colunasKds, corDoTempo, filtrarPorSetor, lerLimites, minutosDesde, pedidosDaCozinha, pedidosDemo, setoresDosPedidos, totalDeItens } from './kds'
import type { Pedido } from './queries/pedidos'

const ped = (x: Partial<Pedido>): Pedido => ({ id: 'p', numero: 1, tipo: 'entrega', status: 'recebido', criadoEm: '2026-10-12T15:00:00Z', agendadoPara: null, itens: [], ...x } as Pedido)
const item = (id: string, itemId: string) => ({ id, itemId, nome: id, descricao: '', precoUnitario: 1, quantidade: 1, observacao: '', complementos: [], tamanhoNome: '', saborNome: '', bordaNome: '', massaNome: '' })

describe('KDS — cor do cronômetro', () => {
  it('verde abaixo de 10 min, amarelo de 10 a 20, vermelho acima de 20 (padrão)', () => {
    expect(corDoTempo(0)).toBe('verde')
    expect(corDoTempo(9.9)).toBe('verde')
    expect(corDoTempo(10)).toBe('amarelo')
    expect(corDoTempo(20)).toBe('amarelo')
    expect(corDoTempo(20.1)).toBe('vermelho')
  })
  it('limites configuráveis; valor guardado inválido volta ao padrão', () => {
    expect(corDoTempo(6, { amarelo: 5, vermelho: 8 })).toBe('amarelo')
    expect(corDoTempo(9, { amarelo: 5, vermelho: 8 })).toBe('vermelho')
    expect(lerLimites('{"amarelo":5,"vermelho":8}')).toEqual({ amarelo: 5, vermelho: 8 })
    expect(lerLimites('{"amarelo":30,"vermelho":8}')).toEqual({ amarelo: 10, vermelho: 20 })
    expect(lerLimites('lixo')).toEqual({ amarelo: 10, vermelho: 20 })
    expect(lerLimites(null)).toEqual({ amarelo: 10, vermelho: 20 })
  })
  it('minutos desde a criação', () => {
    expect(minutosDesde('2026-10-12T15:00:00Z', Date.parse('2026-10-12T15:12:30Z'))).toBe(12.5)
  })
})

describe('KDS — quais pedidos aparecem', () => {
  const agora = new Date('2026-10-12T15:30:00Z')
  it('só recebido e preparando, mais antigos primeiro; agendado só perto da hora', () => {
    const lista = [
      ped({ id: 'b', status: 'preparando', criadoEm: '2026-10-12T15:10:00Z' }),
      ped({ id: 'a', status: 'recebido', criadoEm: '2026-10-12T15:05:00Z' }),
      ped({ id: 'c', status: 'pronto' }),
      ped({ id: 'longe', status: 'recebido', agendadoPara: '2026-10-12T20:00:00Z' }),
      ped({ id: 'perto', status: 'recebido', criadoEm: '2026-10-12T14:00:00Z', agendadoPara: '2026-10-12T15:45:00Z' }),
    ]
    expect(pedidosDaCozinha(lista, agora, 30).map((p) => p.id)).toEqual(['perto', 'a', 'b'])
  })
})

describe('KDS — filtro por setor (categoria do cardápio)', () => {
  const setor = new Map([['x', 'Lanches'], ['y', 'Bebidas']])
  const lista = [ped({ id: '1', itens: [item('i1', 'x'), item('i2', 'y')] }), ped({ id: '2', itens: [item('i3', 'y')] })]
  it('lista os setores presentes, em ordem', () => {
    expect(setoresDosPedidos(lista, setor)).toEqual(['Bebidas', 'Lanches'])
  })
  it('mostra só os itens do setor e esconde pedido sem item dele; "todos" não filtra', () => {
    const f = filtrarPorSetor(lista, setor, 'Lanches')
    expect(f.map((p) => p.id)).toEqual(['1'])
    expect(f[0].itens.map((i) => i.id)).toEqual(['i1'])
    expect(filtrarPorSetor(lista, setor, null)).toBe(lista)
  })
})

describe('KDS — demonstração (prints, sem tocar no banco)', () => {
  it('cenários novo, atrasado e vários', () => {
    const agora = Date.parse('2026-10-12T15:30:00Z')
    expect(pedidosDemo('novo', agora)).toHaveLength(1)
    const atrasado = pedidosDemo('atrasado', agora)
    expect(atrasado.some((p) => minutosDesde(p.criadoEm, agora) > 20)).toBe(true)
    expect(pedidosDemo('varios', agora).length).toBeGreaterThanOrEqual(5)
  })
})

describe('KDS único (12/10): Na fila → Em preparo → Prontos', () => {
  const agora = new Date('2026-10-12T15:30:00Z')
  const lista = [
    ped({ id: 'novo', status: 'recebido', criadoEm: '2026-10-12T15:20:00Z' }), // ainda não aceito no Kanban
    ped({ id: 'fila2', status: 'preparando', criadoEm: '2026-10-12T15:10:00Z', preparandoPor: null }),
    ped({ id: 'fila1', status: 'preparando', criadoEm: '2026-10-12T15:00:00Z', preparandoPor: null }),
    ped({ id: 'fazendo', status: 'preparando', criadoEm: '2026-10-12T15:05:00Z', preparandoPor: 'Ana' }),
    ped({ id: 'pronto1', status: 'pronto', criadoEm: '2026-10-12T14:00:00Z', atualizadoEm: '2026-10-12T15:25:00Z' }),
    ped({ id: 'pronto2', status: 'pronto', criadoEm: '2026-10-12T14:10:00Z', atualizadoEm: '2026-10-12T15:28:00Z' }),
    ped({ id: 'rota', status: 'em_rota' }),
  ]
  it('fila = aceitos sem preparo começado (mais antigo primeiro); preparo = começados; prontos = mais recentes primeiro', () => {
    const c = colunasKds(lista, agora, 30)
    expect(c.fila.map((p) => p.id)).toEqual(['fila1', 'fila2'])
    expect(c.preparo.map((p) => p.id)).toEqual(['fazendo'])
    expect(c.prontos.map((p) => p.id)).toEqual(['pronto2', 'pronto1'])
    expect(c.aguardandoAceite).toBe(1)
  })
  it('prontos: no máximo 8', () => {
    const muitos = Array.from({ length: 12 }, (_, i) => ped({ id: `p${i}`, status: 'pronto', atualizadoEm: `2026-10-12T15:${String(10 + i).padStart(2, '0')}:00Z` }))
    expect(colunasKds(muitos, agora, 30).prontos).toHaveLength(8)
  })
})

describe('KDS — total de itens (painel lateral)', () => {
  it('soma a quantidade do mesmo item (com o mesmo tamanho/sabor) entre pedidos, maior primeiro', () => {
    const a = { ...item('a1', 'x'), nome: 'X-Bacon', quantidade: 2 }
    const b = { ...item('b1', 'x'), nome: 'X-Bacon', quantidade: 1 }
    const c = { ...item('c1', 'p'), nome: 'Pizza', tamanhoNome: 'Grande', quantidade: 1 }
    const d = { ...item('d1', 'p'), nome: 'Pizza', tamanhoNome: 'Média', quantidade: 1 }
    expect(totalDeItens([ped({ id: 'A', itens: [a, c] }), ped({ id: 'B', itens: [b, d] })])).toEqual([
      { nome: 'X-Bacon', detalhe: '', quantidade: 3 },
      { nome: 'Pizza', detalhe: 'Grande', quantidade: 1 },
      { nome: 'Pizza', detalhe: 'Média', quantidade: 1 },
    ])
  })
})
