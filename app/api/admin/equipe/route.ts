import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, papeisQuePodeGerenciar, type Papel } from '@/lib/auth/permissoes'
import { criarFuncionario, listarEquipe, validarNovoFuncionario } from '@/lib/queries/equipe'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Equipe da loja. O middleware já exige `equipe.gerenciar` nesta rota; a checagem se
 * repete aqui de propósito — rota de servidor não confia que o porteiro esteja no lugar.
 */

async function autorizar() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'equipe.gerenciar')) {
    return { erro: NextResponse.json({ error: 'Sem permissão para gerenciar a equipe' }, { status: 403 }) } as const
  }
  return { sessao } as const
}

export async function GET() {
  const r = await autorizar()
  if ('erro' in r) return r.erro

  const equipe = await listarEquipe(getAdminSupabase(), r.sessao.restauranteId)
  return NextResponse.json({ equipe, papeisOferecidos: papeisQuePodeGerenciar(r.sessao.papel), eu: r.sessao.userId })
}

export async function POST(request: Request) {
  const r = await autorizar()
  if ('erro' in r) return r.erro
  const { sessao } = r

  let corpo: Record<string, unknown>
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const entrada = {
    nome: typeof corpo.nome === 'string' ? corpo.nome : '',
    usuario: typeof corpo.usuario === 'string' ? corpo.usuario : '',
    papel: typeof corpo.papel === 'string' ? corpo.papel : '',
    senha: typeof corpo.senha === 'string' ? corpo.senha : '',
  }

  const erros = validarNovoFuncionario(entrada, sessao.papel)
  if (erros.length > 0) return NextResponse.json({ error: erros[0], erros }, { status: 400 })

  const admin = getAdminSupabase()
  const resultado = await criarFuncionario(admin, {
    // Loja e autor vêm da sessão. O corpo não decide nenhum dos dois.
    restauranteId: sessao.restauranteId,
    criadoPor: sessao.userId,
    nome: entrada.nome,
    usuario: entrada.usuario,
    papel: entrada.papel as Papel,
    senha: entrada.senha,
  })
  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 409 })

  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId,
    usuarioId: sessao.userId,
    usuarioNome: sessao.nome,
    acao: 'equipe.criou',
    entidade: 'usuario',
    entidadeId: resultado.valor.id,
    // Nunca a senha, nunca o e-mail técnico.
    dados: { nome: resultado.valor.nome, login: resultado.valor.usuario, papel: resultado.valor.papel },
  })

  return NextResponse.json({ funcionario: resultado.valor }, { status: 201 })
}
