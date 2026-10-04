import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { lerFicha, salvarFicha, type AlvoTipo } from '@/lib/financeiro/cmv'

/**
 * Ficha de custo de um alvo: item, tamanho, sabor×tamanho (pizza), complemento, borda, massa.
 *   GET ?tipo&id[&tamanho]                 (custos_ver)
 *   PUT { tipo, id, tamanho?, componentes: [{ insumoId, quantidadeBase }] }   (custos_editar)
 * O custo nunca vem do corpo: é calculado dos insumos da loja.
 */
const UUID = /^[0-9a-f-]{36}$/i
const TIPOS: AlvoTipo[] = ['item', 'tamanho', 'sabor', 'complemento', 'borda', 'massa']

function alvo(tipo: unknown, id: unknown, tam: unknown) {
  if (!TIPOS.includes(tipo as AlvoTipo) || typeof id !== 'string' || !UUID.test(id)) return null
  const t = typeof tam === 'string' && UUID.test(tam) ? tam : null
  if ((tipo === 'sabor') !== !!t) return null
  return { tipo: tipo as AlvoTipo, id, tam: t }
}

export async function GET(request: Request) {
  const c = await contextoFinanceiro('custos_ver')
  if ('erro' in c) return c.erro
  const sp = new URL(request.url).searchParams
  const a = alvo(sp.get('tipo'), sp.get('id'), sp.get('tamanho'))
  const f = a ? await lerFicha(c.admin, c.sessao.restauranteId, a.tipo, a.id, a.tam) : null
  if (!f) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })
  return NextResponse.json(f, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PUT(request: Request) {
  const c = await contextoFinanceiro('custos_editar')
  if ('erro' in c) return c.erro
  const corpo = await request.json().catch(() => null)
  const a = alvo(corpo?.tipo, corpo?.id, corpo?.tamanho)
  if (!a) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })
  const comps = Array.isArray(corpo?.componentes) ? (corpo.componentes as { insumoId?: unknown; quantidadeBase?: unknown }[])
    .filter((x) => typeof x?.insumoId === 'string' && UUID.test(x.insumoId as string))
    .map((x) => ({ insumoId: x.insumoId as string, quantidadeBase: Number(x.quantidadeBase) })) : []
  const r = await salvarFicha(c, a.tipo, a.id, a.tam, comps)
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  return NextResponse.json({ ok: true, fichaId: r.valor.fichaId })
}
