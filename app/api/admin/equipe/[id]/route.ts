import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, podeAdministrar, papeisQuePodeGerenciar, MENSAGEM_RECUSA, type Papel } from '@/lib/auth/permissoes'
import { atualizarNomeEPapel, buscarFuncionario, contarOutrosAdminsAtivos, definirAtivo } from '@/lib/queries/equipe'
import { registrarAuditoria } from '@/lib/auditoria'

/** Editar nome/papel e ativar/desativar um funcionário. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'equipe.gerenciar')) {
    return NextResponse.json({ error: 'Sem permissão para gerenciar a equipe' }, { status: 403 })
  }

  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()
  // Só enxerga funcionário da PRÓPRIA loja: id de outra loja cai aqui como inexistente.
  const alvo = await buscarFuncionario(admin, sessao.restauranteId, id)
  if (!alvo) return NextResponse.json({ error: 'Funcionário não encontrado' }, { status: 404 })

  const outrosAdminsAtivos = await contarOutrosAdminsAtivos(admin, sessao.restauranteId, id)
  const permitido = podeAdministrar(
    { id: sessao.userId, papel: sessao.papel },
    { id, papel: alvo.papel, outrosAdminsAtivos },
  )
  if (!permitido.ok) return NextResponse.json({ error: MENSAGEM_RECUSA[permitido.motivo] }, { status: 403 })

  const acoes: string[] = []

  const patch: { nome?: string; papel?: Papel } = {}
  if (typeof corpo.nome === 'string' && corpo.nome.trim().length >= 2 && corpo.nome.trim() !== alvo.nome) {
    patch.nome = corpo.nome.trim().slice(0, 80)
  }
  if (typeof corpo.papel === 'string' && corpo.papel !== alvo.papel) {
    // Trocar papel exige poder criar aquele papel: gerente não transforma ninguém em gerente.
    if (!(papeisQuePodeGerenciar(sessao.papel) as string[]).includes(corpo.papel)) {
      return NextResponse.json({ error: 'Você não pode atribuir esse papel.' }, { status: 403 })
    }
    patch.papel = corpo.papel as Papel
  }

  if (typeof corpo.ativo === 'boolean' && corpo.ativo !== alvo.ativo) {
    await definirAtivo(admin, sessao.restauranteId, id, corpo.ativo)
    acoes.push(corpo.ativo ? 'equipe.reativou' : 'equipe.desativou')
  }
  if (patch.nome || patch.papel) {
    await atualizarNomeEPapel(admin, sessao.restauranteId, id, patch)
    acoes.push('equipe.editou')
  }

  for (const acao of acoes) {
    await registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId,
      usuarioId: sessao.userId,
      usuarioNome: sessao.nome,
      acao,
      entidade: 'usuario',
      entidadeId: id,
      dados: { alvo: alvo.nome, login: alvo.usuario, ...(patch.papel ? { papelNovo: patch.papel } : {}) },
    })
  }

  return NextResponse.json({ ok: true, funcionario: await buscarFuncionario(admin, sessao.restauranteId, id) })
}
