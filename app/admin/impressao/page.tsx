'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PainelImpressao } from '@/components/impressao/painel-impressao'
import { useEstadoSessao } from '@/lib/sessao-cliente'

/**
 * Impressão. Com "Novidades em teste" (0178, hoje só a Menuzia) ela mora em Ajustes (/admin/ajustes/impressao) e este
 * endereço leva para lá; sem a chave, é a página de sempre.
 */
export default function ImpressaoPage() {
  const router = useRouter()
  const estado = useEstadoSessao()
  const novidades = estado?.novidades === true
  useEffect(() => {
    if (novidades) router.replace(`/admin/ajustes/impressao${window.location.search}`)
  }, [novidades, router])
  if (novidades) return null
  return <PainelImpressao />
}
