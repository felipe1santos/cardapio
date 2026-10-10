import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { criarFuncionario, validarSenha } from '@/lib/queries/equipe'
import { encerrarSessoes } from '@/lib/financeiro/sessoes'
import { refletirNoUsuario } from '@/lib/motoboy/cadastro'

/**
 * Cadastro do entregador (0136) — sempre no servidor, da loja da sessão.
 *   POST { acao: 'novo_link' }                     → troca o token: o link/QR antigo para na hora
 *   POST { acao: 'desativar' } / { acao: 'reativar' } → desativado não entra pelo link nem pelo login
 *   POST { acao: 'criar_login', usuario, senha }   → login do app do motoboy (papel entregador, sem painel)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'logistica.operar')) return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Entregador inválido.' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const loja = sessao.restauranteId
  const { data: e } = await admin.from('entregadores').select('id, nome, usuario_id, desativado_em, telefone').eq('id', id).eq('restaurante_id', loja).maybeSingle()
  if (!e) return NextResponse.json({ error: 'Entregador não encontrado.' }, { status: 404 })
  const auditar = (acao: string, dados: Record<string, unknown>) => registrarAuditoria(admin, { restauranteId: loja, usuarioId: sessao.userId, usuarioNome: sessao.nome, acao, entidade: 'entregador', entidadeId: e.id as string, dados: { entregador: e.nome, ...dados } })

  switch (corpo?.acao) {
    case 'novo_link': {
      const token = crypto.randomUUID()
      await admin.from('entregadores').update({ token }).eq('id', e.id)
      await auditar('entregador.novo_link', {})
      return NextResponse.json({ ok: true, token })
    }
    case 'desativar':
    case 'reativar': {
      const desativar = corpo.acao === 'desativar'
      // Desativar também troca o token (o link antigo não volta a valer ao reativar) e derruba o login.
      await admin.from('entregadores').update(desativar ? { desativado_em: new Date().toISOString(), token: crypto.randomUUID(), status: 'offline' } : { desativado_em: null }).eq('id', e.id)
      // Equipe = Entregadores (10/10): o usuário do motoboy também fica pausado/ativo na Equipe.
      if (e.usuario_id) await refletirNoUsuario(admin, loja, e.usuario_id as string, !desativar)
      if (desativar && e.usuario_id) {
        await admin.auth.admin.updateUserById(e.usuario_id as string, { ban_duration: '876000h' }).catch(() => {})
        await encerrarSessoes(admin, e.usuario_id as string, 'entregador_desativado')
      } else if (!desativar && e.usuario_id) {
        await admin.auth.admin.updateUserById(e.usuario_id as string, { ban_duration: 'none' }).catch(() => {})
      }
      await auditar(desativar ? 'entregador.desativou' : 'entregador.reativou', {})
      return NextResponse.json({ ok: true })
    }
    case 'criar_login': {
      if (!pode(sessao.papel, 'equipe.gerenciar')) return NextResponse.json({ error: 'Só quem gerencia a Equipe cria login.' }, { status: 403 })
      if (e.usuario_id) return NextResponse.json({ error: 'Este entregador já tem login.' }, { status: 409 })
      const usuario = typeof corpo.usuario === 'string' ? corpo.usuario.trim().toLowerCase() : ''
      const senha = typeof corpo.senha === 'string' ? corpo.senha : ''
      const erros = validarSenha(senha)
      if (erros.length) return NextResponse.json({ error: erros[0] }, { status: 400 })
      const r = await criarFuncionario(admin, { restauranteId: loja, nome: e.nome as string, usuario, papel: 'entregador', senha, criadoPor: sessao.userId, cargo: 'motoboy', telefone: (e.telefone as string) ?? '' })
      if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 409 })
      await admin.from('entregadores').update({ usuario_id: r.valor.id }).eq('id', e.id)
      await auditar('entregador.criou_login', { login: r.valor.usuario })
      return NextResponse.json({ ok: true, usuario: r.valor.usuario })
    }
    default:
      return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 })
  }
}
