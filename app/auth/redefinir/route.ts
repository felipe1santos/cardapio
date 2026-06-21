import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'

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

  return NextResponse.redirect(new URL('/redefinir-senha', request.url))
}
