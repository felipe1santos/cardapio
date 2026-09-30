'use server'

import { redirect } from 'next/navigation'
import { urlPublica } from '@/lib/url-publica'
import { getServerSupabase } from '@/lib/supabase/server'

export async function solicitarTroca(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect(`/recuperar-senha?error=${encodeURIComponent('Informe seu e-mail.')}`)
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${urlPublica()}/auth/redefinir`,
  })

  if (error) {
    redirect(`/recuperar-senha?error=${encodeURIComponent(error.message)}`)
  }

  // Sempre mostramos sucesso (não revela se o e-mail existe).
  redirect('/recuperar-senha?sent=1')
}
