import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigImpressao, buscarLojaImpressao, listarImpressoras, listarPedidosParaImprimir, registrarHeartbeatAgente, resolverRestauranteIdPorToken } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'

/**
 * Endpoint consultado periodicamente pelo Assistente de Impressão (agente
 * desktop, sem login de usuário). Autentica pelo token de pareamento gerado
 * em Ajustes > Impressão, e devolve os pedidos novos prontos pra imprimir —
 * já RESERVADOS para este Assistente (0086): outro Assistente da mesma loja não
 * recebe o mesmo pedido enquanto a reserva vale.
 */
export async function GET(request: Request) {
  const token = lerAgenteToken(request)
  if (!token) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })

  const admin = getAdminSupabase()
  const restauranteId = await resolverRestauranteIdPorToken(admin, token)
  if (!restauranteId) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  // Heartbeat: o agente manda a impressora que está usando; o painel acende ela como
  // "conectada". Best-effort — não derruba a resposta dos pedidos se falhar.
  registrarHeartbeatAgente(admin, restauranteId, request.headers.get('x-impressora-id')).catch(() => {})

  // Identificador da instância (Assistente 0.1.24+). Só letras, números e hífen.
  const bruto = request.headers.get('x-agente-instancia') ?? ''
  const instancia = /^[A-Za-z0-9-]{8,64}$/.test(bruto) ? bruto : null

  const [config, impressoras, loja] = await Promise.all([
    buscarConfigImpressao(admin, restauranteId),
    listarImpressoras(admin, restauranteId),
    buscarLojaImpressao(admin, restauranteId),
  ])
  // Impressão automática desligada: o Assistente não imprime nada, então nada é
  // reservado — senão a fila ficaria presa em reservas de quem não vai imprimir.
  const pedidos = config?.impressaoAutomatica ? await listarPedidosParaImprimir(admin, restauranteId, instancia) : []

  return NextResponse.json({ config, impressoras, pedidos, loja })
}
