import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { concluirEntrada } from '@/lib/auth/entrada'
import { criadoAgoraSoPeloGoogle } from '@/lib/auth/google'

/**
 * Volta do "Continuar com Google" (20/10/2026). Só entra quem JÁ tem conta Menuzia com o mesmo e-mail: o Supabase
 * vincula o Google à conta existente (e-mail confirmado) e o id é o mesmo da linha em `usuarios`. E-mail sem conta →
 * sai, apaga o usuário que o Supabase criou agora e mostra a mensagem do suporte. Depois, as mesmas regras do login
 * com senha (lib/auth/entrada.ts).
 */
export async function GET(request: NextRequest) {
  const erro = (codigo: string) => NextResponse.redirect(new URL(`/login?error=${codigo}`, request.url))
  const code = request.nextUrl.searchParams.get('code')
  if (!code) return erro('google-falhou')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.user) return erro('google-falhou')
  const user = data.user

  if (!isSuperAdminEmail(user.email)) {
    const admin = getAdminSupabase()
    const { data: conta } = await admin.from('usuarios').select('id').eq('id', user.id).maybeSingle()
    if (!conta) {
      await supabase.auth.signOut()
      if (criadoAgoraSoPeloGoogle(user)) await admin.auth.admin.deleteUser(user.id).catch(() => {})
      return erro('google-sem-conta')
    }
  }

  const destino = await concluirEntrada(supabase, user, null)
  return NextResponse.redirect(new URL(destino, request.url))
}
