import { describe, expect, it } from 'vitest'
import { plataformaConvite, podeMostrarConvite } from './convite-app'

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
