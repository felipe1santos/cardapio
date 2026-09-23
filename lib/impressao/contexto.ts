import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession, type AppSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import type { Operador } from './servico'

/**
 * Porta das rotas de configuração da impressão: sessão e `impressao.configurar` (dono e
 * gerente), conferidos de novo aqui além do middleware. A loja vem SEMPRE da sessão.
 */
export async function contextoImpressao(): Promise<{ sessao: AppSession; admin: SupabaseClient; op: Operador } | { erro: NextResponse }> {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'impressao.configurar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  return { sessao, admin, op: { restauranteId: sessao.restauranteId, userId: sessao.userId, nome: sessao.nome } }
}

export const semCache = { 'Cache-Control': 'no-store' }
