import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'

/**
 * Central de atendimento do WhatsApp: dono e gerente (`whatsapp.atender`), conferido
 * aqui além do middleware. A loja vem SEMPRE da sessão — nunca do corpo nem da URL.
 */
export async function contextoAtendimento() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'whatsapp.atender')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase(), loja: sessao.restauranteId }
}

export const semCache = { 'Cache-Control': 'no-store' }
export const ehId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)
