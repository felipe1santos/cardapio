import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, podeAdministrar, MENSAGEM_RECUSA } from '@/lib/auth/permissoes'
import { buscarFuncionario, contarOutrosAdminsAtivos, redefinirSenha, validarSenha } from '@/lib/queries/equipe'
import { registrarAuditoria } from '@/lib/auditoria'

/** Redefinir a senha de um funcionário — o caminho do garçom que esqueceu a dele. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'equipe.gerenciar')) {
    return NextResponse.json({ error: 'Sem permissão para gerenciar a equipe' }, { status: 403 })
  }

  let senha = ''
  try {
    const corpo = await request.json()
    senha = typeof corpo.senha === 'string' ? corpo.senha : ''
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  const erros = validarSenha(senha)
  if (erros.length > 0) return NextResponse.json({ error: erros[0] }, { status: 400 })

  // Correlação: os eventos desta requisição saem ligados na auditoria.
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const alvo = await buscarFuncionario(admin, sessao.restauranteId, id)
  if (!alvo) return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })

  const outrosAdminsAtivos = await contarOutrosAdminsAtivos(admin, sessao.restauranteId, id)
  const permitido = podeAdministrar(
    { id: sessao.userId, papel: sessao.papel },
    { id, papel: alvo.papel, outrosAdminsAtivos },
  )
  // A trava de "último administrador" não vale aqui: redefinir senha não tira ninguém do
  // ar. As outras (própria conta, nível igual ou superior) continuam valendo.
  if (!permitido.ok && permitido.motivo !== 'ultimo_administrador') {
    return NextResponse.json({ error: MENSAGEM_RECUSA[permitido.motivo] }, { status: 403 })
  }

  const r = await redefinirSenha(admin, id, senha)
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 500 })

  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId,
    usuarioId: sessao.userId,
    usuarioNome: sessao.nome,
    acao: 'equipe.redefiniu_senha',
    entidade: 'usuario',
    entidadeId: id,
    // A senha NUNCA entra aqui — nem mascarada.
    dados: { alvo: alvo.nome, login: alvo.usuario },
  })

  return NextResponse.json({ ok: true })
}
