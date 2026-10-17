'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Agente de IA — módulo pago (0176; o middleware manda quem não tem o módulo para o cadeado). Mora em
 * Ajustes › Agente de IA em todas as lojas desde 16/10/2026; este endereço antigo leva para lá.
 */
export default function AgenteIaPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/ajustes?aba=agente') }, [router])
  return null
}
