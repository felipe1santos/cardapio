import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigImpressao, buscarLojaImpressao, listarImpressoras, resolverRestauranteIdPorToken } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'

/**
 * Diagnóstico do Assistente de Impressão: "Testar pareamento", "Buscar impressoras" e
 * "Testar impressora" (0.1.25+). Só LÊ configuração da loja — não devolve pedidos, não
 * reserva, não marca impresso, não registra heartbeat. Consumir a fila é só em
 * GET /api/agente/pedidos.
 */
export async function GET(request: Request) {
  const token = lerAgenteToken(request)
  if (!token) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })

  const admin = getAdminSupabase()
  const restauranteId = await resolverRestauranteIdPorToken(admin, token)
  if (!restauranteId) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  const [config, impressoras, loja] = await Promise.all([
    buscarConfigImpressao(admin, restauranteId),
    listarImpressoras(admin, restauranteId),
    buscarLojaImpressao(admin, restauranteId),
  ])
  return NextResponse.json({ ok: true, config, impressoras, loja }, { headers: { 'Cache-Control': 'no-store' } })
}
