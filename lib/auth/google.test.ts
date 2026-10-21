import { describe, expect, it } from 'vitest'
import { criadoAgoraSoPeloGoogle } from './google'

const agora = Date.parse('2026-10-20T12:00:00Z')
const id = (provider: string) => ({ provider }) as never

describe('Google sem conta Menuzia', () => {
  it('usuário novo só com Google é o que o Supabase criou agora → apagar', () => {
    expect(criadoAgoraSoPeloGoogle({ identities: [id('google')], created_at: '2026-10-20T11:59:30Z' }, agora)).toBe(true)
  })
  it('conta antiga com Google vinculado nunca é apagada', () => {
    expect(criadoAgoraSoPeloGoogle({ identities: [id('email'), id('google')], created_at: '2026-10-20T11:59:30Z' }, agora)).toBe(false)
    expect(criadoAgoraSoPeloGoogle({ identities: [id('google')], created_at: '2026-09-01T00:00:00Z' }, agora)).toBe(false)
  })
  it('sem identidade ou data estranha: não apaga', () => {
    expect(criadoAgoraSoPeloGoogle({ identities: [], created_at: '2026-10-20T11:59:30Z' }, agora)).toBe(false)
    expect(criadoAgoraSoPeloGoogle({ identities: [id('google')], created_at: 'x' }, agora)).toBe(false)
  })
})
