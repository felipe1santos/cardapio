import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { registrarAuditoria } from '@/lib/auditoria'
import { criarLimitador } from '@/lib/limite-taxa'

/**
 * Troca de senha pelo painel (Ajustes → Conta). Exige a senha ATUAL (B16): antes quem
 * encontrava o painel aberto no computador da loja trocava a senha e tomava a conta.
 *
 *   POST { atual, nova }
 */
const errosPorUsuario = criarLimitador({ max: 5, janelaMs: 15 * 60_000 })

export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const corpo = (await request.json().catch(() => null)) as { atual?: unknown; nova?: unknown } | null
  const atual = typeof corpo?.atual === 'string' ? corpo.atual : ''
  const nova = typeof corpo?.nova === 'string' ? corpo.nova : ''
  if (!atual) return NextResponse.json({ error: 'Informe a senha atual.' }, { status: 400 })
  if (nova.length < 6) return NextResponse.json({ error: 'A senha deve ter no mínimo 6 caracteres.' }, { status: 400 })
  if (nova.length > 72) return NextResponse.json({ error: 'A senha pode ter até 72 caracteres.' }, { status: 400 })
  if (errosPorUsuario.excedeu(user.id)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 })

  // Confere a senha atual num cliente à parte, sem tocar nos cookies da sessão do painel.
  const conferencia = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: conf, error: errConf } = await conferencia.auth.signInWithPassword({ email: user.email, password: atual })
  if (errConf || conf.user?.id !== user.id) {
    errosPorUsuario.registrar(user.id)
    return NextResponse.json({ error: 'Senha atual incorreta.' }, { status: 403 })
  }
  await conferencia.auth.signOut().catch(() => {})
  errosPorUsuario.limpar(user.id)

  const admin = getAdminSupabase()
  const { error } = await admin.auth.admin.updateUserById(user.id, { password: nova })
  if (error) return NextResponse.json({ error: 'Não foi possível alterar a senha. Tente novamente.' }, { status: 500 })

  const { data: perfil } = await admin.from('usuarios').select('restaurante_id, nome').eq('id', user.id).maybeSingle()
  if (perfil?.restaurante_id) {
    await registrarAuditoria(admin, {
      restauranteId: perfil.restaurante_id as string, usuarioId: user.id, usuarioNome: (perfil.nome as string | null) ?? user.email,
      acao: 'equipe.trocou_propria_senha', entidade: 'usuario', entidadeId: user.id, dados: {},
    }).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}
