import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, podeAdministrar, papeisQuePodeGerenciar, MENSAGEM_RECUSA, type Papel } from '@/lib/auth/permissoes'
import { atualizarNomeEPapel, buscarFuncionario, contarOutrosAdminsAtivos, definirAtivo } from '@/lib/queries/equipe'
import { registrarAuditoria } from '@/lib/auditoria'
import { encerrarSessoes } from '@/lib/financeiro/sessoes'
import { normalizarAcessos, resumoAcessos } from '@/lib/acessos'
import { definirAcessos } from '@/lib/queries/equipe'
import { AREAS } from '@/lib/acessos'
import { areasForaDoAlcance, CARGOS, contarPermissoes, papelParaAcessos, type Cargo } from '@/lib/equipe-cargos'

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

  const patch: { nome?: string; papel?: Papel; cargo?: string; telefone?: string } = {}
  if (typeof corpo.telefone === 'string') {
    const t = corpo.telefone.replace(/\D/g, '').slice(0, 15)
    if (t !== alvo.telefone) patch.telefone = t
  }
  // Tela nova (0128): cargo + permissões. O papel é deduzido no servidor (nunca do corpo).
  if (typeof corpo.cargo === 'string') {
    if (alvo.papel === 'dono') return NextResponse.json({ error: 'O dono sempre tem acesso total.' }, { status: 400 })
    if (!(CARGOS as readonly string[]).includes(corpo.cargo) || corpo.cargo === 'dono') return NextResponse.json({ error: 'Cargo inválido.' }, { status: 400 })
    const novos = normalizarAcessos(corpo.acessos)
    if (!novos || contarPermissoes(novos) === 0) return NextResponse.json({ error: 'Marque pelo menos uma permissão.' }, { status: 400 })
    // Quem edita pode manter o papel atual do alvo (o dono editando um gerente).
    const oferecidos = [...new Set([...papeisQuePodeGerenciar(sessao.papel), alvo.papel])] as Papel[]
    const papel = papelParaAcessos(corpo.cargo as Cargo, novos, oferecidos)
    if (!papel) {
      const fora = areasForaDoAlcance(novos, oferecidos).map((a) => AREAS.find((x) => x.chave === a)!.rotulo)
      return NextResponse.json({ error: `Só o dono pode liberar: ${fora.join(', ')}.` }, { status: 403 })
    }
    if (corpo.cargo !== alvo.cargo) patch.cargo = corpo.cargo
    if (papel !== alvo.papel) corpo.papel = papel
  }
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

  if (typeof corpo.situacao === 'string') {
    // Pausar, bloquear e excluir cortam o acesso do mesmo jeito (desativado_em); a
    // situação guarda o porquê. Excluir NÃO apaga: login, histórico e pedidos ficam.
    const s = corpo.situacao
    if (!['ativo', 'pausado', 'bloqueado', 'excluido'].includes(s)) return NextResponse.json({ error: 'Situação inválida.' }, { status: 400 })
    const atual = alvo.ativo ? 'ativo' : (alvo.situacao ?? 'pausado')
    if (s !== atual) {
      if (s === 'ativo') await definirAtivo(admin, sessao.restauranteId, id, true)
      else await definirAtivo(admin, sessao.restauranteId, id, false, s as 'pausado' | 'bloqueado' | 'excluido')
      await cortarOuDevolverLogin(admin, sessao.restauranteId, id, s === 'ativo', s)
      acoes.push(s === 'ativo' ? 'equipe.reativou' : s === 'pausado' ? 'equipe.pausou' : s === 'bloqueado' ? 'equipe.bloqueou' : 'equipe.excluiu')
    }
  } else if (typeof corpo.ativo === 'boolean' && corpo.ativo !== alvo.ativo) {
    await definirAtivo(admin, sessao.restauranteId, id, corpo.ativo)
    await cortarOuDevolverLogin(admin, sessao.restauranteId, id, corpo.ativo, 'desativado')
    acoes.push(corpo.ativo ? 'equipe.reativou' : 'equipe.desativou')
  }
  if (patch.telefone !== undefined || patch.cargo !== undefined) {
    await atualizarNomeEPapel(admin, sessao.restauranteId, id, { telefone: patch.telefone, cargo: patch.cargo })
    if (!patch.nome && !patch.papel) acoes.push('equipe.editou')
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
          : { de: alvo.ativo ? 'ativo' : (alvo.situacao ?? 'desativado'), para: ({ 'equipe.reativou': 'ativo', 'equipe.pausou': 'pausado', 'equipe.bloqueou': 'bloqueado', 'equipe.excluiu': 'excluido' } as Record<string, string>)[acao] ?? 'desativado' }),
      },
    })
  }

  return NextResponse.json({ ok: true, funcionario: await buscarFuncionario(admin, sessao.restauranteId, id) })
}

/**
 * Pausar/bloquear/excluir derruba o login NA HORA (0132): o RLS já cortava o painel, mas o
 * token seguia renovando e o terminal ficava "aberto". Ban no Auth + sessões encerradas;
 * reativar devolve. Falha aqui não desfaz a desativação (ela já vale pelo RLS).
 * Só nas lojas com o financeiro ligado; nas outras o login segue como sempre foi (a tela de
 * login explica o acesso pausado). Reativar desbane sempre — inofensivo se não havia ban.
 */
async function cortarOuDevolverLogin(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string, id: string, ativo: boolean, motivo: string) {
  if (!ativo) {
    const { data: loja } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', restauranteId).maybeSingle()
    if (!loja?.financeiro_ativo) return
  }
  const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: ativo ? 'none' : '876000h' })
  if (error) console.error('[equipe] ban do login falhou:', error.message)
  if (!ativo) await encerrarSessoes(admin, id, motivo)
}
