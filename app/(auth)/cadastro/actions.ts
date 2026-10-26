'use server'

import { redirect } from 'next/navigation'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { completarPrimeiroAcesso } from '@/lib/queries/lojistas'

export async function cadastrar(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim()
  const senha = String(formData.get('senha') ?? '')
  const confirmarSenha = String(formData.get('confirmarSenha') ?? '')
  const nome = String(formData.get('nome') ?? '').trim()
  const telefone = String(formData.get('telefone') ?? '').trim()
  const nomeLoja = String(formData.get('nomeLoja') ?? '').trim()
  const usuario = String(formData.get('usuario') ?? '').trim()
  // Token do link de convite (achado #3): segue na URL de volta para o cliente poder corrigir e tentar de novo.
  const convite = String(formData.get('convite') ?? '').trim()
  const voltar = (msg: string) => redirect(`/cadastro?convite=${encodeURIComponent(convite)}&error=${encodeURIComponent(msg)}`)

  if (!email || !nome || !telefone || !nomeLoja || !usuario) {
    voltar('Preencha todos os campos.')
  }
  if (senha.length < 6) {
    voltar('A senha deve ter no mínimo 6 caracteres.')
  }
  if (senha !== confirmarSenha) {
    voltar('As senhas não coincidem.')
  }

  const admin = getAdminSupabase()
  const result = await completarPrimeiroAcesso(admin, { email, senha, nome, telefone, nomeLoja, usuario, convite })
  if (!result.ok) {
    voltar(result.error)
  }

  redirect('/login?notice=cadastro-concluido')
}
