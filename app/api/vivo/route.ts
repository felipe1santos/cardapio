import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Healthcheck do Coolify (29/10/2026): "o app está de pé e respondendo". NÃO consulta o banco de propósito — com o
 * Supabase fora, um healthcheck que dependesse dele faria o Coolify reiniciar o app em ciclo sem resolver nada. Público,
 * sem dados. Quem vigia o banco é o vigia (lib/saude) e o monitor externo.
 */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
