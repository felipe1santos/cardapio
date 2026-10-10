'use client'

import Link from 'next/link'
import { RouteMap, type RouteStop } from '@/components/maps/route-map'
import type { LojaNoMapa } from '@/lib/maps/loja-mapa'

const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

/** Mapa da rota do pedido do QR (conferência do dono/gerente). Sem chamada paga no navegador: coordenadas gravadas. */
export function RotaDoQr({ numero, cliente, endereco, parada, loja }: { numero: number; cliente: string; endereco: string; parada: RouteStop; loja: LojaNoMapa }) {
  const origem = loja.lat != null && loja.lng != null ? { lat: loja.lat, lng: loja.lng } : null
  return (
    <div className="mx-auto max-w-[900px] p-4" data-testid="rota-qr">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[17px] font-semibold text-text-main">Rota do pedido #{numero}</h1>
        <Link href="/admin/pedidos" className="text-[12.5px] font-semibold text-primary hover:underline">Painel de Pedidos</Link>
      </div>
      <p className="mb-3 text-[13px] text-text-subtle">{cliente ? `${cliente} · ` : ''}{endereco || 'Endereço não informado'}</p>
      <div className="overflow-hidden rounded-[3px] border border-border bg-white">
        <RouteMap apiKey={MAPS_KEY} origin={origem} stops={[parada]} loja={loja} className="h-[60vh] w-full" emptyMessage="Este pedido ainda não tem a localização gravada." />
      </div>
    </div>
  )
}
