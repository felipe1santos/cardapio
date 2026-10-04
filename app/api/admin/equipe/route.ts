import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode, papeisQuePodeGerenciar, type Papel } from '@/lib/auth/permissoes'
import { criarFuncionario, listarEquipe, validarNovoFuncionario } from '@/lib/queries/equipe'
import { registrarAuditoria } from '@/lib/auditoria'
import { AREAS, normalizarAcessos, resumoAcessos } from '@/lib/acessos'
import { definirAcessos } from '@/lib/queries/equipe'
import { areasForaDoAlcance, CARGOS, contarPermissoes, excedeOCargo, papelParaAcessos, ROTULO_CARGO, type Cargo } from '@/lib/equipe-cargos'

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
  const telefone = typeof corpo.telefone === 'string' ? corpo.telefone.replace(/\D/g, '').slice(0, 15) : ''

  // Tela nova (0128): manda o CARGO e as permissões; o papel sai daí, nunca do corpo.
  let cargo: Cargo | null = null
  if (typeof corpo.cargo === 'string') {
    if (!(CARGOS as readonly string[]).includes(corpo.cargo) || corpo.cargo === 'dono') {
      return NextResponse.json({ error: 'Cargo inválido.' }, { status: 400 })
    }
    cargo = corpo.cargo as Cargo
    const pedidos = normalizarAcessos(corpo.acessos)
    if (!pedidos || contarPermissoes(pedidos) === 0) return NextResponse.json({ error: 'Marque pelo menos uma permissão.' }, { status: 400 })
    const oferecidos = papeisQuePodeGerenciar(sessao.papel)
    // O cargo define o papel: área além do cargo só com o cargo Personalizado.
    {
      const cargoNovo = cargo, NOVOS = pedidos
      const fora = excedeOCargo(cargoNovo, NOVOS).map((a) => AREAS.find((x) => x.chave === a)!.rotulo)
      if (fora.length) return NextResponse.json({ error: `O cargo ${ROTULO_CARGO[cargoNovo]} não inclui: ${fora.join(', ')}. Para liberar, escolha o cargo Personalizado.`, codigo: 'excede_cargo' }, { status: 400 })
    }
    const papel = papelParaAcessos(cargo, pedidos, oferecidos)
    if (!papel) {
      const fora = areasForaDoAlcance(pedidos, oferecidos).map((a) => AREAS.find((x) => x.chave === a)!.rotulo)
      return NextResponse.json({ error: `Só o dono pode liberar: ${fora.join(', ')}.` }, { status: 403 })
    }
    entrada.papel = papel
  }

  const erros = validarNovoFuncionario(entrada, sessao.papel)
  if (erros.length > 0) return NextResponse.json({ error: erros[0], erros }, { status: 400 })

  // Correlação: os eventos desta requisição saem ligados na auditoria.
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const resultado = await criarFuncionario(admin, {
    // Loja e autor vêm da sessão. O corpo não decide nenhum dos dois.
    restauranteId: sessao.restauranteId,
    criadoPor: sessao.userId,
    nome: entrada.nome,
    usuario: entrada.usuario,
    papel: entrada.papel as Papel,
    senha: entrada.senha,
    cargo,
    telefone,
  })
  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 409 })

  // Acessos escolhidos no cadastro (modelo ou caixas). Só o dono libera a área Equipe.
  const acessos = normalizarAcessos(corpo.acessos)
  if (acessos && sessao.papel !== 'dono') acessos.areas = acessos.areas.filter((a) => a !== 'equipe')
  if (acessos) await definirAcessos(admin, sessao.restauranteId, resultado.valor.id, acessos)

  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId,
    usuarioId: sessao.userId,
    usuarioNome: sessao.nome,
    acao: 'equipe.criou',
    entidade: 'usuario',
    entidadeId: resultado.valor.id,
    // Nunca a senha, nunca o e-mail técnico.
    dados: { nome: resultado.valor.nome, login: resultado.valor.usuario, papel: resultado.valor.papel, ...(cargo ? { cargo } : {}), acessos: resumoAcessos(resultado.valor.papel, acessos) },
  })

  return NextResponse.json({ funcionario: resultado.valor }, { status: 201 })
}
