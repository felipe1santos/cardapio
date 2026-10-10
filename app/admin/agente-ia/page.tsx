'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AgenteIa } from '@/components/admin/agente-ia'
import { useEstadoSessao } from '@/lib/sessao-cliente'

/**
 * Agente de IA — módulo pago (0176; o middleware manda quem não tem o módulo para o cadeado). Com "Novidades em teste"
 * (0178) ele mora em Ajustes › Agente de IA e este endereço leva para lá; sem a chave, a página de sempre.
 */
export default function AgenteIaPage() {
  const router = useRouter()
  const estado = useEstadoSessao()
  const novidades = estado?.novidades === true
  useEffect(() => { if (novidades) router.replace('/admin/ajustes?aba=agente') }, [novidades, router])
  if (novidades) return null
  return <div className="mx-auto max-w-[560px] p-6"><AgenteIa /></div>
}
