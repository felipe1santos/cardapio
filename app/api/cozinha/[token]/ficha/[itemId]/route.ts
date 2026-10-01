import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { normalizarFicha } from '@/lib/queries/fichas'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Como fazer" na tela da cozinha: nome, foto e ficha de preparo do item. Só itens da loja
 * da estação (token). Sem ficha: `ficha: null` (a tela mostra o que o pedido pede).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; itemId: string }> }) {
  const { token, itemId } = await params
  const admin = getAdminSupabase()
  const estacao = await buscarEstacaoPorToken(admin, token).catch(() => null)
  if (!estacao) return NextResponse.json({ error: 'Estação inválida ou desativada.' }, { status: 404 })
  if (!UUID.test(itemId)) return NextResponse.json({ error: 'Item inválido.' }, { status: 400 })
  const { data: item } = await admin.from('itens_cardapio').select('id, nome, imagem_url').eq('id', itemId).eq('restaurante_id', estacao.restauranteId).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Item não encontrado.' }, { status: 404 })
  const { data: f } = await admin.from('fichas_preparo').select('ingredientes, passos, tempo_min').eq('item_id', itemId).eq('restaurante_id', estacao.restauranteId).maybeSingle()
  return NextResponse.json(
    { nome: item.nome, imagemUrl: item.imagem_url ?? null, ficha: f ? normalizarFicha({ ingredientes: f.ingredientes, passos: f.passos, tempoMin: f.tempo_min }) : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
