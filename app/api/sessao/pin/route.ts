import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { registrarAuditoria } from '@/lib/auditoria'
import { criarLimitador } from '@/lib/limite-taxa'

/**
 * Definir o PRÓPRIO PIN (4 a 6 dígitos) — exige a senha atual: quem acha o painel aberto não troca o
 * PIN de ninguém. O PIN é pessoal: nem o dono vê; o gerente/dono só pode APAGAR (Equipe).
 *   POST { senha, pin }
 */
const erros = criarLimitador({ max: 5, janelaMs: 15 * 60_000 })

export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const sessao = await getCurrentSession(supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!sessao || !user?.email) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const corpo = await request.json().catch(() => null)
  const senha = typeof corpo?.senha === 'string' ? corpo.senha : ''
  const pin = typeof corpo?.pin === 'string' ? corpo.pin : ''
  if (!/^[0-9]{4,6}$/.test(pin)) return NextResponse.json({ error: 'O PIN tem de 4 a 6 números.' }, { status: 400 })
  if (erros.excedeu(user.id)) return NextResponse.json({ error: 'Muitas tentativas. Aguarde alguns minutos.' }, { status: 429 })
  const conf = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: ok, error: e } = await conf.auth.signInWithPassword({ email: user.email, password: senha })
  if (e || ok.user?.id !== user.id) {
    erros.registrar(user.id)
    return NextResponse.json({ error: 'Senha incorreta.' }, { status: 403 })
  }
  // 'local': encerra só a sessão de conferência; o padrão (global) derrubaria o painel aberto.
  await conf.auth.signOut({ scope: 'local' }).catch(() => {})
  erros.limpar(user.id)
  const admin = getAdminSupabase()
  const { error } = await admin.rpc('usuario_definir_pin', { p_usuario: user.id, p_pin: pin })
  if (error) {
    if (/pin_fraco/.test(error.message)) return NextResponse.json({ error: 'PIN fácil demais (números repetidos ou em sequência). Escolha outro.' }, { status: 400 })
    return NextResponse.json({ error: 'Não foi possível salvar o PIN.' }, { status: 500 })
  }
  await registrarAuditoria(admin, { restauranteId: sessao.restauranteId, usuarioId: user.id, usuarioNome: sessao.nome, acao: 'sessao.definiu_pin', entidade: 'usuario', entidadeId: user.id, dados: {} })
  return NextResponse.json({ ok: true })
}
