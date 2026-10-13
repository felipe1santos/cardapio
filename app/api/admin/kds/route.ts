import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { pode } from '@/lib/auth/permissoes'
import { normalizarFicha } from '@/lib/queries/fichas'

export const dynamic = 'force-dynamic'

/**
 * KDS único (12/10/2026; só com "Novidades em teste"). O middleware já barra quem não tem a área "KDS" (usuarios.acessos).
 *   GET  ?itens=<id,id…>                 → modo de preparo + ingredientes + passos de cada item (ficha de preparo, privada)
 *   POST { pedidoId, acao }              → comecar (fila → em preparo) | pronto (→ Pronto p/ despacho) | voltar (pronto → preparo)
 * Tudo compare-and-set no status: quem mexeu antes (Kanban ou outro KDS) vence. Despacho continua só no Kanban.
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autorizado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'pedidos.delivery.ver') && !pode(sessao.papel, 'cozinha.pedidos.atualizar_status')) {
    return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  }
  const admin = getAdminSupabase()
  return { sessao, admin }
}

export async function GET(request: Request) {
  const c = await contexto(); if ('erro' in c) return c.erro
  const ids = (new URL(request.url).searchParams.get('itens') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 100)
  if (!ids.length) return NextResponse.json({ fichas: {} })
  const { data } = await c.admin.from('fichas_preparo').select('item_id, ingredientes, passos, tempo_min, modo_preparo')
    .eq('restaurante_id', c.sessao.restauranteId).in('item_id', ids)
  const fichas: Record<string, unknown> = {}
  for (const f of data ?? []) {
    const n = normalizarFicha({ ingredientes: f.ingredientes, passos: f.passos, tempoMin: f.tempo_min, modoPreparo: f.modo_preparo })
    fichas[f.item_id as string] = { modoPreparo: n.modoPreparo ?? null, ingredientes: n.ingredientes, passos: n.passos.map((p) => p.texto), tempoMin: n.tempoMin }
  }
  return NextResponse.json({ fichas }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await contexto(); if ('erro' in c) return c.erro
  const corpo = (await request.json().catch(() => null)) as { pedidoId?: unknown; acao?: unknown } | null
  const id = typeof corpo?.pedidoId === 'string' && /^[0-9a-f-]{36}$/i.test(corpo.pedidoId) ? corpo.pedidoId : null
  if (!id) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  const nome = (c.sessao.nome || 'Cozinha').slice(0, 60)
  const base = () => c.admin.from('pedidos').update(
    corpo?.acao === 'comecar' ? { preparando_por: nome }
      : corpo?.acao === 'pronto' ? { status: 'pronto', preparado_por: nome }
        : { status: 'preparando' },
  ).eq('id', id).eq('restaurante_id', c.sessao.restauranteId)
  let q
  if (corpo?.acao === 'comecar') q = base().eq('status', 'preparando').is('preparando_por', null)
  else if (corpo?.acao === 'pronto') q = base().eq('status', 'preparando')
  else if (corpo?.acao === 'voltar') q = base().eq('status', 'pronto')
  else return NextResponse.json({ error: 'Ação inválida' }, { status: 400 })
  const { data, error } = await q.select('id').maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'O pedido mudou em outra tela. A lista foi atualizada.' }, { status: 409 })
  return NextResponse.json({ ok: true })
}
