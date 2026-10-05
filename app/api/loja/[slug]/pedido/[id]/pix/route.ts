import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { conferirPagamento } from '@/lib/pagamentos/pix-online'

export const dynamic = 'force-dynamic'

/**
 * Tela "Pague com Pix" do cliente (Pix online, 0148): QR, copia e cola, prazo e situação.
 * A tela consulta a cada 3 s; no máximo a cada 5 s esta rota pede ao MP para conferir (a confirmação
 * é SEMPRE pela API — esta rota só acorda a consulta, nunca confirma por conta própria).
 * O id do pedido é um UUID (só quem fez o pedido tem): nada de dado pessoal na resposta.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Pedido inválido' }, { status: 400 })
  const admin = getAdminSupabase()
  const { data: loja } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
  const ler = async () => {
    const [{ data: ped }, { data: pag }] = await Promise.all([
      admin.from('pedidos').select('id, numero, status, total').eq('id', id).eq('restaurante_id', loja.id).maybeSingle(),
      admin.from('pagamentos_online').select('id, mp_payment_id, status, valor, qr_code, qr_code_base64, expira_em, ultima_verificacao_em').eq('pedido_id', id).eq('restaurante_id', loja.id).order('criado_em', { ascending: false }).limit(1).maybeSingle(),
    ])
    return { ped, pag }
  }
  let { ped, pag } = await ler()
  if (!ped || !pag) return NextResponse.json({ error: 'Pedido sem Pix online' }, { status: 404 })
  const ultima = pag.ultima_verificacao_em ? new Date(pag.ultima_verificacao_em).getTime() : 0
  if (['pendente', 'verificacao_pendente'].includes(pag.status) && pag.mp_payment_id && Date.now() - ultima > 5000) {
    await conferirPagamento(admin, pag.mp_payment_id, 'cliente').catch(() => null)
    ;({ ped, pag } = await ler())
  }
  if (!ped || !pag) return NextResponse.json({ error: 'Pedido sem Pix online' }, { status: 404 })
  const pago = ped.status !== 'aguardando_pagamento' && ped.status !== 'cancelado' && pag.status === 'pago'
  const situacao = pago ? 'pago' : ped.status === 'cancelado' ? (pag.status === 'a_devolver' || pag.status === 'devolvido' ? 'pago_apos_cancelado' : 'expirado') : 'aguardando'
  return NextResponse.json({
    numero: ped.numero, situacao, valor: Number(pag.valor), expiraEm: pag.expira_em,
    qrCode: situacao === 'aguardando' ? pag.qr_code : null, qrCodeBase64: situacao === 'aguardando' ? pag.qr_code_base64 : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
