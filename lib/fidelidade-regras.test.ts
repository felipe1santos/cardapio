import { describe, expect, it } from 'vitest'
import {
  aplicarPedidoAoProgresso,
  calcularDesconto,
  fracaoProgresso,
  montarBlocoRecompensa,
  montarLinhaProgresso,
  montarMensagemFidelidade,
  pedidoContaParaCampanha,
  podeResgatarHoje,
  premioLabelCampanha,
  resumoProgresso,
  validarCupom,
  type CampanhaFidelidade,
  type CupomRegra,
  type HistoricoCliente,
  type ProgressoCliente,
} from './fidelidade-regras'

// ── Fábricas de fixtures — só sobrescreve o que o teste precisa ────────────

function campanha(overrides: Partial<CampanhaFidelidade> = {}): CampanhaFidelidade {
  return {
    id: 'c1',
    nome: 'Campanha Teste',
    descricao: '',
    ativa: true,
    tipoMeta: 'valor_gasto',
    metaValor: 100,
    metaQuantidade: null,
    diasSemanaContam: [],
    diasSemanaResgate: [],
    premioTipo: 'desconto_percentual',
    premioItemId: null,
    premioValor: 10,
    repetivel: true,
    ...overrides,
  }
}

function progresso(overrides: Partial<ProgressoCliente> = {}): ProgressoCliente {
  return { progressoValor: 0, progressoQtd: 0, ciclosCompletados: 0, ...overrides }
}

function cupom(overrides: Partial<CupomRegra> = {}): CupomRegra {
  return {
    ativo: true,
    tipo: 'desconto_percentual',
    valor: 10,
    publico: 'todos',
    diasInatividade: null,
    diasSemana: [],
    validadeInicio: null,
    validadeFim: null,
    valorMinimoPedido: null,
    usoUnicoPorCliente: false,
    maxUsos: null,
    usos: 0,
    ...overrides,
  }
}

function hist(overrides: Partial<HistoricoCliente> = {}): HistoricoCliente {
  return { totalPedidosEntregues: 0, ultimoPedidoEm: null, jaUsouEsteCupom: false, ...overrides }
}

describe('pedidoContaParaCampanha', () => {
  it('campanha inativa nunca conta', () => {
    const c = campanha({ ativa: false })
    expect(pedidoContaParaCampanha(c, progresso(), 3)).toBe(false)
  })

  it('repetivel=false + ciclosCompletados>=1 não conta mais', () => {
    const c = campanha({ repetivel: false })
    expect(pedidoContaParaCampanha(c, progresso({ ciclosCompletados: 1 }), 3)).toBe(false)
  })

  it('repetivel=false + ciclosCompletados=0 ainda conta', () => {
    const c = campanha({ repetivel: false })
    expect(pedidoContaParaCampanha(c, progresso({ ciclosCompletados: 0 }), 3)).toBe(true)
  })

  it('diasSemanaContam=[3] só conta pedido de quarta', () => {
    const c = campanha({ diasSemanaContam: [3] })
    expect(pedidoContaParaCampanha(c, progresso(), 3)).toBe(true)
    expect(pedidoContaParaCampanha(c, progresso(), 2)).toBe(false)
  })

  it('diasSemanaContam vazio conta qualquer dia', () => {
    const c = campanha({ diasSemanaContam: [] })
    expect(pedidoContaParaCampanha(c, progresso(), 0)).toBe(true)
    expect(pedidoContaParaCampanha(c, progresso(), 6)).toBe(true)
  })
})

describe('aplicarPedidoAoProgresso', () => {
  it('valor_gasto: soma subtotal ao progresso', () => {
    const c = campanha({ tipoMeta: 'valor_gasto', metaValor: 100 })
    const { novo, completou } = aplicarPedidoAoProgresso(c, progresso({ progressoValor: 30 }), { subtotal: 20, qtdItens: 1 })
    expect(novo.progressoValor).toBe(50)
    expect(completou).toBe(false)
  })

  it('valor_gasto: completa exatamente na meta', () => {
    const c = campanha({ tipoMeta: 'valor_gasto', metaValor: 100 })
    const { novo, completou } = aplicarPedidoAoProgresso(c, progresso({ progressoValor: 70 }), { subtotal: 30, qtdItens: 1 })
    expect(completou).toBe(true)
    expect(novo.progressoValor).toBe(0)
    expect(novo.ciclosCompletados).toBe(1)
  })

  it('valor_gasto: excedente não transborda pro próximo ciclo (zera)', () => {
    const c = campanha({ tipoMeta: 'valor_gasto', metaValor: 50 })
    const { novo, completou } = aplicarPedidoAoProgresso(c, progresso({ progressoValor: 40 }), { subtotal: 20, qtdItens: 1 })
    expect(completou).toBe(true)
    expect(novo.progressoValor).toBe(0) // não fica 10 (40+20-50)
  })

  it('qtd_pedidos: +1 por pedido, independente da quantidade de itens', () => {
    const c = campanha({ tipoMeta: 'qtd_pedidos', metaQuantidade: 5 })
    const { novo, completou } = aplicarPedidoAoProgresso(c, progresso({ progressoQtd: 2 }), { subtotal: 10, qtdItens: 3 })
    expect(novo.progressoQtd).toBe(3)
    expect(completou).toBe(false)
  })

  it('qtd_itens: soma qtdItens do pedido', () => {
    const c = campanha({ tipoMeta: 'qtd_itens', metaQuantidade: 10 })
    const { novo, completou } = aplicarPedidoAoProgresso(c, progresso({ progressoQtd: 4 }), { subtotal: 10, qtdItens: 3 })
    expect(novo.progressoQtd).toBe(7)
    expect(completou).toBe(false)
  })

  it('repetivel=true: ao completar, progresso zera e ciclosCompletados incrementa', () => {
    const c = campanha({ tipoMeta: 'qtd_pedidos', metaQuantidade: 3, repetivel: true })
    const { novo, completou } = aplicarPedidoAoProgresso(
      c,
      progresso({ progressoQtd: 2, ciclosCompletados: 1 }),
      { subtotal: 10, qtdItens: 1 }
    )
    expect(completou).toBe(true)
    expect(novo.progressoQtd).toBe(0)
    expect(novo.ciclosCompletados).toBe(2)
  })

  it('repetivel=false + ciclosCompletados>=1: não altera o progresso (defensivo)', () => {
    const c = campanha({ tipoMeta: 'qtd_pedidos', metaQuantidade: 3, repetivel: false })
    const base = progresso({ progressoQtd: 1, ciclosCompletados: 1 })
    const { novo, completou } = aplicarPedidoAoProgresso(c, base, { subtotal: 10, qtdItens: 1 })
    expect(completou).toBe(false)
    expect(novo).toEqual(base)
  })
})

describe('resumoProgresso', () => {
  it('valor_gasto: "Faltam R$ 25,00"', () => {
    const c = campanha({ tipoMeta: 'valor_gasto', metaValor: 100 })
    const r = resumoProgresso(c, progresso({ progressoValor: 75 }))
    expect(r.faltaTexto).toBe('Faltam R$ 25,00')
    expect(r.percentual).toBe(75)
  })

  it('qtd_pedidos: "Faltam 2 pedidos"', () => {
    const c = campanha({ tipoMeta: 'qtd_pedidos', metaQuantidade: 5 })
    const r = resumoProgresso(c, progresso({ progressoQtd: 3 }))
    expect(r.faltaTexto).toBe('Faltam 2 pedidos')
    expect(r.percentual).toBe(60)
  })

  it('qtd_itens: "Falta 1 item" (singular)', () => {
    const c = campanha({ tipoMeta: 'qtd_itens', metaQuantidade: 10 })
    const r = resumoProgresso(c, progresso({ progressoQtd: 9 }))
    expect(r.faltaTexto).toBe('Falta 1 item')
  })

  it('qtd_pedidos: "Falta 1 pedido" (singular)', () => {
    const c = campanha({ tipoMeta: 'qtd_pedidos', metaQuantidade: 5 })
    const r = resumoProgresso(c, progresso({ progressoQtd: 4 }))
    expect(r.faltaTexto).toBe('Falta 1 pedido')
  })

  it('percentual nunca passa de 100 (clamp)', () => {
    const c = campanha({ tipoMeta: 'valor_gasto', metaValor: 100 })
    const r = resumoProgresso(c, progresso({ progressoValor: 150 }))
    expect(r.percentual).toBe(100)
  })

  it('percentual nunca fica negativo (clamp)', () => {
    const c = campanha({ tipoMeta: 'qtd_pedidos', metaQuantidade: 5 })
    const r = resumoProgresso(c, progresso({ progressoQtd: 0 }))
    expect(r.percentual).toBe(0)
  })
})

describe('podeResgatarHoje', () => {
  it('vazio = sempre pode resgatar', () => {
    expect(podeResgatarHoje([], 0)).toBe(true)
    expect(podeResgatarHoje([], 5)).toBe(true)
  })

  it('[3] só permite resgate na quarta', () => {
    expect(podeResgatarHoje([3], 3)).toBe(true)
    expect(podeResgatarHoje([3], 2)).toBe(false)
  })
})

describe('validarCupom', () => {
  const ctxBase = { subtotal: 50, diaSemana: 3, hojeISO: '2026-07-14' }

  it('cupom inativo é recusado', () => {
    const r = validarCupom(cupom({ ativo: false }), hist(), ctxBase)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBeTruthy()
  })

  it('fora do dia da semana permitido é recusado', () => {
    const r = validarCupom(cupom({ diasSemana: [3] }), hist(), { ...ctxBase, diaSemana: 2 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('quartas')
  })

  it('dentro do dia da semana permitido passa', () => {
    const r = validarCupom(cupom({ diasSemana: [3] }), hist(), { ...ctxBase, diaSemana: 3 })
    expect(r.ok).toBe(true)
  })

  it('fora da validade (antes do início) é recusado', () => {
    const r = validarCupom(cupom({ validadeInicio: '2026-08-01' }), hist(), ctxBase)
    expect(r.ok).toBe(false)
  })

  it('fora da validade (depois do fim) é recusado', () => {
    const r = validarCupom(cupom({ validadeFim: '2026-07-01' }), hist(), ctxBase)
    expect(r.ok).toBe(false)
  })

  it('subtotal abaixo do mínimo é recusado', () => {
    const r = validarCupom(cupom({ valorMinimoPedido: 60 }), hist(), ctxBase)
    expect(r.ok).toBe(false)
  })

  it('subtotal igual ou acima do mínimo passa', () => {
    const r = validarCupom(cupom({ valorMinimoPedido: 50 }), hist(), ctxBase)
    expect(r.ok).toBe(true)
  })

  it('publico primeira_compra com pedidos anteriores é recusado', () => {
    const r = validarCupom(cupom({ publico: 'primeira_compra' }), hist({ totalPedidosEntregues: 2 }), ctxBase)
    expect(r.ok).toBe(false)
  })

  it('publico primeira_compra sem pedidos anteriores passa', () => {
    const r = validarCupom(cupom({ publico: 'primeira_compra' }), hist({ totalPedidosEntregues: 0 }), ctxBase)
    expect(r.ok).toBe(true)
  })

  it('publico recompra: totalPedidosEntregues<=1 passa mesmo sem inatividade', () => {
    const r = validarCupom(
      cupom({ publico: 'recompra', diasInatividade: 30 }),
      hist({ totalPedidosEntregues: 1, ultimoPedidoEm: '2026-07-13' }),
      ctxBase
    )
    expect(r.ok).toBe(true)
  })

  it('publico recompra: ultimoPedidoEm mais antigo que diasInatividade passa', () => {
    const r = validarCupom(
      cupom({ publico: 'recompra', diasInatividade: 30 }),
      hist({ totalPedidosEntregues: 5, ultimoPedidoEm: '2026-05-01' }),
      ctxBase
    )
    expect(r.ok).toBe(true)
  })

  it('publico recompra: cliente com >1 pedido e ativo recente é recusado', () => {
    const r = validarCupom(
      cupom({ publico: 'recompra', diasInatividade: 30 }),
      hist({ totalPedidosEntregues: 5, ultimoPedidoEm: '2026-07-10' }),
      ctxBase
    )
    expect(r.ok).toBe(false)
  })

  it('uso único já usado por esse cliente é recusado', () => {
    const r = validarCupom(cupom({ usoUnicoPorCliente: true }), hist({ jaUsouEsteCupom: true }), ctxBase)
    expect(r.ok).toBe(false)
  })

  it('uso único ainda não usado passa', () => {
    const r = validarCupom(cupom({ usoUnicoPorCliente: true }), hist({ jaUsouEsteCupom: false }), ctxBase)
    expect(r.ok).toBe(true)
  })

  it('maxUsos atingido é recusado', () => {
    const r = validarCupom(cupom({ maxUsos: 100, usos: 100 }), hist(), ctxBase)
    expect(r.ok).toBe(false)
  })

  it('maxUsos não atingido passa', () => {
    const r = validarCupom(cupom({ maxUsos: 100, usos: 99 }), hist(), ctxBase)
    expect(r.ok).toBe(true)
  })
})

describe('calcularDesconto', () => {
  it('desconto_percentual arredonda em 2 casas', () => {
    const r = calcularDesconto('desconto_percentual', 33.333, 100, 10)
    expect(r.descontoSubtotal).toBe(33.33)
    expect(r.zeraFrete).toBe(false)
  })

  it('desconto_valor maior que subtotal trava no subtotal', () => {
    const r = calcularDesconto('desconto_valor', 200, 50, 10)
    expect(r.descontoSubtotal).toBe(50)
    expect(r.zeraFrete).toBe(false)
  })

  it('desconto_valor menor que subtotal aplica o valor cheio', () => {
    const r = calcularDesconto('desconto_valor', 15, 50, 10)
    expect(r.descontoSubtotal).toBe(15)
  })

  it('entrega_gratis zera frete e não desconta subtotal', () => {
    const r = calcularDesconto('entrega_gratis', null, 50, 10)
    expect(r).toEqual({ descontoSubtotal: 0, zeraFrete: true })
  })

  it('item_gratis não gera desconto em R$ nem zera frete (item entra como linha R$ 0)', () => {
    const r = calcularDesconto('item_gratis', null, 50, 10)
    expect(r).toEqual({ descontoSubtotal: 0, zeraFrete: false })
  })

  it('desconto nunca é negativo', () => {
    const r = calcularDesconto('desconto_valor', -10, 50, 10)
    expect(r.descontoSubtotal).toBe(0)
  })
})

describe('fracaoProgresso', () => {
  it('valor_gasto não tem fração (progresso em dinheiro, não faz sentido "X/Y")', () => {
    const c = campanha({ tipoMeta: 'valor_gasto', metaValor: 100 })
    expect(fracaoProgresso(c, progresso({ progressoValor: 75 }))).toBeNull()
  })

  it('qtd_pedidos retorna "3/5"', () => {
    const c = campanha({ tipoMeta: 'qtd_pedidos', metaQuantidade: 5 })
    expect(fracaoProgresso(c, progresso({ progressoQtd: 3 }))).toBe('3/5')
  })

  it('qtd_itens retorna "8/10"', () => {
    const c = campanha({ tipoMeta: 'qtd_itens', metaQuantidade: 10 })
    expect(fracaoProgresso(c, progresso({ progressoQtd: 8 }))).toBe('8/10')
  })
})

describe('premioLabelCampanha', () => {
  it('item_gratis usa o nome do item + "grátis"', () => {
    const c = campanha({ premioTipo: 'item_gratis', premioValor: null })
    expect(premioLabelCampanha(c, 'X-Tudo')).toBe('X-Tudo grátis')
  })

  it('item_gratis sem nome carregado usa fallback', () => {
    const c = campanha({ premioTipo: 'item_gratis', premioValor: null })
    expect(premioLabelCampanha(c, undefined)).toBe('item grátis')
  })

  it('desconto_percentual', () => {
    const c = campanha({ premioTipo: 'desconto_percentual', premioValor: 10 })
    expect(premioLabelCampanha(c)).toBe('10% de desconto')
  })

  it('desconto_valor formata em reais', () => {
    const c = campanha({ premioTipo: 'desconto_valor', premioValor: 15 })
    expect(premioLabelCampanha(c)).toBe('R$ 15,00 de desconto')
  })

  it('entrega_gratis', () => {
    const c = campanha({ premioTipo: 'entrega_gratis', premioValor: null })
    expect(premioLabelCampanha(c)).toBe('entrega grátis')
  })
})

describe('montarLinhaProgresso', () => {
  it('com fração (campanha por quantidade)', () => {
    const linha = montarLinhaProgresso({ faltaTexto: 'Faltam 2 pedidos', premioLabel: '1 X-Tudo grátis', fracao: '8/10' })
    expect(linha).toBe('• Faltam 2 pedidos para ganhar 1 X-Tudo grátis (8/10)')
  })

  it('sem fração (campanha por valor gasto)', () => {
    const linha = montarLinhaProgresso({ faltaTexto: 'Faltam R$ 25,00', premioLabel: '10% de desconto', fracao: null })
    expect(linha).toBe('• Faltam R$ 25,00 para ganhar 10% de desconto')
  })
})

describe('montarBlocoRecompensa', () => {
  it('com dias de resgate restritos', () => {
    const bloco = montarBlocoRecompensa({ premioLabel: 'Batata Frita grátis', diasSemanaResgate: [3] })
    expect(bloco).toBe('🎉 PRÊMIO DESBLOQUEADO: Batata Frita grátis!\nResgate na aba Cupons do cardápio (válido às quartas).')
  })

  it('com múltiplos dias de resgate', () => {
    const bloco = montarBlocoRecompensa({ premioLabel: '10% de desconto', diasSemanaResgate: [5, 6] })
    expect(bloco).toBe('🎉 PRÊMIO DESBLOQUEADO: 10% de desconto!\nResgate na aba Cupons do cardápio (válido às sextas e aos sábados).')
  })

  it('sem restrição de dia (resgata quando quiser)', () => {
    const bloco = montarBlocoRecompensa({ premioLabel: 'Entrega grátis', diasSemanaResgate: [] })
    expect(bloco).toBe('🎉 PRÊMIO DESBLOQUEADO: Entrega grátis!\nResgate na aba Cupons do cardápio.')
  })
})

describe('montarMensagemFidelidade', () => {
  it('retorna null quando não há progresso nem recompensa (nada a notificar)', () => {
    expect(montarMensagemFidelidade([], [], 'Loja X')).toBeNull()
  })

  it('monta mensagem só com progresso (nenhuma campanha completou)', () => {
    const msg = montarMensagemFidelidade(
      [{ faltaTexto: 'Faltam 2 pedidos', premioLabel: '1 X-Tudo grátis', fracao: '8/10' }],
      [],
      'Burger House'
    )
    expect(msg).toBe(
      'Pedido entregue! ✅\n\nSeu progresso de fidelidade na Burger House:\n• Faltam 2 pedidos para ganhar 1 X-Tudo grátis (8/10)'
    )
  })

  it('monta mensagem só com recompensa nova (nenhum progresso pendente)', () => {
    const msg = montarMensagemFidelidade([], [{ premioLabel: 'Batata Frita grátis', diasSemanaResgate: [3] }], 'Burger House')
    expect(msg).toBe(
      'Pedido entregue! ✅\n\n🎉 PRÊMIO DESBLOQUEADO: Batata Frita grátis!\nResgate na aba Cupons do cardápio (válido às quartas).'
    )
  })

  it('agrupa progresso + recompensa numa única mensagem (máx 1 WhatsApp por pedido)', () => {
    const msg = montarMensagemFidelidade(
      [
        { faltaTexto: 'Faltam 2 pedidos', premioLabel: '1 X-Tudo grátis', fracao: '8/10' },
        { faltaTexto: 'Faltam R$ 25,00', premioLabel: '10% de desconto', fracao: null },
      ],
      [{ premioLabel: 'Batata Frita grátis', diasSemanaResgate: [3] }],
      'Burger House'
    )
    expect(msg).toBe(
      [
        'Pedido entregue! ✅',
        '',
        'Seu progresso de fidelidade na Burger House:',
        '• Faltam 2 pedidos para ganhar 1 X-Tudo grátis (8/10)',
        '• Faltam R$ 25,00 para ganhar 10% de desconto',
        '',
        '🎉 PRÊMIO DESBLOQUEADO: Batata Frita grátis!',
        'Resgate na aba Cupons do cardápio (válido às quartas).',
      ].join('\n')
    )
  })

  it('agrupa múltiplas recompensas novas no mesmo pedido', () => {
    const msg = montarMensagemFidelidade(
      [],
      [
        { premioLabel: 'Batata Frita grátis', diasSemanaResgate: [] },
        { premioLabel: '10% de desconto', diasSemanaResgate: [] },
      ],
      'Burger House'
    )
    expect(msg).toBe(
      [
        'Pedido entregue! ✅',
        '',
        '🎉 PRÊMIO DESBLOQUEADO: Batata Frita grátis!',
        'Resgate na aba Cupons do cardápio.',
        '',
        '🎉 PRÊMIO DESBLOQUEADO: 10% de desconto!',
        'Resgate na aba Cupons do cardápio.',
      ].join('\n')
    )
  })
})
