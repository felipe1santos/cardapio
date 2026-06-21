'use server'

import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getServerSupabase } from '@/lib/supabase/server'

export async function solicitarTroca(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect(`/recuperar-senha?error=${encodeURIComponent('Informe seu e-mail.')}`)
  }

  const h = await headers()
  const origin = h.get('origin') ?? `https://${h.get('host')}`

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/redefinir`,
  })

  if (error) {
    redirect(`/recuperar-senha?error=${encodeURIComponent(error.message)}`)
  }

  // Sempre mostramos sucesso (não revela se o e-mail existe).
  redirect('/recuperar-senha?sent=1')
}
