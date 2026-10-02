import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, podeAdministrar, MENSAGEM_RECUSA } from '@/lib/auth/permissoes'
import { buscarFuncionario, contarOutrosAdminsAtivos } from '@/lib/queries/equipe'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Apagar o PIN de um funcionário (0132) — o caminho de quem esqueceu o PIN ou ficou bloqueado.
 * O gestor NUNCA vê nem define o PIN de ninguém: só apaga; o funcionário cria outro com a senha.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'equipe.gerenciar')) {
    return NextResponse.json({ error: 'Sem permissão para gerenciar a equipe' }, { status: 403 })
  }

  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const alvo = await buscarFuncionario(admin, sessao.restauranteId, id)
  if (!alvo) return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })

  const outrosAdminsAtivos = await contarOutrosAdminsAtivos(admin, sessao.restauranteId, id)
  const permitido = podeAdministrar({ id: sessao.userId, papel: sessao.papel }, { id, papel: alvo.papel, outrosAdminsAtivos })
  if (!permitido.ok && permitido.motivo !== 'ultimo_administrador') {
    return NextResponse.json({ error: MENSAGEM_RECUSA[permitido.motivo] }, { status: 403 })
  }

  const { error } = await admin.from('usuarios')
    .update({ pin_hash: null, pin_falhas: 0, pin_bloqueado_ate: null, pin_definido_em: null })
    .eq('id', id).eq('restaurante_id', sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível apagar o PIN.' }, { status: 500 })

  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: 'equipe.apagou_pin', entidade: 'usuario', entidadeId: id, dados: { alvo: alvo.nome, login: alvo.usuario },
  })
  return NextResponse.json({ ok: true })
}
