import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Faixa vermelha do WhatsApp no topo do painel: REMOVIDA em 28/10/2026 (regra do dono — WhatsApp é opcional, o lojista não
 * é cobrado; o estado aparece só em Integrações). Esta rota fica respondendo "nada caiu" sem tocar no banco nem na
 * Evolution para as abas antigas que ainda chamam a cada minuto até recarregar (antes: ~5 requisições por aba por minuto).
 */
export async function GET() {
  return NextResponse.json({ caiu: false, desde: null, estado: null }, { headers: { 'Cache-Control': 'no-store' } })
}
