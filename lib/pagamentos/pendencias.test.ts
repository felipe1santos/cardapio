import { describe, expect, it } from 'vitest'
import { acaoDaPendencia } from './pendencias'

/**
 * Bug de 26/10: cartão recusado (`rejected`) fica com a cobrança `pendente` para sempre — a conferência devolve
 * 'recusado' e o cron só expirava o que voltava 'pendente'. Três cobranças de 12/10 foram conferidas ~19 mil vezes
 * cada (1 chamada ao Mercado Pago por minuto) e os pedidos ficaram em "aguardando pagamento".
 */

const EXPIRA = '2026-10-12T20:30:00.000Z'
const antes = Date.parse('2026-10-12T20:20:00.000Z')
const depois = Date.parse('2026-10-12T20:31:30.000Z') // passou o prazo + 1 min de folga

describe('acaoDaPendencia', () => {
  it('cartão recusado dentro do prazo: espera (o cliente pode tentar outro cartão)', () => {
    expect(acaoDaPendencia('recusado', EXPIRA, antes)).toBe('aguardar')
  })

  it('cartão recusado depois do prazo: expira o pedido, sem cancelar no MP (recusado já é final lá)', () => {
    expect(acaoDaPendencia('recusado', EXPIRA, depois)).toBe('expirar')
  })

  it('ainda pendente no MP depois do prazo: cancela no MP e expira (como sempre foi)', () => {
    expect(acaoDaPendencia('pendente', EXPIRA, depois)).toBe('cancelar_no_mp_e_expirar')
  })

  it('pendente dentro do prazo: espera', () => {
    expect(acaoDaPendencia('pendente', EXPIRA, antes)).toBe('aguardar')
  })

  it('erro da API não decide nada (tenta no próximo minuto)', () => {
    expect(acaoDaPendencia('erro_api', EXPIRA, depois)).toBe('aguardar')
  })

  it('resultados finais não pedem ação aqui (a conferência já resolveu)', () => {
    for (const r of ['confirmado', 'expirado', 'a_devolver', 'ja_confirmado']) expect(acaoDaPendencia(r, EXPIRA, depois)).toBe('aguardar')
  })
})
