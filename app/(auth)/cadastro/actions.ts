'use server'

import { redirect } from 'next/navigation'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { cadastrarLojista } from '@/lib/queries/lojistas'

export async function cadastrar(formData: FormData) {
  const nomeLoja = String(formData.get('nomeLoja') ?? '').trim()
  const nome = String(formData.get('nome') ?? '').trim()
  const telefone = String(formData.get('telefone') ?? '').trim()
  const email = String(formData.get('email') ?? '').trim()
  const senha = String(formData.get('senha') ?? '')
  const confirmarSenha = String(formData.get('confirmarSenha') ?? '')

  if (!nomeLoja || !nome || !telefone || !email) {
    redirect(`/cadastro?error=${encodeURIComponent('Preencha todos os campos.')}`)
  }
  if (senha.length < 6) {
    redirect(`/cadastro?error=${encodeURIComponent('A senha deve ter no mínimo 6 caracteres.')}`)
  }
  if (senha !== confirmarSenha) {
    redirect(`/cadastro?error=${encodeURIComponent('As senhas não coincidem.')}`)
  }

  const admin = getAdminSupabase()
  const result = await cadastrarLojista(admin, { nomeLoja, nome, telefone, email, senha })
  if (!result.ok) {
    redirect(`/cadastro?error=${encodeURIComponent(result.error)}`)
  }

  redirect('/login?notice=cadastro-recebido')
}
