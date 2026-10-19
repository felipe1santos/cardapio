import { describe, expect, it } from 'vitest'
import { ajustarTroco, aplicarMudancasItens, decisaoPagoOnline, montarObservacao, textoClienteAlterado, totalDoPedido } from './pedido-edicao-regras'

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
  it('quantidade 0 = remover; pedido sem itens é recusado', () => {
    expect(aplicarMudancasItens(ATUAIS, { quantidade: [{ itemId: 'b', quantidade: 0 }] }, []).cancelar).toEqual(['b'])
    expect(() => aplicarMudancasItens(ATUAIS, { remover: ['a', 'b'] }, [])).toThrow(/sem itens/)
  })
  it('sem mudança nenhuma: nada a gravar e subtotal igual', () => {
    const r = aplicarMudancasItens(ATUAIS, {}, [])
    expect(r.textos).toEqual([]); expect(r.cancelar).toEqual([]); expect(r.atualizar).toEqual([]); expect(r.subtotal).toBe(68)
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
    // Voltou para 36: nada a receber, nada a estornar.
    expect(decisaoPagoOnline({ pago: true, pagamentoOnline: true, totalAntigo: 42, totalNovo: 36, jaAReceber: 6 })).toEqual({ ok: true, acao: 'nada' })
  })
})

describe('observação e WhatsApp', () => {
  it('bloco ALTERADO na frente da observação original, mais recente primeiro, no máximo 3', () => {
    const em = '2026-10-18T22:10:00.000Z' // 19:10 em São Paulo
    const t = montarObservacao('sem gelo', [{ em, mudancas: ['−1× Coca 2L'] }, { em: '2026-10-18T22:30:00.000Z', mudancas: ['+1× Batata'] }])
    expect(t).toBe('PEDIDO ALTERADO (19:30): +1× Batata | PEDIDO ALTERADO (19:10): −1× Coca 2L | sem gelo')
    expect(montarObservacao('', [])).toBe('')
  })
  it('texto do cliente com total e diferença', () => {
    expect(textoClienteAlterado(412, ['−1× Coca 2L'], 30)).toBe('*✏️ Pedido #412 alterado*\n\n• −1× Coca 2L\n\nNovo total: *R$ 30,00*')
    expect(textoClienteAlterado(412, ['+1× Batata'], 42, 6)).toContain('Diferença a pagar na entrega: *R$ 6,00*')
  })
})
