'use server'

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { buscarStatusAcesso, registrarLogin } from '@/lib/queries/lojistas'

export async function signIn(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await getServerSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? 'Não foi possível entrar.')}`)
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
