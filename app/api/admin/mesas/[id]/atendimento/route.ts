import { NextResponse } from 'next/server'
import { contextoSalao } from '@/lib/auth/salao'
import { ehUuid, sanearIdentificacao } from '@/lib/pdv-v2'
import { abrirMesa, liberarMesa, type Ator } from '@/lib/servicos/conta-presencial'

/**
 * Atendimento da mesa no PDV v2 (PDV e painel do garçom).
 *
 * POST `{ acao: 'abrir', nome, telefone?, chave }` — abre a mesa livre com o nome do
 *      cliente (obrigatório) e telefone (opcional). A mesa é travada no banco: dois
 *      operadores ao mesmo tempo → o segundo recebe 409 com a conta do primeiro.
 * POST `{ acao: 'liberar' }` — mesa em limpeza volta a ficar disponível. Idempotente;
 *      nunca desbloqueia nem reativa mesa.
 *
 * Loja e operador vêm da sessão; a origem registrada na auditoria vem do papel
 * (garçom → salão), nunca do corpo. Loja sem pdv_v2 ou sem módulo de mesas: 404.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Porta do salão (sessão + módulo de mesas + permissão), e o recurso só existe com pdv_v2.
  const ctx = await contextoSalao('comanda.ver')
  if ('erro' in ctx) return ctx.erro
  const { data: loja } = await ctx.admin.from('restaurantes').select('pdv_v2').eq('id', ctx.sessao.restauranteId).maybeSingle()
  if (loja?.pdv_v2 !== true) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (!ehUuid(id)) return NextResponse.json({ error: 'Mesa inválida' }, { status: 400 })

  const corpo = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const eu: Ator = { restauranteId: ctx.sessao.restauranteId, userId: ctx.sessao.userId, nome: ctx.sessao.nome, papel: ctx.sessao.papel }
  const origem = ctx.sessao.papel === 'garcom' ? 'salao' : 'pdv'

  if (corpo.acao === 'abrir') {
    if (!ctx.pode('balcao.lancar') && !ctx.pode('pedidos.mesa.criar')) {
      return NextResponse.json({ error: 'Sem permissão para abrir mesa' }, { status: 403 })
    }
    const s = sanearIdentificacao(corpo)
    if (!s.ok) return NextResponse.json({ error: s.erro }, { status: 400 })
    if (!ehUuid(corpo.chave)) return NextResponse.json({ error: 'Operação sem identificador. Recarregue a tela.' }, { status: 400 })
    const r = await abrirMesa(ctx.admin, eu, id, { nome: s.nome, telefone: s.telefone, chave: corpo.chave }, origem)
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo, comandaId: r.codigo === 'mesa_ocupada' ? r.detalhe || undefined : undefined }, { status: r.status })
    return NextResponse.json({ ok: true, comandaId: r.valor.id, numero: r.valor.numero, idempotente: r.valor.idempotente }, { status: r.valor.idempotente ? 200 : 201 })
  }

  if (corpo.acao === 'liberar') {
    if (!ctx.pode('mesas.operar') && !ctx.pode('balcao.abrir')) {
      return NextResponse.json({ error: 'Sem permissão para liberar mesa' }, { status: 403 })
    }
    const r = await liberarMesa(ctx.admin, eu, id, origem)
    if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
    return NextResponse.json({ ok: true, ...r.valor })
  }

  return NextResponse.json({ error: 'Ação desconhecida' }, { status: 400 })
}
