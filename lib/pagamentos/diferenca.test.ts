import { describe, expect, it } from 'vitest'
import { DIFERENCA_VALIDADE_MIN, diferencaNaEntrega, etiquetaDiferenca, pushDiferencaVencida, textoCobrancaDiferenca, textoDiferencaRecebida, textoDiferencaVencida } from './diferenca'

describe('Pix da diferença (Fase 3): textos e etiqueta', () => {
  it('cobrança: valor, prazo em hora local e pedido para copiar o código (que vai na mensagem seguinte)', () => {
    const t = textoCobrancaDiferenca({ numero: 563, valor: 6, expiraEm: '2026-10-19T22:30:00Z' })
    expect(t).toContain('Diferença do pedido `#563`: R$ 6,00')
    expect(t).toContain('vale até 19:30')
    expect(t).toContain('Copie o código 👇')
    expect(t).not.toContain('00020126')
  })
  it('recebida e vencida', () => {
    expect(textoDiferencaRecebida({ numero: 563, valor: 6.5 })).toBe('*Recebemos a diferença ✅*\n\nR$ 6,50 do pedido `#563` confirmado. Obrigado!')
    expect(textoDiferencaVencida({ numero: 563, valor: 6 })).toContain(`não foi paga pelo Pix em ${DIFERENCA_VALIDADE_MIN} min`)
    expect(pushDiferencaVencida({ numero: 563, valor: 6 })).toEqual({ title: '⚠️ Pedido #563: diferença não paga', body: 'R$ 6,00 do Pix da diferença venceu. Decida no painel.' })
    expect(DIFERENCA_VALIDADE_MIN).toBe(30)
  })
  it('etiqueta: só pedido pago online com diferença; muda com o modo', () => {
    const base = { pago: true, pagamentoOnline: true, diferencaAReceber: 6 }
    expect(etiquetaDiferenca({ ...base, diferencaModo: 'pix' })).toMatchObject({ curto: 'Dif. R$ 6,00 · Pix pendente', tom: 'pendente' })
    expect(etiquetaDiferenca({ ...base, diferencaModo: 'pix_vencido' })).toMatchObject({ curto: 'Dif. R$ 6,00 · Pix vencido', tom: 'vencido' })
    expect(etiquetaDiferenca({ ...base, diferencaModo: 'entrega' })).toMatchObject({ curto: 'Dif. R$ 6,00 · na entrega', tom: 'entrega' })
    // Fase 2 gravou diferença sem modo: trata como "na entrega".
    expect(etiquetaDiferenca({ ...base, diferencaModo: null })?.tom).toBe('entrega')
    expect(etiquetaDiferenca({ ...base, diferencaAReceber: 0, diferencaModo: 'pix' })).toBeNull()
    expect(etiquetaDiferenca({ ...base, pago: false, diferencaModo: 'pix' })).toBeNull()
    expect(etiquetaDiferenca({ ...base, pagamentoOnline: false, diferencaModo: 'pix' })).toBeNull()
  })
  it('motoboy/caixa só recebe a diferença no modo entrega', () => {
    expect(diferencaNaEntrega({ pago: true, diferencaAReceber: 6.004, diferencaModo: 'entrega' })).toBe(6)
    expect(diferencaNaEntrega({ pago: true, diferencaAReceber: 6, diferencaModo: 'pix' })).toBe(0)
    expect(diferencaNaEntrega({ pago: false, diferencaAReceber: 6, diferencaModo: 'entrega' })).toBe(0)
  })
})
