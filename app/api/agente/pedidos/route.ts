import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigImpressao, buscarNomeRestaurante, listarImpressoras, listarPedidosParaImprimir, resolverRestauranteIdPorToken } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'

/**
 * Endpoint consultado periodicamente pelo Assistente de Impressão (agente
 * desktop, sem login de usuário). Autentica pelo token de pareamento gerado
 * em Ajustes > Impressão, e devolve os pedidos novos prontos pra imprimir.
 */
export async function GET(request: Request) {
  const token = lerAgenteToken(request)
  if (!token) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })

  const admin = getAdminSupabase()
  const restauranteId = await resolverRestauranteIdPorToken(admin, token)
  if (!restauranteId) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  const [config, impressoras, pedidos, lojaNome] = await Promise.all([
    buscarConfigImpressao(admin, restauranteId),
    listarImpressoras(admin, restauranteId),
    listarPedidosParaImprimir(admin, restauranteId),
    buscarNomeRestaurante(admin, restauranteId),
  ])

  return NextResponse.json({ config, impressoras, pedidos, loja: { nome: lojaNome } })
}
