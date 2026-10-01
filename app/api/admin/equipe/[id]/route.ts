import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, podeAdministrar, papeisQuePodeGerenciar, MENSAGEM_RECUSA, type Papel } from '@/lib/auth/permissoes'
import { atualizarNomeEPapel, buscarFuncionario, contarOutrosAdminsAtivos, definirAtivo } from '@/lib/queries/equipe'
import { registrarAuditoria } from '@/lib/auditoria'
import { normalizarAcessos, resumoAcessos } from '@/lib/acessos'
import { definirAcessos } from '@/lib/queries/equipe'

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

  // Correlação: os eventos desta requisição saem ligados na auditoria.
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
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

  // Acessos (0120). O dono nunca é limitado; só o dono libera a área Equipe. Vale na
  // próxima ação do funcionário (o middleware relê a cada requisição).
  let acessosDepois: string | null = null
  if ('acessos' in corpo) {
    if (alvo.papel === 'dono') return NextResponse.json({ error: 'O dono sempre tem acesso total.' }, { status: 400 })
    const novos = corpo.acessos === null ? null : normalizarAcessos(corpo.acessos)
    if (corpo.acessos !== null && !novos) return NextResponse.json({ error: 'Acessos inválidos.' }, { status: 400 })
    if (novos && sessao.papel !== 'dono') novos.areas = novos.areas.filter((a) => a !== 'equipe')
    await definirAcessos(admin, sessao.restauranteId, id, novos)
    acessosDepois = resumoAcessos(patch.papel ?? alvo.papel, novos)
    await registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
      acao: 'equipe.acessos_alterados', entidade: 'usuario', entidadeId: id,
      dados: { alvo: alvo.nome, login: alvo.usuario, antes: resumoAcessos(alvo.papel, alvo.acessos), depois: acessosDepois, areas: (novos?.areas ?? []).join(', '), sensiveis: (novos?.sensiveis ?? []).join(', ') },
    })
  }

  for (const acao of acoes) {
    await registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId,
      usuarioId: sessao.userId,
      usuarioNome: sessao.nome,
      acao,
      entidade: 'usuario',
      entidadeId: id,
      // Antes e depois do que mudou; nunca senha nem e-mail técnico.
      dados: {
        alvo: alvo.nome,
        login: alvo.usuario,
        ...(acao === 'equipe.editou'
          ? {
              antes: { nome: alvo.nome, papel: alvo.papel },
              depois: { nome: patch.nome ?? alvo.nome, papel: patch.papel ?? alvo.papel },
            }
          : { de: alvo.ativo ? 'ativo' : 'desativado', para: acao === 'equipe.reativou' ? 'ativo' : 'desativado' }),
      },
    })
  }

  return NextResponse.json({ ok: true, funcionario: await buscarFuncionario(admin, sessao.restauranteId, id) })
}
