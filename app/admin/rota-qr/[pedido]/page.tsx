import { notFound } from 'next/navigation'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { RotaDoQr } from './rota'

/**
 * QR da rota aberto por quem gerencia a loja (10/10): dono, gerente ou quem opera a logística confere a rota do
 * pedido — o mesmo mapa do despacho. Só pedido da própria loja; sem login, o /r/ manda para o app do motoboy (que
 * pede login). O middleware já barra motoboy aqui (ele vê o pedido no app dele).
 */
export const dynamic = 'force-dynamic'

export default async function RotaQrPage({ params }: { params: Promise<{ pedido: string }> }) {
  const { pedido } = await params
  if (!/^[0-9a-f-]{36}$/i.test(pedido)) notFound()
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao || !pode(sessao.papel, 'logistica.operar')) notFound()
  const admin = getAdminSupabase()
  const [{ data: p }, { data: loja }] = await Promise.all([
    admin.from('pedidos').select('id, numero, cliente_nome, endereco_rua, endereco_numero, endereco_bairro, entrega_latitude, entrega_longitude')
      .eq('id', pedido).eq('restaurante_id', sessao.restauranteId).maybeSingle(),
    admin.from('restaurantes').select('latitude, longitude').eq('id', sessao.restauranteId).maybeSingle(),
  ])
  if (!p) notFound()
  const endereco = [p.endereco_rua, p.endereco_numero, p.endereco_bairro].filter(Boolean).join(', ')
  const l = loja as { latitude?: number | null; longitude?: number | null } | null
  return (
    <RotaDoQr
      numero={p.numero as number}
      cliente={(p.cliente_nome as string) ?? ''}
      endereco={endereco}
      parada={{ id: p.id as string, numero: p.numero as number, address: endereco, lat: (p.entrega_latitude as number | null) ?? null, lng: (p.entrega_longitude as number | null) ?? null }}
      loja={{ lat: l?.latitude ?? null, lng: l?.longitude ?? null, cidade: null }}
    />
  )
}
