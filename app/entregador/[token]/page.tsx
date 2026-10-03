'use client'

import { useParams } from 'next/navigation'
import { PortalMotoboy } from '@/components/motoboy/portal'

/** Portal do motoboy pelo link/QR (token). O mesmo app do login (/motoboy) — ver components/motoboy/portal. */
export default function EntregadorPortalPage() {
  const token = useParams().token as string
  return <PortalMotoboy apiBase={`/api/entregador/${token}`} swUrl="/sw-entregador.js" swScope="/entregador/" />
}
