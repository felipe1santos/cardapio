import { describe, expect, it } from 'vitest'
import { deveReconferirLoja, INTERVALO_LOJA_FECHADA_MS, INTERVALO_LOJA_ABERTA_MS } from './loja-ao-vivo'

/** Vitrine: quando conferir de novo se a loja está aberta (16/10/2026, "No app mostra que tá fechado"). */
describe('deveReconferirLoja', () => {
  const agora = 1_000_000_000
  it('sempre confere ao abrir a página (o HTML pode ter vindo do cache)', () => {
    expect(deveReconferirLoja({ aberta: true, visivel: true, ultimaConferencia: null, agora })).toBe(true)
    expect(deveReconferirLoja({ aberta: false, visivel: true, ultimaConferencia: null, agora })).toBe(true)
  })
  it('loja fechada e página visível: confere a cada minuto (pega a hora em que a loja abre)', () => {
    expect(deveReconferirLoja({ aberta: false, visivel: true, ultimaConferencia: agora - INTERVALO_LOJA_FECHADA_MS, agora })).toBe(true)
    expect(deveReconferirLoja({ aberta: false, visivel: true, ultimaConferencia: agora - 10_000, agora })).toBe(false)
  })
  it('loja aberta: confere com menos frequência (fechou no meio da navegação)', () => {
    expect(deveReconferirLoja({ aberta: true, visivel: true, ultimaConferencia: agora - INTERVALO_LOJA_FECHADA_MS, agora })).toBe(false)
    expect(deveReconferirLoja({ aberta: true, visivel: true, ultimaConferencia: agora - INTERVALO_LOJA_ABERTA_MS, agora })).toBe(true)
  })
  it('página escondida (outra aba, tela apagada): não confere', () => {
    expect(deveReconferirLoja({ aberta: false, visivel: false, ultimaConferencia: agora - 3_600_000, agora })).toBe(false)
  })
})
