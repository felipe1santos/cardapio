'use server'

import { redirect } from 'next/navigation'
import { urlPublica } from '@/lib/url-publica'
import { getServerSupabase } from '@/lib/supabase/server'
import { MSG_MUITAS_TENTATIVAS, resultadoRecuperacao } from '@/lib/auth/mensagens-acesso'

export async function solicitarTroca(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect(`/recuperar-senha?error=${encodeURIComponent('Informe seu e-mail.')}`)
  }

  const supabase = await getServerSupabase()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${urlPublica()}/auth/redefinir`,
  })

  // Sempre a mesma resposta, exista ou não a conta (10/10). Só o limite de tentativas tem aviso próprio (vale para todos).
  if (error) console.error('[recuperar-senha] erro do provedor:', error.status ?? '')
  if (resultadoRecuperacao(error) === 'limite') {
    redirect(`/recuperar-senha?error=${encodeURIComponent(MSG_MUITAS_TENTATIVAS)}`)
  }

  redirect('/recuperar-senha?sent=1')
}
