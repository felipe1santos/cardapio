import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { gravarSim, lerSim } from '@/lib/pagamentos/mercadopago'
import { redirecionar } from '@/lib/pagamentos/permissao'

export const dynamic = 'force-dynamic'

/**
 * SÓ com MP_PROVEDOR=simulado (testes locais): faz o papel da tela de autorização do MP — gera um código
 * para uma conta vendedora de teste e volta para o retorno, como o MP faria. Em produção: 404.
 */
export async function GET(request: Request) {
  if (process.env.MP_PROVEDOR !== 'simulado') return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  const url = new URL(request.url)
  const state = url.searchParams.get('state') ?? ''
  const codigo = `SIM-CODE-${randomUUID()}`
  const e = lerSim()
  e.codigos[codigo] = { userId: url.searchParams.get('vendedor') ?? process.env.MP_SIMULADO_VENDEDOR ?? '9001' }
  gravarSim(e)
  return redirecionar(`/api/integracoes/mercadopago/retorno?code=${codigo}&state=${encodeURIComponent(state)}`)
}
