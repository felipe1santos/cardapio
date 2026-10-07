import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { identificarAgente } from '@/lib/impressao/credenciais'
import { registrarCaminho } from '@/lib/impressao/servico'

/**
 * Caminho que a impressão usou (0157, Assistente 0.2.0-beta.10+): POST { nomeSistema, caminho,
 * obs? }. No envio automático, diz se saiu direto (ESC/POS pela fila ou pela rede) ou caiu no
 * driver do Windows. Versões anteriores não chamam esta rota.
 */
export async function POST(request: Request) {
  const admin = getAdminSupabase()
  const quem = await identificarAgente(admin, request)
  if (!quem || quem.tipo !== 'agente') return NextResponse.json({ error: 'Credencial inválida' }, { status: 401 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const r = await registrarCaminho(admin, quem.agenteId, corpo?.nomeSistema, corpo?.caminho, corpo?.obs)
  if (!r.ok) return NextResponse.json({ error: r.erro, codigo: r.codigo }, { status: r.status })
  return NextResponse.json({ ok: true })
}
