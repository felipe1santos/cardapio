import { describe, expect, it } from 'vitest'
import { acertoDosEntregadores, diaSaoPaulo, resumoDoDia, turnoDoInstante, type FechamentoEntregador, type PedidoCaixa, type Turno } from './caixa-turno'

// Horários em São Paulo (UTC−3): "2026-09-29T21:00-03:00".
const sp = (s: string) => new Date(`${s}-03:00`).toISOString()

const pedido = (id: string, entregueEm: string | null, total: number, extra: Partial<PedidoCaixa> = {}): PedidoCaixa => ({
  id, entregadorId: 'ze', entregadorNome: 'Zé', total, trocoPara: null, formaPagamento: 'dinheiro', status: 'entregue', entregueEm, ...extra,
})

describe('turno de caixa', () => {
  // Turno da noite passando da meia-noite: 29/09 18:00 → 30/09 02:00.
  const noite: Turno = { id: 't-noite', abertoEm: sp('2026-09-29T18:00'), fechadoEm: sp('2026-09-30T02:00') }

  it('pedido entregue depois da meia-noite pertence ao turno que abriu na véspera', () => {
    expect(turnoDoInstante([noite], sp('2026-09-30T00:40'))?.id).toBe('t-noite')
    expect(turnoDoInstante([noite], sp('2026-09-30T02:00'))).toBeNull() // fechou às 2h
  })

  it('acerto do entregador: só o turno, e troco levado = nota do cliente − total', () => {
    const pedidos = [
      pedido('a', sp('2026-09-29T20:10'), 45, { trocoPara: 50 }),
      pedido('b', sp('2026-09-30T00:40'), 30, { trocoPara: 100 }),
      pedido('antigo', sp('2026-09-28T21:00'), 99), // outro dia, outro turno: não entra
      pedido('pix', sp('2026-09-29T21:00'), 20, { formaPagamento: 'pix' }),
      pedido('rota', null, 25, { status: 'em_rota' }),
    ]
    const [ze] = acertoDosEntregadores(noite, pedidos, [])
    expect(ze).toMatchObject({ valorEsperado: 75, trocoLevado: 75, pedidos: 2, emRota: 1 })
  })

  it('depois de registrar o fechamento o esperado zera; o que vem depois abre outro acerto', () => {
    const fech: FechamentoEntregador[] = [{ entregadorId: 'ze', turnoId: 't-noite', fechadoEm: sp('2026-09-29T23:00'), valorEsperado: 45, valorDeclarado: 45 }]
    const antes = [pedido('a', sp('2026-09-29T20:10'), 45)]
    expect(acertoDosEntregadores(noite, antes, fech)).toEqual([])
    const depois = [...antes, pedido('b', sp('2026-09-30T00:40'), 30)]
    expect(acertoDosEntregadores(noite, depois, fech)[0]).toMatchObject({ valorEsperado: 30, pedidos: 1 })
  })

  it('dois turnos no mesmo dia: cada pedido vai para o seu, e o resumo do dia soma os dois', () => {
    const almoco: Turno = { id: 't-almoco', abertoEm: sp('2026-09-29T11:00'), fechadoEm: sp('2026-09-29T15:00') }
    const pedidos = [
      pedido('a1', sp('2026-09-29T12:00'), 40),
      pedido('a2', sp('2026-09-29T14:30'), 10),
      pedido('n1', sp('2026-09-29T20:00'), 50),
      pedido('n2', sp('2026-09-30T01:30'), 20), // madrugada: turno da noite, dia 29
      pedido('fora', sp('2026-09-29T16:00'), 7), // caixa fechado
    ]
    const fech: FechamentoEntregador[] = [
      { entregadorId: 'ze', turnoId: 't-almoco', fechadoEm: sp('2026-09-29T15:00'), valorEsperado: 50, valorDeclarado: 48 },
      { entregadorId: 'ze', turnoId: 't-noite', fechadoEm: sp('2026-09-30T02:00'), valorEsperado: 70, valorDeclarado: 70 },
    ]
    const pagamentos = [
      { forma: 'pix', valor: 30, criadoEm: sp('2026-09-29T13:00'), estornado: false },
      { forma: 'pix', valor: 15, criadoEm: sp('2026-09-30T00:10'), estornado: false },
      { forma: 'dinheiro', valor: 9, criadoEm: sp('2026-09-29T21:00'), estornado: true },
    ]
    expect(acertoDosEntregadores(almoco, pedidos, [])[0].valorEsperado).toBe(50)
    expect(acertoDosEntregadores(noite, pedidos, [])[0].valorEsperado).toBe(70)
    const dia = resumoDoDia('2026-09-29', [noite, almoco], pedidos, fech, pagamentos)
    expect(dia.turnos.map((t) => t.turnoId)).toEqual(['t-almoco', 't-noite'])
    expect(dia).toMatchObject({ entregasEmDinheiro: 4, dinheiroEsperado: 120, dinheiroDeclarado: 118, diferenca: -2, foraDeTurno: 1 })
    expect(dia.pagamentosPorForma).toEqual({ pix: 45 })
    // O dia 30 não recebe o turno da noite que abriu no dia 29.
    expect(resumoDoDia('2026-09-30', [noite, almoco], pedidos, fech, pagamentos).turnos).toEqual([])
  })

  it('dia de São Paulo, não de UTC', () => {
    expect(diaSaoPaulo(sp('2026-09-29T22:30'))).toBe('2026-09-29') // 01:30 UTC do dia 30
  })

  it('turno ainda aberto aceita pedidos até agora', () => {
    const aberto: Turno = { id: 't', abertoEm: sp('2026-09-29T18:00'), fechadoEm: null }
    expect(turnoDoInstante([aberto], sp('2026-09-30T03:00'))?.id).toBe('t')
  })
})
