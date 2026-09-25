'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'
import { registrarAuditoria } from '@/lib/auditoria'
import { concederAcessoLojista, convidarLojista, excluirLojistaCompleto, removerConvitePendente, revogarAcessoLojista, salvarConfigPlataforma } from '@/lib/queries/lojistas'

async function ensureSuperAdmin() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  if (!isSuperAdminEmail(data.user?.email)) {
    redirect('/login')
  }
  return { id: data.user!.id, email: data.user!.email ?? 'superadmin' }
}

/**
 * Piloto do Assistente de Impressão Beta (0100): libera ou retira UMA loja. Liberar só
 * permite gerar código de pareamento e escolher o modo — a loja continua em "Somente
 * teste" e a cozinha no Assistente antigo até o dono mudar. Retirar volta a loja para
 * "Somente teste" (a cozinha retorna ao antigo) antes de tirar a liberação.
 */
export async function alternarBetaImpressaoAction(formData: FormData) {
  const quem = await ensureSuperAdmin()
  const restauranteId = String(formData.get('restauranteId') ?? '')
  const liberar = String(formData.get('liberar') ?? '') === '1'
  if (!/^[0-9a-f-]{36}$/i.test(restauranteId)) return
  const admin = getAdminSupabase()
  if (!liberar) {
    const { error: e1 } = await admin.rpc('impressao_modo_definir', { p_restaurante: restauranteId, p_modo: 'teste', p_ator: null, p_ator_nome: 'Plataforma' })
    if (e1) redirect(`/superadmin?error=${encodeURIComponent('Não foi possível voltar a loja para o Assistente antigo.')}`)
  }
  const { error } = await admin.from('restaurantes').update({ impressao_beta_liberado: liberar }).eq('id', restauranteId)
  if (error) redirect(`/superadmin?error=${encodeURIComponent('Não foi possível alterar o piloto de impressão.')}`)
  await registrarAuditoria(admin, {
    restauranteId, usuarioId: null, usuarioNome: `Plataforma (${quem.email})`,
    acao: liberar ? 'impressao.beta_liberado' : 'impressao.beta_retirado', entidade: 'restaurante', entidadeId: restauranteId, dados: {},
  })
  revalidatePath('/superadmin')
  redirect('/superadmin')
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
