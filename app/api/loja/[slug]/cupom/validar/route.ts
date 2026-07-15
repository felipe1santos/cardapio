import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { validarCupom, type HistoricoCliente } from '@/lib/fidelidade-regras'
import { buscarClientePorToken, buscarRestauranteIdPorSlug } from '@/lib/queries/clientes'
import { buscarHistoricoCliente, hojeSaoPaulo, normalizarCodigoCupom } from '@/lib/queries/fidelidade'

interface ValidarCupomBody {
  codigo?: string
  telefone?: string
  token?: string
  subtotal?: number
}

// Só cupons ATIVOS entram aqui — inexistente e inativo colapsam na mesma resposta genérica
// ("Cupom não encontrado."), pra não deixar o cliente descobrir por tentativa que um código
// existe mas está desligado.
const CUPOM_VALIDAR_SELECT = `
  id, codigo, descricao, ativo, tipo, valor, publico, dias_inatividade,
  dias_semana, validade_inicio, validade_fim, valor_minimo_pedido, uso_unico_por_cliente,
  max_usos, usos, itens_cardapio ( nome )
`

/**
 * Pré-validação de cupom pro checkout mostrar o desconto antes de enviar o pedido. Resposta
 * sempre 200 com `{ok:false, motivo}` quando o cupom não pode ser usado — não é um erro HTTP,
 * é o resultado normal de uma validação de negócio.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params

    let body: ValidarCupomBody
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ ok: false, motivo: 'Corpo inválido.' }, { status: 400 })
    }

    const codigo = normalizarCodigoCupom(body.codigo ?? '')
    const subtotal = Number(body.subtotal)
    if (!codigo) return NextResponse.json({ ok: false, motivo: 'Informe o código do cupom.' }, { status: 400 })
    if (!Number.isFinite(subtotal) || subtotal < 0) {
      return NextResponse.json({ ok: false, motivo: 'Subtotal inválido.' }, { status: 400 })
    }

    const admin = getAdminSupabase()
    const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
    if (!restauranteId) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

    const { data: cupomRow, error: cupomError } = await admin
      .from('cupons')
      .select(CUPOM_VALIDAR_SELECT)
      .eq('restaurante_id', restauranteId)
      .eq('codigo', codigo)
      .eq('ativo', true)
      .maybeSingle()
    if (cupomError) throw cupomError
    if (!cupomRow) return NextResponse.json({ ok: false, motivo: 'Cupom não encontrado.' })

    let sessaoValida = false
    if (body.telefone && body.token) {
      const cliente = await buscarClientePorToken(admin, restauranteId, body.telefone, body.token)
      sessaoValida = Boolean(cliente)
    }

    // Cupons de primeira_compra/recompra dependem do histórico do cliente — sem sessão
    // confirmada não dá pra saber quem é o cliente, então não valida com histórico "zerado"
    // (isso deixaria qualquer visitante anônimo usar um cupom de primeira compra).
    if (cupomRow.publico !== 'todos' && !sessaoValida) {
      return NextResponse.json({ ok: false, motivo: 'Entre com seu telefone para usar este cupom.' })
    }

    const historico: HistoricoCliente = sessaoValida
      ? await buscarHistoricoCliente(admin, restauranteId, body.telefone as string, cupomRow.id)
      : { totalPedidosEntregues: 0, ultimoPedidoEm: null, jaUsouEsteCupom: false }

    const { hojeISO, diaSemana } = hojeSaoPaulo()
    const resultado = validarCupom(
      {
        ativo: cupomRow.ativo,
        tipo: cupomRow.tipo,
        valor: cupomRow.valor != null ? Number(cupomRow.valor) : null,
        publico: cupomRow.publico,
        diasInatividade: cupomRow.dias_inatividade ?? null,
        diasSemana: cupomRow.dias_semana ?? [],
        validadeInicio: cupomRow.validade_inicio,
        validadeFim: cupomRow.validade_fim,
        valorMinimoPedido: cupomRow.valor_minimo_pedido != null ? Number(cupomRow.valor_minimo_pedido) : null,
        usoUnicoPorCliente: cupomRow.uso_unico_por_cliente,
        maxUsos: cupomRow.max_usos,
        usos: cupomRow.usos,
      },
      historico,
      { subtotal, diaSemana, hojeISO }
    )
    if (!resultado.ok) return NextResponse.json({ ok: false, motivo: resultado.motivo })

    return NextResponse.json({
      ok: true,
      cupom: {
        codigo: cupomRow.codigo,
        tipo: cupomRow.tipo,
        valor: cupomRow.valor != null ? Number(cupomRow.valor) : null,
        descricao: cupomRow.descricao,
        // `itens_cardapio` é embed to-one (só 1 FK de `cupons` pra `itens_cardapio`), mas o
        // parser de tipos do postgrest-js infere array a partir da string do select — mesma
        // ambiguidade já documentada em lib/queries/fidelidade.ts.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        itemNome: (cupomRow.itens_cardapio as any)?.nome,
      },
    })
  } catch (err) {
    console.error('[cupom/validar] erro inesperado:', err)
    return NextResponse.json({ ok: false, motivo: 'Erro interno.' }, { status: 500 })
  }
}
