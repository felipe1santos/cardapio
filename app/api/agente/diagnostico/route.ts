import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarConfigImpressao, buscarLojaImpressao, listarImpressoras } from '@/lib/queries/impressao'
import { lerAgenteToken } from '@/lib/agente-token'
import { identificarAgente } from '@/lib/impressao/credenciais'

/**
 * Diagnóstico do Assistente de Impressão: "Testar pareamento", "Buscar impressoras" e
 * "Testar impressora" (0.1.25+). Só LÊ configuração da loja — não devolve pedidos, não
 * reserva, não marca impresso. Consumir a fila é só em GET /api/agente/pedidos.
 */
export async function GET(request: Request) {
  if (!lerAgenteToken(request)) return NextResponse.json({ error: 'Token ausente' }, { status: 400 })
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  const [config, impressoras, loja] = await Promise.all([
    buscarConfigImpressao(admin, quem.restauranteId),
    listarImpressoras(admin, quem.restauranteId),
    buscarLojaImpressao(admin, quem.restauranteId),
  ])
  return NextResponse.json(
    { ok: true, config, impressoras, loja, agente: quem.tipo === 'agente' ? { id: quem.agenteId, nome: quem.nome } : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
