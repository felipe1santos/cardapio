import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { podeFin } from '@/lib/financeiro/permissoes'
import { decidirPedido, pedirAprovacao, pendentesParaMim, situacaoDoPedido } from '@/lib/financeiro/aprovacao-remota'

/**
 * Aprovação pelo celular (Fase 6).
 *   GET              → pedidos que EU posso decidir (exige "aprovar"); ?id=… → situação do MEU pedido
 *   POST {acao, valorCentavos, motivo, contexto}  → pedir (qualquer pessoa da loja com o financeiro)
 *   PATCH {id, decisao: 'aprovar'|'recusar', pin, motivo?}  → decidir com o MEU PIN (exige "aprovar")
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id')
  const c = await contextoFinanceiro(id ? undefined : 'aprovar')
  if ('erro' in c) return c.erro
  if (id) {
    const s = await situacaoDoPedido(c.admin, c.sessao.restauranteId, c.sessao.userId, id)
    if (!s) return NextResponse.json({ error: 'Pedido não encontrado.' }, { status: 404 })
    return NextResponse.json(s, { headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ pedidos: await pendentesParaMim(c.admin, c.sessao.restauranteId, c.sessao.userId) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await pedirAprovacao(c, {
    acao: String(b?.acao ?? ''), valorCentavos: b?.valorCentavos === undefined || b?.valorCentavos === null ? null : Number(b.valorCentavos),
    motivo: typeof b?.motivo === 'string' ? b.motivo : null, contexto: b?.contexto && typeof b.contexto === 'object' ? (b.contexto as Record<string, unknown>) : null,
  })
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json(r, { status: 201 })
}

export async function PATCH(request: Request) {
  const c = await contextoFinanceiro()
  if ('erro' in c) return c.erro
  if (!podeFin(c.sessao.papel, c.acessos, 'aprovar')) return NextResponse.json({ error: 'Você não tem permissão para aprovar.', codigo: 'sem_permissao' }, { status: 403 })
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const decisao = b?.decisao === 'recusar' ? 'recusar' : b?.decisao === 'aprovar' ? 'aprovar' : null
  if (!decisao) return NextResponse.json({ error: 'Decisão inválida.' }, { status: 400 })
  const r = await decidirPedido(c, String(b?.id ?? ''), { decisao, pin: String(b?.pin ?? ''), motivo: typeof b?.motivo === 'string' ? b.motivo : null })
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}
