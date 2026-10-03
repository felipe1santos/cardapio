import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getCurrentSession } from '@/lib/auth/session'

/**
 * Falha do som de pedido novo no Painel de Pedidos (2026-10-03): vai para o log do servidor
 * (Coolify) com o motivo, a loja e o estado da aba. O painel manda no máximo 1 por motivo a
 * cada 5 min. Nada é gravado no banco.
 */
const MOTIVOS = new Set(['autoplay_bloqueado', 'arquivo_indisponivel', 'sem_web_audio', 'erro_reproducao', 'contexto_suspenso'])

export async function POST(request: Request) {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return new NextResponse(null, { status: 204 })
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const motivo = typeof corpo?.motivo === 'string' && MOTIVOS.has(corpo.motivo) ? corpo.motivo : null
  if (!motivo) return new NextResponse(null, { status: 204 })
  const txt = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, n) : '')
  console.warn('[som-pedido] falha', JSON.stringify({
    loja: sessao.restauranteId, usuario: sessao.nome, motivo, detalhe: txt(corpo?.detalhe, 200), visivel: txt(corpo?.visivel, 12), navegador: txt(corpo?.navegador, 160),
  }))
  return new NextResponse(null, { status: 204 })
}
