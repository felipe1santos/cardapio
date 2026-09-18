import { NextResponse } from 'next/server'
import { contextoSalao } from '@/lib/auth/salao'
import { assumirChamado, concluirChamado, listarChamadosAbertos } from '@/lib/queries/chamados'

/**
 * Chamados abertos do salão (GET) e as duas ações do garçom (POST).
 *
 * `contextoSalao` reconfere sessão, módulo ligado e `mesas.operar` — o caixa não atende
 * chamado, e esconder o botão não é autorização.
 *
 * Assumir e concluir são funções do banco (0068): dois garçons tocam "assumir" no mesmo
 * chamado e só um ganha — o outro recebe o nome de quem pegou, em vez de sobrescrever.
 * Nenhuma das duas cria pedido, comanda ou movimento financeiro.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const contexto = () => contextoSalao('mesas.operar')

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const chamados = await listarChamadosAbertos(ctx.admin, ctx.sessao.restauranteId)
  return NextResponse.json({ chamados })
}

export async function POST(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx

  let corpo: { acao?: unknown; chamadoId?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const chamadoId = typeof corpo.chamadoId === 'string' ? corpo.chamadoId : ''
  if (!UUID.test(chamadoId)) return NextResponse.json({ error: 'Chamado inválido' }, { status: 400 })

  // A loja vem da sessão; a função do banco filtra por ela. Chamado de outra loja não é
  // encontrado — e o 404 é igual ao de chamado inexistente.
  const acao = corpo.acao
  const r =
    acao === 'assumir'
      ? await assumirChamado(admin, { restauranteId: sessao.restauranteId, chamadoId, atorId: sessao.userId, atorNome: sessao.nome })
      : acao === 'concluir'
        ? await concluirChamado(admin, { restauranteId: sessao.restauranteId, chamadoId, atorId: sessao.userId, atorNome: sessao.nome })
        : null

  if (r === null) return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
  if (!r.ok) {
    const status = r.codigo === 'chamado_inexistente' ? 404 : r.codigo === 'ja_assumido' ? 409 : 400
    return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status })
  }

  return NextResponse.json({ ok: true, ...r.valor })
}
