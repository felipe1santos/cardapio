import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { cartaoOnlineDaLoja, desistirDoCartao, limparDadosCartao, pagarComCartao, situacaoCartao } from '@/lib/pagamentos/cartao-online'
import { criarLimitador, ipDaRequisicao } from '@/lib/limite-taxa'

export const dynamic = 'force-dynamic'

// Freio de cartão testado em série (card testing): por IP e por pedido. O pedido já para em 6 tentativas no banco.
const porIp = criarLimitador({ max: 12, janelaMs: 10 * 60_000 })
// A tela consulta a situação poucas vezes (em análise); cada consulta pode chamar o MP: no máximo 1 a cada 4 s por pedido.
const consultas = criarLimitador({ max: 1, janelaMs: 4_000 })

async function lojaDoSlug(slug: string) {
  const admin = getAdminSupabase()
  const { data: loja } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  return { admin, loja }
}

/** Situação do pagamento com cartão (tela do cliente). O id do pedido é um UUID: nada de dado pessoal na resposta. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  const { admin, loja } = await lojaDoSlug(slug)
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
  if (consultas.excedeu(id)) return NextResponse.json({ resultado: 'em_analise', mensagem: null }, { headers: { 'Cache-Control': 'no-store' } })
  consultas.registrar(id)
  const s = await situacaoCartao(admin, loja.id, id)
  return NextResponse.json(s, { headers: { 'Cache-Control': 'no-store' } })
}

/** `{ acao: 'pagar', ...dados do Brick }` (só o token; nunca o cartão) ou `{ acao: 'desistir' }` (trocar a forma de pagamento). */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  let corpo: Record<string, unknown>
  try {
    corpo = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }
  const { admin, loja } = await lojaDoSlug(slug)
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  if (corpo?.acao === 'desistir') {
    const r = await desistirDoCartao(admin, loja.id, id)
    return NextResponse.json({ resultado: r })
  }
  if (corpo?.acao !== 'pagar') return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })

  const ip = ipDaRequisicao(request.headers)
  if (porIp.excedeu(ip)) return NextResponse.json({ resultado: 'recusado', mensagem: 'Muitas tentativas. Aguarde alguns minutos ou escolha outra forma de pagamento.' }, { status: 429 })
  porIp.registrar(ip)

  const loja2 = await cartaoOnlineDaLoja(admin, loja.id).catch(() => null)
  if (!loja2?.ativo) return NextResponse.json({ resultado: 'recusado', mensagem: 'O pagamento com cartão online não está disponível agora. Escolha outra forma de pagamento.' }, { status: 409 })
  const dadosBrick = { ...corpo }
  delete dadosBrick.acao
  const limpo = limparDadosCartao(dadosBrick, loja2.parcelasMax)
  if (!limpo.ok) return NextResponse.json({ resultado: 'recusado', mensagem: limpo.erro }, { status: 400 })
  const r = await pagarComCartao(admin, { restauranteId: loja.id, pedidoId: id, dados: limpo.dados })
  return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
}
