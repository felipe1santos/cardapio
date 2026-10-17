'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Impressão mora em Ajustes (/admin/ajustes/impressao) em todas as lojas desde 16/10/2026; este endereço antigo
 * (links e favoritos) leva para lá, com os mesmos parâmetros.
 */
export default function ImpressaoPage() {
  const router = useRouter()
  useEffect(() => { router.replace(`/admin/ajustes/impressao${window.location.search}`) }, [router])
  return null
}
