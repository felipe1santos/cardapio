'use server'

import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { getServerSupabase } from '@/lib/supabase/server'
import { COOKIE_RECUPERACAO } from '@/lib/auth/recuperacao'

export async function redefinirSenha(formData: FormData) {
  const senha = String(formData.get('senha') ?? '')
  const confirmarSenha = String(formData.get('confirmarSenha') ?? '')

  if (senha.length < 6) {
    redirect(`/redefinir-senha?error=${encodeURIComponent('A senha deve ter no mínimo 6 caracteres.')}`)
  }
  if (senha !== confirmarSenha) {
    redirect(`/redefinir-senha?error=${encodeURIComponent('As senhas não coincidem.')}`)
  }

  // Só quem chegou pelo link do e-mail troca aqui sem a senha atual. Com o painel aberto,
  // a troca é em Ajustes → Conta, que pede a senha atual (B16).
  const jar = await cookies()
  if (jar.get(COOKIE_RECUPERACAO)?.value !== '1') {
    redirect('/recuperar-senha?error=link-expirado')
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
  jar.delete(COOKIE_RECUPERACAO)
  await supabase.auth.signOut()
  redirect('/login?notice=senha-alterada')
}
