'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import {
  autorizarLojista,
  criarRestaurante,
  revogarAcessoLojista,
} from '@/lib/queries/lojistas'

async function ensureSuperAdmin() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!isSuperAdminEmail(data.user?.email)) {
    redirect('/login')
  }
}

const DIACRITICS_REGEX = new RegExp('[̀-ͯ]', 'g')

function normalizarSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_REGEX, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function criarRestauranteAction(formData: FormData) {
  await ensureSuperAdmin()

  const nome = String(formData.get('nome') ?? '').trim()
  const slug = normalizarSlug(String(formData.get('slug') ?? ''))
  if (!nome || !slug) {
    redirect(`/superadmin?error=${encodeURIComponent('Informe o nome e o slug da loja.')}`)
  }

  const admin = getAdminSupabase()
  const result = await criarRestaurante(admin, nome, slug)
  if (!result.ok) {
    redirect(`/superadmin?error=${encodeURIComponent(result.error)}`)
  }

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function autorizarLojistaAction(formData: FormData) {
  await ensureSuperAdmin()

  const usuarioId = String(formData.get('usuarioId') ?? '')
  const restauranteId = String(formData.get('restauranteId') ?? '')
  if (!usuarioId || !restauranteId) {
    redirect(`/superadmin?error=${encodeURIComponent('Selecione a loja para vincular.')}`)
  }

  const admin = getAdminSupabase()
  const result = await autorizarLojista(admin, usuarioId, restauranteId)
  if (!result.ok) {
    redirect(`/superadmin?error=${encodeURIComponent(result.error)}`)
  }

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function revogarAcessoAction(formData: FormData) {
  await ensureSuperAdmin()

  const usuarioId = String(formData.get('usuarioId') ?? '')
  if (!usuarioId) return

  const admin = getAdminSupabase()
  await revogarAcessoLojista(admin, usuarioId)

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function sairAction() {
  const supabase = await getServerSupabase()
  await supabase.auth.signOut()
  redirect('/login')
}
