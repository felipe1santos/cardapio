'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { concederAcessoLojista, convidarLojista, excluirLojistaCompleto, removerConvitePendente, revogarAcessoLojista, salvarConfigPlataforma } from '@/lib/queries/lojistas'

async function ensureSuperAdmin() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!isSuperAdminEmail(data.user?.email)) {
    redirect('/login')
  }
}

export async function convidarLojistaAction(formData: FormData) {
  await ensureSuperAdmin()

  const email = String(formData.get('email') ?? '').trim()
  if (!email) {
    redirect(`/superadmin?error=${encodeURIComponent('Informe o e-mail do cliente.')}`)
  }

  const admin = getAdminSupabase()
  const result = await convidarLojista(admin, email)
  if (!result.ok) {
    redirect(`/superadmin?error=${encodeURIComponent(result.error)}`)
  }

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function removerConviteAction(formData: FormData) {
  await ensureSuperAdmin()

  const usuarioId = String(formData.get('usuarioId') ?? '')
  if (!usuarioId) return

  const admin = getAdminSupabase()
  const result = await removerConvitePendente(admin, usuarioId)
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
  const result = await revogarAcessoLojista(admin, usuarioId)
  if (!result.ok) {
    redirect(`/superadmin?error=${encodeURIComponent(result.error)}`)
  }

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function salvarConfigPlataformaAction(formData: FormData) {
  await ensureSuperAdmin()

  const ligado = formData.get('cadastroAutomatico') === 'on'
  const diasRaw = String(formData.get('dias') ?? '').trim()
  const dias = diasRaw ? Math.max(0, Math.floor(Number(diasRaw))) : 0

  const admin = getAdminSupabase()
  const result = await salvarConfigPlataforma(admin, { cadastroAutomatico: ligado, cadastroAutomaticoDias: dias })
  if (!result.ok) {
    redirect(`/superadmin?error=${encodeURIComponent(result.error)}`)
  }

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function concederAcessoAction(formData: FormData) {
  await ensureSuperAdmin()

  const usuarioId = String(formData.get('usuarioId') ?? '')
  if (!usuarioId) return

  // Campo opcional: vazio/0 = acesso permanente; N = acesso temporário por N dias.
  const diasRaw = String(formData.get('dias') ?? '').trim()
  const dias = diasRaw ? Math.max(0, Math.floor(Number(diasRaw))) : 0

  const admin = getAdminSupabase()
  const result = await concederAcessoLojista(admin, usuarioId, dias)
  if (!result.ok) {
    redirect(`/superadmin?error=${encodeURIComponent(result.error)}`)
  }

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function excluirLojistaAction(formData: FormData) {
  await ensureSuperAdmin()

  const usuarioId = String(formData.get('usuarioId') ?? '')
  if (!usuarioId) return

  const admin = getAdminSupabase()
  const result = await excluirLojistaCompleto(admin, usuarioId)
  if (!result.ok) {
    redirect(`/superadmin?error=${encodeURIComponent(result.error)}`)
  }

  revalidatePath('/superadmin')
  redirect('/superadmin')
}

export async function sairAction() {
  const supabase = await getServerSupabase()
  await supabase.auth.signOut()
  redirect('/login')
}
