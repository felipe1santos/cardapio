import { describe, expect, it } from 'vitest'
import { decidirOculto } from './use-esconder-ao-rolar'
import { plataformaConvite, podeMostrarConvite } from './convite-app'

describe('menu some ao rolar', () => {
  const J = 800, D = 5000
  it('rolar para baixo esconde; para cima mostra', () => {
    expect(decidirOculto(false, 400, 300, J, D)).toBe(true)
    expect(decidirOculto(true, 300, 400, J, D)).toBe(false)
  })
  it('movimento pequeno mantém o estado (não treme)', () => {
    expect(decidirOculto(true, 403, 400, J, D)).toBe(true)
    expect(decidirOculto(false, 403, 400, J, D)).toBe(false)
  })
  it('perto do topo e no fim da página aparece', () => {
    expect(decidirOculto(true, 50, 10, J, D)).toBe(false)
    expect(decidirOculto(true, D - J - 10, D - J - 200, J, D)).toBe(false)
  })
})

describe('convite do app', () => {
  it('não aparece instalado nem nos navegadores internos; iOS ganha a dica', () => {
    expect(plataformaConvite('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) CriOS/120', false)).toBe('ios')
    expect(plataformaConvite('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile', false)).toBe('outro')
    expect(plataformaConvite('Mozilla/5.0 (iPhone) Instagram 300', false)).toBeNull()
    expect(plataformaConvite('Mozilla/5.0 (Linux; Android 14; wv) WhatsApp/2.24', false)).toBeNull()
    expect(plataformaConvite('Mozilla/5.0 (iPhone) Safari', true)).toBeNull()
  })
  it('no máximo 1 vez por semana; nunca depois de dispensar ou instalar', () => {
    const agora = Date.parse('2026-10-01T12:00:00Z')
    expect(podeMostrarConvite(null, agora)).toBe(true)
    expect(podeMostrarConvite({ mostradoEm: agora - 2 * 86_400_000 }, agora)).toBe(false)
    expect(podeMostrarConvite({ mostradoEm: agora - 8 * 86_400_000 }, agora)).toBe(true)
    expect(podeMostrarConvite({ dispensado: true }, agora)).toBe(false)
    expect(podeMostrarConvite({ instalado: true }, agora)).toBe(false)
  })
})
