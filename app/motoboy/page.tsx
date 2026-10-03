'use client'

import { PortalMotoboy } from '@/components/motoboy/portal'

/** App do motoboy com login (0136): a sessão diz quem ele é (ligado a um entregador ativo da loja). */
export default function MotoboyPage() {
  return <PortalMotoboy apiBase="/api/motoboy" swUrl="/sw-motoboy.js" swScope="/motoboy" />
}
