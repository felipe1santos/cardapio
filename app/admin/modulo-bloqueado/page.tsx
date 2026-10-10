'use client'

import { Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { JanelaModuloBloqueado } from '@/components/admin/janela-modulo-bloqueado'
import { MODULOS, type Modulo } from '@/lib/modulos'
import { useEstadoSessao } from '@/lib/sessao-cliente'

/** Quem abre a URL de um módulo pago bloqueado (0176) cai aqui pelo middleware: a mesma janela do cadeado do menu. */
function Conteudo() {
  const router = useRouter()
  const m = useSearchParams().get('m')
  const estado = useEstadoSessao()
  const modulo = (MODULOS as readonly string[]).includes(m ?? '') ? (m as Modulo) : 'financeiro'
  return <JanelaModuloBloqueado modulo={modulo} loja={estado?.lojaNome ?? ''} whatsapp={estado?.whatsappComercial} onFechar={() => router.push('/admin')} />
}

export default function ModuloBloqueadoPage() {
  return <Suspense fallback={null}><Conteudo /></Suspense>
}
