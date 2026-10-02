import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pingSessao } from '@/lib/financeiro/sessoes'
import { dispositivoDaRequisicao } from '@/lib/financeiro/contexto'

/** O painel avisa que continua aberto (a cada poucos minutos). Detecta login simultâneo. */
export async function POST() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const d = await dispositivoDaRequisicao()
  await pingSessao(getAdminSupabase(), { usuarioId: sessao.userId, usuarioNome: sessao.nome, restauranteId: sessao.restauranteId, ip: d.ip, dispositivo: d.dispositivo, terminal: d.terminal })
  return NextResponse.json({ ok: true })
}
