import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { COOKIE_RECUPERACAO } from '@/lib/auth/recuperacao'

/**
 * Alvo do link de recuperação de senha enviado por e-mail. Troca o `code`
 * por uma sessão de recuperação (cookies) e leva o usuário para a tela de
 * definir nova senha.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(new URL('/recuperar-senha?error=link-invalido', request.url))
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(new URL('/recuperar-senha?error=link-expirado', request.url))
  }

  // Marca que esta sessão veio do link do e-mail: só assim /redefinir-senha troca a senha
  // sem pedir a atual (B16). Sessão comum do painel não tem a marca.
  const resposta = NextResponse.redirect(new URL('/redefinir-senha', request.url))
  resposta.cookies.set(COOKIE_RECUPERACAO, '1', { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge: 15 * 60 })
  return resposta
}
