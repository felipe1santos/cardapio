import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'
import { BASE_PUBLICA } from '@/lib/mensageria/robo'
import { pedidoDoCodigo } from '@/lib/motoboy/qr-rota'
import { buscarEntregadorPorUsuario } from '@/lib/queries/pedidos'

/**
 * QR da rota impresso na comanda de entrega (item 59): /r/<código>.
 *   · motoboy logado da MESMA loja (app aberto pela câmera do celular) → app do motoboy, que
 *     confere e oferece "Pegar esta entrega?";
 *   · qualquer outra pessoa (cliente lendo a comanda) → cardápio da loja. Nada do pedido aparece.
 *   · código adulterado ou de outro lugar → "Link inválido" (404).
 * O link não carrega dado pessoal; a assinatura vem de lib/motoboy/qr-rota.ts.
 */
export const dynamic = 'force-dynamic'

const CABECALHOS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' }

export async function GET(_request: Request, { params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  const pedidoId = pedidoDoCodigo(codigo)
  if (!pedidoId) {
    return new NextResponse('<!doctype html><meta charset="utf-8"><title>Link inválido</title><p style="font-family:system-ui;padding:24px">Link inválido.</p>', { status: 404, headers: { ...CABECALHOS, 'Content-Type': 'text/html; charset=utf-8' } })
  }
  const admin = getAdminSupabase()
  const { data: p } = await admin.from('pedidos').select('restaurante_id, restaurantes ( slug )').eq('id', pedidoId).maybeSingle()
  const slug = ((p as { restaurantes?: { slug?: string } } | null)?.restaurantes?.slug) ?? null
  try {
    const sessao = await getCurrentSession(await getServerSupabase())
    // Quem conta é estar ligado a um entregador ativo da loja (o mesmo teste do app /motoboy).
    const daLoja = sessao && p && sessao.restauranteId === (p as { restaurante_id: string }).restaurante_id
    if (daLoja && (await buscarEntregadorPorUsuario(admin, sessao.userId, sessao.restauranteId).catch(() => null))) {
      return NextResponse.redirect(`${BASE_PUBLICA()}/motoboy?qr=${encodeURIComponent(codigo)}`, { status: 302, headers: CABECALHOS })
    }
  } catch { /* sem sessão: segue para o cardápio */ }
  return NextResponse.redirect(slug ? `${BASE_PUBLICA()}/loja/${encodeURIComponent(slug)}` : BASE_PUBLICA(), { status: 302, headers: CABECALHOS })
}
