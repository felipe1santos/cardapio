import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { buscarConfig } from '@/lib/entregas/queries'
import { erroEntrega, testarConexao } from '@/lib/entregas/lalamove-servidor'

/** "Testar conexão" (dono): GET /v3/cities com as chaves da loja, guarda cidade/serviço e registra o webhook. Não cria corrida. */
export async function POST() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return NextResponse.json({ error: 'Só o dono configura as integrações.' }, { status: 403 })
  const admin = getAdminSupabase()
  try {
    const cfg = await buscarConfig(admin, sessao.restauranteId)
    if (!cfg?.chaves) return NextResponse.json({ error: 'Cole a API key e o secret antes de testar.' }, { status: 400 })
    const r = await testarConexao(admin, cfg, sessao.nome)
    return NextResponse.json({ ok: true, ambiente: cfg.ambiente, cidades: r.cidades.map((c) => c.nome), cidadeLoja: r.cidadeLoja, cidadeEscolhida: r.cidadeEscolhida?.nome ?? null, webhookOk: r.webhookOk, aviso: r.aviso })
  } catch (e) {
    const { mensagem, status } = erroEntrega(e)
    return NextResponse.json({ error: mensagem }, { status })
  }
}
