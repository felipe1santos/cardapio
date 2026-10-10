import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { buscarEstacaoPorToken } from '@/lib/queries/estacoes'
import { buscarEntregadorPorToken } from '@/lib/queries/pedidos'
import { criarLimitador } from '@/lib/limite-taxa'
import { ipDoRequest } from '@/lib/impressao/atualizacao-bloqueio'

/**
 * Acesso às rotas do mapa (/api/mapa/*, 10/10): sessão do painel OU token da cozinha (estação) / do motoboy
 * (link antigo). Sem loja identificada não há chamada paga. Limite por IP e por loja (em memória: 1 contêiner).
 */
const porIp = criarLimitador({ max: 120, janelaMs: 60_000 })
const porLoja = criarLimitador({ max: 300, janelaMs: 60_000 })

export async function acessoDoMapa(request: Request, token: unknown, { soPainel = false } = {}):
  Promise<{ admin: SupabaseClient; loja: string } | { erro: NextResponse }> {
  const ip = ipDoRequest(request.headers) ?? 'sem-ip'
  if (porIp.excedeu(ip)) return { erro: NextResponse.json({ error: 'Muitas consultas ao mapa. Aguarde um minuto.' }, { status: 429 }) }
  porIp.registrar(ip)
  const admin = getAdminSupabase()
  let loja: string | null = null
  const sessao = await getCurrentSession(await getServerSupabase()).catch(() => null)
  if (sessao) loja = sessao.restauranteId
  else if (!soPainel && typeof token === 'string' && token.length >= 16 && token.length <= 100) {
    const est = await buscarEstacaoPorToken(admin, token).catch(() => null)
    if (est) loja = est.restauranteId
    else {
      const ent = await buscarEntregadorPorToken(admin, token).catch(() => null)
      if (ent) loja = ent.restauranteId
    }
  }
  if (!loja) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (porLoja.excedeu(loja)) return { erro: NextResponse.json({ error: 'Muitas consultas ao mapa. Aguarde um minuto.' }, { status: 429 }) }
  porLoja.registrar(loja)
  return { admin, loja }
}
