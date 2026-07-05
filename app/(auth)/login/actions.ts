'use server'

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { buscarEmailPorUsuario, buscarStatusAcesso, registrarLogin } from '@/lib/queries/lojistas'

export async function signIn(formData: FormData) {
  const login = String(formData.get('email') ?? '').trim()
  const password = String(formData.get('password') ?? '')

  // O campo aceita e-mail (superadmin/contas antigas) ou o nome de usuário
  // definido no cadastro — usuário não tem '@', então dá pra distinguir.
  let email = login
  if (login && !login.includes('@')) {
    const resolvido = await buscarEmailPorUsuario(getAdminSupabase(), login)
    if (!resolvido) {
      redirect(`/login?error=${encodeURIComponent('Usuário ou senha inválidos.')}`)
    }
    email = resolvido
  }

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    redirect(`/login?error=${encodeURIComponent('Usuário ou senha inválidos.')}`)
  }

  const admin = getAdminSupabase()
  await registrarLogin(admin, data.user.id)

  if (isSuperAdminEmail(data.user.email)) {
    redirect('/superadmin')
  }

  const status = await buscarStatusAcesso(admin, data.user.id)
  if (!status?.autorizado || !status.restauranteId) {
    await supabase.auth.signOut()
    redirect('/login?error=pendente')
  }

  redirect('/admin/dashboard')
}
