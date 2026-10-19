import { describe, expect, it } from 'vitest'
import {
  ajustarTroco, aplicarMudancasItens, decisaoPagoOnline, itensAdicionados, observacaoParaImpressao, resumoCurto, rotuloOrigemEdicao,
  textoClienteAlterado, textoCurto, totalDoPedido, ultimaAlteracao, type EdicaoRegistro,
} from './pedido-edicao-regras'

const ATUAIS = [
  { id: 'a', nome: 'X-Tudo', precoUnitario: 30, quantidade: 2, observacao: '' },
  { id: 'b', nome: 'Coca', precoUnitario: 8, quantidade: 1, observacao: '', tamanhoNome: '2L' },
]

describe('aplicarMudancasItens', () => {
  it('remove, muda quantidade, muda observação e adiciona; subtotal em centavos; textos legíveis', () => {
    const r = aplicarMudancasItens(ATUAIS, { remover: ['b'], quantidade: [{ itemId: 'a', quantidade: 1 }], observacao: [{ itemId: 'a', observacao: 'sem cebola' }] }, [{ nome: 'Batata', precoUnitario: 12.5, quantidade: 1 }])
    expect(r.cancelar).toEqual(['b'])
    expect(r.atualizar).toEqual([{ id: 'a', quantidade: 1, observacao: 'sem cebola' }])
    expect(r.subtotal).toBe(42.5)
    expect(r.textos).toEqual(['X-Tudo: 2× → 1×', 'X-Tudo: obs. "sem cebola"', '−1× Coca 2L', '+1× Batata'])
  })
  it('histórico ESTRUTURADO (Bloco A, 19/10): cada mudança com tipo, item e valores de/para', () => {
    const r = aplicarMudancasItens(ATUAIS, { remover: ['b'], quantidade: [{ itemId: 'a', quantidade: 1 }], observacao: [{ itemId: 'a', observacao: 'sem cebola' }] }, [{ nome: 'Batata', precoUnitario: 12.5, quantidade: 1 }])
    expect(r.alteracoes).toEqual([
      { tipo: 'item_quantidade', itemId: 'a', nome: 'X-Tudo', de: 2, para: 1 },
      { tipo: 'item_observacao', itemId: 'a', nome: 'X-Tudo', de: '', para: 'sem cebola' },
      { tipo: 'item_removido', itemId: 'b', nome: 'Coca 2L', quantidade: 1 },
      { tipo: 'item_adicionado', nome: 'Batata', quantidade: 1 },
    ])
  })
  it('quantidade 0 = remover; pedido sem itens é recusado', () => {
    expect(aplicarMudancasItens(ATUAIS, { quantidade: [{ itemId: 'b', quantidade: 0 }] }, []).cancelar).toEqual(['b'])
    expect(() => aplicarMudancasItens(ATUAIS, { remover: ['a', 'b'] }, [])).toThrow(/sem itens/)
  })
  it('sem mudança nenhuma: nada a gravar e subtotal igual', () => {
    const r = aplicarMudancasItens(ATUAIS, {}, [])
    expect(r.textos).toEqual([]); expect(r.alteracoes).toEqual([]); expect(r.cancelar).toEqual([]); expect(r.atualizar).toEqual([]); expect(r.subtotal).toBe(68)
  })
})

describe('total e troco', () => {
  it('total = subtotal + taxa − desconto, nunca negativo', () => {
    expect(totalDoPedido(42.5, 5, 10)).toBe(37.5); expect(totalDoPedido(5, 0, 10)).toBe(0)
  })
  it('troco para menos que o novo total é removido com aviso; pago ou não dinheiro não mexe', () => {
    expect(ajustarTroco('dinheiro', false, 50, 60)).toEqual({ trocoPara: null, texto: 'Troco p/ R$ 50,00 removido (total passou para R$ 60,00)' })
    expect(ajustarTroco('dinheiro', false, 50, 40)).toEqual({ trocoPara: 50, texto: null })
    expect(ajustarTroco('pix', false, null, 60)).toEqual({ trocoPara: null, texto: null })
  })
})

describe('decisaoPagoOnline (Q5/estorno)', () => {
  it('não pago online: nada', () => {
    expect(decisaoPagoOnline({ pago: false, pagamentoOnline: false, totalAntigo: 36, totalNovo: 50 })).toEqual({ ok: true, acao: 'nada' })
  })
  it('diminuiu sem escolha: bloqueia pedindo o estorno; com escolha: estorno parcial da diferença', () => {
    const b = decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 36, totalNovo: 30 })
    expect(b).toMatchObject({ ok: false, precisa: 'estorno_parcial' })
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 36, totalNovo: 30, escolha: 'estorno_parcial' })).toEqual({ ok: true, acao: 'estorno_parcial', valor: 6 })
  })
  it('aumentou: só com "receber a diferença na entrega"; segunda edição considera o que já estava a receber', () => {
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 36, totalNovo: 42 })).toMatchObject({ ok: false, precisa: 'diferenca_entrega' })
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 36, totalNovo: 42, escolha: 'diferenca_entrega' })).toEqual({ ok: true, acao: 'diferenca_entrega', valor: 6 })
    // Já tinha R$ 6 a receber (pagou 36, total 42); agora vai para 50 → a receber 14.
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 42, totalNovo: 50, jaAReceber: 6, escolha: 'diferenca_entrega' })).toEqual({ ok: true, acao: 'diferenca_entrega', valor: 14 })
    // Fase 3: cobrar a diferença por Pix é uma escolha explícita, com o mesmo valor.
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 36, totalNovo: 42, escolha: 'diferenca_pix' })).toEqual({ ok: true, acao: 'diferenca_pix', valor: 6 })
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 36, totalNovo: 42 })).toMatchObject({ texto: expect.stringContaining('Pix pelo WhatsApp ou na entrega') })
    // Voltou para 36: nada a receber, nada a estornar.
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 42, totalNovo: 36, jaAReceber: 6 })).toEqual({ ok: true, acao: 'nada' })
  })
})

const EDICOES: EdicaoRegistro[] = [
  { em: '2026-10-18T22:10:00.000Z', por: 'Administrador', origem: 'painel', mudancas: ['−1× fsd', '+1× coca lata'], alteracoes: [
    { tipo: 'item_removido', itemId: 'i1', nome: 'fsd', quantidade: 1 },
    { tipo: 'item_adicionado', itemId: 'i9', nome: 'coca lata', quantidade: 1 },
  ] },
  { em: '2026-10-18T22:30:00.000Z', por: 'Administrador', origem: 'solicitacao', via: 'robo', mudancas: ['Endereço: Rua B, 2 · Centro', 'Taxa de entrega: R$ 3,00'], alteracoes: [
    { tipo: 'endereco', de: 'Rua A, 1 · Jaburuna', para: 'Rua B, 2 · Centro' },
    { tipo: 'taxa', de: 5.89, para: 3 },
  ] },
]

describe('histórico estruturado: textos curtos, comanda/KDS, itens e origem', () => {
  it('texto curto de cada tipo de alteração', () => {
    expect(textoCurto({ tipo: 'item_removido', itemId: 'x', nome: 'fsd', quantidade: 1 })).toBe('− 1× fsd')
    expect(textoCurto({ tipo: 'item_adicionado', nome: 'coca lata', quantidade: 2 })).toBe('+ 2× coca lata')
    expect(textoCurto({ tipo: 'item_quantidade', itemId: 'x', nome: 'X-Tudo', de: 2, para: 1 })).toBe('X-Tudo 2×→1×')
    expect(textoCurto({ tipo: 'item_observacao', itemId: 'x', nome: 'X-Tudo', de: '', para: 'sem cebola' })).toBe('X-Tudo: obs. "sem cebola"')
    expect(textoCurto({ tipo: 'item_observacao', itemId: 'x', nome: 'X-Tudo', de: 'sem cebola', para: '' })).toBe('X-Tudo: obs. removida')
    expect(textoCurto({ tipo: 'endereco', de: 'Rua A, 1', para: 'Rua B, 2' })).toBe('novo endereço')
    expect(textoCurto({ tipo: 'taxa', de: 5.89, para: 3 })).toBe('taxa R$ 3,00')
    expect(textoCurto({ tipo: 'cupom', de: 'TESTE', para: null })).toBe('cupom TESTE removido')
    expect(textoCurto({ tipo: 'pagamento', de: 'Dinheiro', para: 'Pix' })).toBe('pagamento Pix')
    expect(textoCurto({ tipo: 'troco', de: 100, para: null })).toBe('sem troco')
    expect(textoCurto({ tipo: 'diferenca', para: 6 })).toBe('+ R$ 6,00 na entrega')
    expect(textoCurto({ tipo: 'estorno', para: 6 })).toBe('estorno R$ 6,00')
  })
  it('resumo curto da ÚLTIMA edição (KDS); edição antiga sem alteracoes cai nos textos', () => {
    expect(resumoCurto(EDICOES)).toBe('novo endereço · taxa R$ 3,00')
    expect(resumoCurto([EDICOES[0]])).toBe('− 1× fsd · + 1× coca lata')
    expect(resumoCurto([{ em: '2026-10-18T22:10:00.000Z', por: 'A', origem: 'painel', mudancas: ['+1× Batata'] }])).toBe('+1× Batata')
    expect(resumoCurto([])).toBe('')
  })
  it('observação da comanda: bloco curto "PEDIDO ALTERADO (hh:mm)" na frente da observação do cliente (que fica intocada no banco)', () => {
    expect(observacaoParaImpressao('sem gelo', EDICOES)).toBe('PEDIDO ALTERADO (19:30): novo endereço · taxa R$ 3,00 | PEDIDO ALTERADO (19:10): − 1× fsd · + 1× coca lata | sem gelo')
    expect(observacaoParaImpressao('', [])).toBe('')
    expect(observacaoParaImpressao('sem gelo', [])).toBe('sem gelo')
    expect(observacaoParaImpressao(null, [EDICOES[0]])).toBe('PEDIDO ALTERADO (19:10): − 1× fsd · + 1× coca lata')
  })
  it('ids dos itens adicionados e última alteração de um campo', () => {
    expect([...itensAdicionados(EDICOES)]).toEqual(['i9'])
    expect(ultimaAlteracao(EDICOES, 'endereco')).toEqual({ tipo: 'endereco', de: 'Rua A, 1 · Jaburuna', para: 'Rua B, 2 · Centro' })
    expect(ultimaAlteracao(EDICOES, 'pagamento')).toBeNull()
  })
  it('rótulo da origem: loja, cliente pelo robô/IA, Agente de IA', () => {
    expect(rotuloOrigemEdicao(EDICOES[0])).toBe('pela loja')
    expect(rotuloOrigemEdicao(EDICOES[1])).toBe('pelo cliente (robô)')
    expect(rotuloOrigemEdicao({ ...EDICOES[1], via: 'ia' })).toBe('pelo cliente (IA)')
    expect(rotuloOrigemEdicao({ ...EDICOES[1], via: undefined })).toBe('pelo cliente')
    expect(rotuloOrigemEdicao({ ...EDICOES[0], origem: 'ia' })).toBe('pelo Agente de IA')
  })
})

describe('WhatsApp', () => {
  it('texto do cliente com total e diferença', () => {
    expect(textoClienteAlterado(412, ['−1× Coca 2L'], 30)).toBe('*✏️ Pedido #412 alterado*\n\n• −1× Coca 2L\n\nNovo total: *R$ 30,00*')
    expect(textoClienteAlterado(412, ['+1× Batata'], 42, 6)).toContain('Diferença a pagar na entrega: *R$ 6,00*')
  })
})
