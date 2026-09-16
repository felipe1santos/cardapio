'use server'

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { acessoValido, buscarEmailPorUsuario, buscarStatusAcesso, registrarLogin } from '@/lib/queries/lojistas'
import { pode } from '@/lib/auth/permissoes'

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

  if (isSuperAdminEmail(data.user.email)) {
    await registrarLogin(admin, data.user.id)
    redirect('/superadmin')
  }

  const status = await buscarStatusAcesso(admin, data.user.id)
  if (!status?.restauranteId || !status.autorizado) {
    await supabase.auth.signOut()
    redirect('/login?error=pendente')
  }
  if (!acessoValido(status)) {
    await supabase.auth.signOut()
    redirect(`/login?error=${encodeURIComponent('Seu acesso expirou. Fale com a Menuzia para renovar.')}`)
  }

  await registrarLogin(admin, data.user.id)
  redirect(await telaInicialDo(admin, data.user.id))
}

/**
 * Primeira tela depois do login, pelo papel. O Dashboard é faturamento: abrir o garçom
 * nele seria mandá-lo para uma tela que ele não pode usar. Dono continua indo para o
 * Dashboard, como sempre.
 */
async function telaInicialDo(admin: ReturnType<typeof getAdminSupabase>, userId: string): Promise<string> {
  const { data } = await admin.from('usuarios').select('papel').eq('id', userId).maybeSingle()
  const papel = (data?.papel as string | undefined) ?? null
  if (pode(papel, 'dashboard.faturamento')) return '/admin/dashboard'
  if (pode(papel, 'mesas.operar')) return '/admin/mesas'
  if (pode(papel, 'pedidos.delivery.ver')) return '/admin/pedidos'
  return '/admin/dashboard'
}
