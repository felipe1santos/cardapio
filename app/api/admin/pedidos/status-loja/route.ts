import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

const STATUS = ['automatico', 'aberto_manual', 'fechado_manual'] as const
const ORIGENS = ['kanban', 'ajustes', 'painel', 'app'] as const

/**
 * Abre/fecha a loja (ou devolve ao automático) pela sessão de quem clicou — a mesma RLS de antes,
 * que valia no navegador. Passa pelo servidor só para dizer ao banco DE ONDE veio (cabeçalho
 * x-menuzia-origem, lido pelo trigger de auditoria da 0156): do navegador, um cabeçalho próprio
 * esbarraria no CORS do Supabase e o Referer chega sem o caminho.
 */
export async function POST(request: Request) {
  const supabase = await getServerSupabase()
  const sessao = await getCurrentSession(supabase)
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  const corpo = (await request.json().catch(() => null)) as { status?: unknown; origem?: unknown } | null
  const status = STATUS.find((s) => s === corpo?.status)
  if (!status) return NextResponse.json({ error: 'Status inválido' }, { status: 400 })
  const origem = ORIGENS.find((o) => o === corpo?.origem) ?? 'painel'
  const { data, error } = await supabase.from('restaurantes').update({ status_loja: status })
    .eq('id', sessao.restauranteId).select('id').setHeader('x-menuzia-origem', origem)
  if (error) return NextResponse.json({ error: 'Não foi possível mudar o status da loja.' }, { status: 500 })
  if (!data?.length) return NextResponse.json({ error: 'Sem permissão para abrir/fechar a loja.' }, { status: 403 })
  return NextResponse.json({ ok: true, status })
}
