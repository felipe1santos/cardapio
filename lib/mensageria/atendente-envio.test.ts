import { describe, it, expect } from 'vitest'
import { mensagemFalhaAtendente, rotuloSaidaNaoConfirmada } from './atendente-envio'

describe('envio do atendente sem confirmação (B9)', () => {
  it('incerto não manda tentar de novo (evita mensagem em dobro)', () => {
    expect(mensagemFalhaAtendente('incerto')).not.toMatch(/Tente de novo/)
    expect(mensagemFalhaAtendente('incerto')).toMatch(/pode ter sido enviada/)
  })
  it('falha de verdade continua pedindo para tentar de novo', () => {
    expect(mensagemFalhaAtendente('definitivo')).toMatch(/Tente de novo/)
    expect(mensagemFalhaAtendente('transitorio')).toMatch(/Tente de novo/)
  })
  it('balão: incerto vira "pode ter sido enviada"; o resto "não enviada"', () => {
    expect(rotuloSaidaNaoConfirmada('tempo esgotado aguardando o provedor (pode ter sido entregue)')).toBe('pode ter sido enviada')
    expect(rotuloSaidaNaoConfirmada('HTTP 400 Connection Closed')).toBe('não enviada')
    expect(rotuloSaidaNaoConfirmada(null)).toBe('não enviada')
  })
})
