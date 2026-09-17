import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverMesaPorToken } from '@/lib/queries/mesas'
import { abrirOuObterSessao, buscarSelecao, mesaDestinoDaSessaoTransferida, salvarSelecao, sanearSelecao } from '@/lib/queries/mesa-sessao'
import { listarItens } from '@/lib/queries/cardapio'

/**
 * Rascunho do cliente na mesa. **Não cria pedido.**
 *
 * Este arquivo não importa `criarPedido`, não toca em `pedidos`, `pedido_itens` nem
 * `comandas`, e não chama a cozinha ou a impressão. Quem lança o pedido oficial é o
 * garçom, autenticado, em outro caminho. Se um dia alguém precisar mudar isso, é aqui
 * que a revisão tem que parar.
 *
 * Roda com `service_role` porque a chave anônima não tem grant em `mesas`,
 * `sessoes_mesa` nem `selecoes_mesa` — o token opaco da URL é a credencial, e ele é
 * resolvido a cada requisição (mesa inativa, bloqueada, token revogado ou módulo
 * desligado devolvem 404 igual).
 */

const DISPOSITIVO_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function contexto(token: string) {
  const admin = getAdminSupabase()
  const mesa = await resolverMesaPorToken(admin, token)
  if (!mesa) return null
  const sessao = await abrirOuObterSessao(admin, mesa.restauranteId, mesa.mesaId)
  return { admin, mesa, sessao }
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const dispositivo = new URL(request.url).searchParams.get('dispositivo') ?? ''
  if (!DISPOSITIVO_VALIDO.test(dispositivo)) {
    return NextResponse.json({ error: 'Dispositivo inválido' }, { status: 400 })
  }

  const ctx = await contexto(token)
  if (!ctx) return NextResponse.json({ error: 'Mesa não encontrada' }, { status: 404 })

  const selecao = await buscarSelecao(ctx.admin, ctx.sessao.id, dispositivo)

  // O aparelho diz em que sessão estava. Se ela acabou porque a conta mudou de mesa, a tela
  // orienta a ler o QR da mesa nova. Só o nome da mesa sai daqui — nada que dê acesso.
  const anterior = new URL(request.url).searchParams.get('sessao') ?? ''
  const mesaMudouPara =
    DISPOSITIVO_VALIDO.test(anterior) && anterior !== ctx.sessao.id
      ? await mesaDestinoDaSessaoTransferida(ctx.admin, ctx.mesa.restauranteId, ctx.mesa.mesaId, anterior)
      : null

  // `id: null` = não há rascunho aberto neste aparelho. Se o cliente tinha um e agora não
  // tem, o garçom enviou o pedido e encerrou o ciclo — a tela avisa e recomeça vazia.
  return NextResponse.json({
    id: selecao?.id ?? null,
    itens: selecao?.itens ?? [],
    versao: selecao?.versao ?? 0,
    sessao: ctx.sessao.id,
    mesaMudouPara,
  })
}

export async function PUT(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  let corpo: { dispositivo?: unknown; itens?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const dispositivo = typeof corpo.dispositivo === 'string' ? corpo.dispositivo : ''
  if (!DISPOSITIVO_VALIDO.test(dispositivo)) {
    return NextResponse.json({ error: 'Dispositivo inválido' }, { status: 400 })
  }

  const ctx = await contexto(token)
  if (!ctx) return NextResponse.json({ error: 'Mesa não encontrada' }, { status: 404 })

  // Preço e nome vêm do catálogo, nunca do navegador — e item que não é desta loja é
  // descartado. A seleção é só uma lista, mas ainda assim não pode exibir preço
  // inventado para o garçom.
  const itensDaLoja = await listarItens(ctx.admin, ctx.mesa.restauranteId)
  const catalogo = new Map(
    itensDaLoja
      .filter((i) => i.status === 'disponivel')
      .map((i) => [i.id, { nome: i.nome, preco: i.promocaoPreco ?? i.preco }]),
  )

  const itens = sanearSelecao(corpo.itens, catalogo)
  const salva = await salvarSelecao(ctx.admin, {
    restauranteId: ctx.mesa.restauranteId,
    mesaId: ctx.mesa.mesaId,
    sessaoId: ctx.sessao.id,
    dispositivo,
    itens,
  })

  return NextResponse.json({ ok: true, id: salva.id, versao: salva.versao, itens: salva.itens })
}
