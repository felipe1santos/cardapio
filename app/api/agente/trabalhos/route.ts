import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { reservarTrabalhos } from '@/lib/impressao/servico'

/**
 * Fila de trabalhos (pré-conta e teste) deste computador. Só agente pareado; cada um
 * recebe apenas os trabalhos das SUAS impressoras, já reservados por 60 s
 * (FOR UPDATE SKIP LOCKED). Vencidos não voltam.
 */
export async function GET(request: Request) {
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem) return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 })
  if (quem.tipo !== 'agente') return NextResponse.json({ trabalhos: [] })
  const r = await reservarTrabalhos(admin, quem.agenteId)
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  return NextResponse.json({ trabalhos: r.valor }, { headers: { 'Cache-Control': 'no-store' } })
}
