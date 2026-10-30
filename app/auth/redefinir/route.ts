import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { COOKIE_RECUPERACAO } from '@/lib/auth/recuperacao'
import { urlPublica } from '@/lib/url-publica'

/**
 * Alvo do link de recuperação de senha enviado por e-mail. Troca o `token_hash`
 * por uma sessão de recuperação (cookies) e leva o usuário para a tela de
 * definir nova senha. O `token_hash` não depende do cookie do navegador que pediu
 * o link: abre no app do Gmail ou no celular. `code` fica para e-mails já enviados.
 */
export async function GET(request: NextRequest) {
  const busca = request.nextUrl.searchParams
  const tokenHash = busca.get('token_hash')
  const code = busca.get('code')

  // Link já usado ou vencido: o Supabase devolve para cá com error_code e sem code.
  if (busca.get('error_code') === 'otp_expired') {
    return NextResponse.redirect(new URL('/recuperar-senha?error=link-expirado', urlPublica()))
  }

  if (!tokenHash && !code) {
    return NextResponse.redirect(new URL('/recuperar-senha?error=link-invalido', urlPublica()))
  }

  const supabase = await getServerSupabase()
  const { error } = tokenHash
    ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' })
    : await supabase.auth.exchangeCodeForSession(code!)

  if (error) {
    return NextResponse.redirect(new URL('/recuperar-senha?error=link-expirado', urlPublica()))
  }

  // Marca que esta sessão veio do link do e-mail: só assim /redefinir-senha troca a senha
  // sem pedir a atual (B16). Sessão comum do painel não tem a marca.
  const resposta = NextResponse.redirect(new URL('/redefinir-senha', urlPublica()))
  resposta.cookies.set(COOKIE_RECUPERACAO, '1', { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 15 * 60 })
  return resposta
}
