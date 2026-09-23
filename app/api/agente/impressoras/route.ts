import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { descobrir } from '@/lib/impressao/servico'

/**
 * Descoberta: o Assistente pareado manda os nomes das impressoras instaladas no Windows.
 * Ficam ligadas a ESTE computador. As que sumiram viram indisponíveis — nenhuma é trocada
 * por outra automaticamente.
 */
export async function POST(request: Request) {
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem) return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 })
  if (quem.tipo !== 'agente') return NextResponse.json({ error: 'Pareie este computador com um código para usar várias impressoras.' }, { status: 403 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await descobrir(admin, quem.agenteId, corpo?.impressoras)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true, total: r.valor })
}
