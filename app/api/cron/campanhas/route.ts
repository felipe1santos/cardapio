import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { provedorAtual } from '@/lib/mensageria/provedor'
import { processarCampanhas } from '@/lib/mensageria/campanhas-envio'

// Cron chamado pelo Coolify (ou qualquer scheduler) — protegido por CRON_SECRET.
// Configuração no Coolify: POST /api/cron/campanhas a cada 60 segundos
// com header "x-cron-secret: <CRON_SECRET>".
//
// Cada invocação processa até BATCH_SIZE mensagens com intervalos aleatórios entre elas.
// A fila (reserva, novas tentativas, expiração em 24h) mora na 0104.

const BATCH_SIZE = 5
const DELAY_MIN_MS = 4_000
const DELAY_MAX_MS = 12_000

function randomDelay() {
  // Só a suíte local (provedor simulado) encurta o intervalo.
  if (process.env.WHATSAPP_PROVEDOR === 'simulado' && process.env.CAMPANHA_INTERVALO_MS) return Number(process.env.CAMPANHA_INTERVALO_MS)
  return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS) + DELAY_MIN_MS)
}

export async function POST(request: Request) {
  try {
    // Fail-closed: sem CRON_SECRET configurado OU header errado → recusa. Evita que o
    // endpoint fique aberto (disparo de WhatsApp em massa) se a variável não estiver setada.
    const secret = process.env.CRON_SECRET
    const header = request.headers.get('x-cron-secret')
    if (!secret || header !== secret) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const resumo = await processarCampanhas(getAdminSupabase(), provedorAtual(), { limite: BATCH_SIZE, intervalo: randomDelay })
    return NextResponse.json(resumo)
  } catch (err) {
    console.error('[cron/campanhas] erro:', (err as Error).message?.slice(0, 200))
    return NextResponse.json({ error: 'Erro interno' }, { status: 500 })
  }
}
