'use server'

import { redirect } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'

export async function redefinirSenha(formData: FormData) {
  const senha = String(formData.get('senha') ?? '')
  const confirmarSenha = String(formData.get('confirmarSenha') ?? '')

  if (senha.length < 6) {
    redirect(`/redefinir-senha?error=${encodeURIComponent('A senha deve ter no mínimo 6 caracteres.')}`)
  }
  if (senha !== confirmarSenha) {
    redirect(`/redefinir-senha?error=${encodeURIComponent('As senhas não coincidem.')}`)
  }

  const supabase = await getServerSupabase()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    redirect('/recuperar-senha?error=sessao-expirada')
  }

  const { error } = await supabase.auth.updateUser({ password: senha })
  if (error) {
    redirect(`/redefinir-senha?error=${encodeURIComponent(error.message)}`)
  }

  // Encerra a sessão de recuperação e força login com a nova senha.
  await supabase.auth.signOut()
  redirect('/login?notice=senha-alterada')
}
