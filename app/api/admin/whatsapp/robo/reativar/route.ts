import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'

/** Devolve ao robô uma conversa silenciada (atendente/loja). Só a conversa da loja da sessão. */
export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  let corpo: { conversaId?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  if (typeof corpo.conversaId !== 'string' || !/^[0-9a-f-]{36}$/i.test(corpo.conversaId)) {
    return NextResponse.json({ error: 'Conversa inválida.' }, { status: 400 })
  }
  const admin = getAdminSupabase()
  const { data, error } = await admin
    .from('whatsapp_conversas')
    .update({ estado: 'robo', silenciada_em: null, silenciada_motivo: null })
    .eq('id', corpo.conversaId)
    .eq('restaurante_id', sessao.restauranteId)
    .eq('estado', 'silenciada')
    .select('id')
  if (error) return NextResponse.json({ error: 'Não foi possível reativar.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 })
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'whatsapp.conversa_reativada', entidade: 'whatsapp_conversa', entidadeId: corpo.conversaId,
  })
  return NextResponse.json({ ok: true })
}
