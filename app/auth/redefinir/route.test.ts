import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const verifyOtp = vi.fn()
const exchangeCodeForSession = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  getServerSupabase: async () => ({ auth: { verifyOtp, exchangeCodeForSession } }),
}))
vi.mock('@/lib/url-publica', () => ({ urlPublica: () => 'https://app.menuzia.com.br' }))

import { GET } from './route'

const abrir = (busca: string) => GET(new NextRequest(`https://app.menuzia.com.br/auth/redefinir${busca}`))

describe('link de recuperação de senha', () => {
  beforeEach(() => {
    verifyOtp.mockReset().mockResolvedValue({ error: null })
    exchangeCodeForSession.mockReset().mockResolvedValue({ error: null })
  })

  it('token_hash abre em qualquer navegador, sem depender do cookie de quem pediu', async () => {
    const r = await abrir('?token_hash=abc&type=recovery')
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc', type: 'recovery' })
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(r.headers.get('location')).toBe('https://app.menuzia.com.br/redefinir-senha')
    expect(r.cookies.getAll().length).toBe(1)
  })

  it('token_hash vencido ou já usado avisa que expirou', async () => {
    verifyOtp.mockResolvedValue({ error: new Error('otp_expired') })
    const r = await abrir('?token_hash=velho&type=recovery')
    expect(r.headers.get('location')).toContain('error=link-expirado')
  })

  it('e-mail antigo com code continua funcionando', async () => {
    const r = await abrir('?code=xyz')
    expect(exchangeCodeForSession).toHaveBeenCalledWith('xyz')
    expect(r.headers.get('location')).toBe('https://app.menuzia.com.br/redefinir-senha')
  })

  it('link usado devolvido pelo Supabase (otp_expired) avisa que expirou, não "inválido"', async () => {
    const r = await abrir('?error=access_denied&error_code=otp_expired')
    expect(r.headers.get('location')).toContain('error=link-expirado')
  })

  it('sem nada na URL é link inválido', async () => {
    const r = await abrir('')
    expect(r.headers.get('location')).toContain('error=link-invalido')
  })
})
