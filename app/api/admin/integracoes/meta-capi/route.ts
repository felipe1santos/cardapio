import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Token da API de Conversões do Meta (0138). Só o dono. O token fica em `integracoes_segredos`
 * (só o servidor lê) e NUNCA volta para a tela: o GET diz só se está configurado e os 4 últimos
 * caracteres.
 *   GET                                   → { configurado, final, codigoTeste }
 *   POST { token?: string|null, codigoTeste?: string|null }   (null remove)
 */
async function sessaoDono() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Só o dono configura as integrações.' }, { status: 403 }) } as const
  return { sessao, admin: getAdminSupabase() } as const
}

export async function GET() {
  const c = await sessaoDono()
  if ('erro' in c) return c.erro
  const { data } = await c.admin.from('integracoes_segredos').select('meta_capi_token, meta_test_event_code').eq('restaurante_id', c.sessao.restauranteId).maybeSingle()
  const token = (data?.meta_capi_token as string | null) ?? null
  return NextResponse.json({ configurado: !!token, final: token ? token.slice(-4) : null, codigoTeste: (data?.meta_test_event_code as string | null) ?? null },
    { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const c = await sessaoDono()
  if ('erro' in c) return c.erro
  const corpo = (await request.json().catch(() => null)) as { token?: unknown; codigoTeste?: unknown } | null
  if (!corpo) return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  const mudar: Record<string, string | null> = {}
  if ('token' in corpo) {
    const t = typeof corpo.token === 'string' ? corpo.token.trim() : null
    if (t !== null && !/^[A-Za-z0-9_-]{20,500}$/.test(t)) return NextResponse.json({ error: 'Token inválido: copie o token de acesso gerado no Gerenciador de Eventos.' }, { status: 400 })
    mudar.meta_capi_token = t || null
  }
  if ('codigoTeste' in corpo) {
    const t = typeof corpo.codigoTeste === 'string' ? corpo.codigoTeste.trim() : null
    if (t && !/^[A-Za-z0-9]{3,20}$/.test(t)) return NextResponse.json({ error: 'Código de teste inválido (ex.: TEST12345).' }, { status: 400 })
    mudar.meta_test_event_code = t || null
  }
  if (!Object.keys(mudar).length) return NextResponse.json({ error: 'Nada para salvar.' }, { status: 400 })
  const { error } = await c.admin.from('integracoes_segredos').upsert({ restaurante_id: c.sessao.restauranteId, ...mudar, atualizado_em: new Date().toISOString(), atualizado_por_nome: c.sessao.nome })
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await registrarAuditoria(c.admin, {
    restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'integracoes.meta_capi', entidade: 'restaurante',
    entidadeId: c.sessao.restauranteId,
    dados: { token: 'meta_capi_token' in mudar ? (mudar.meta_capi_token ? 'definido' : 'removido') : 'sem mudança', codigo_teste: 'meta_test_event_code' in mudar ? (mudar.meta_test_event_code ? 'definido' : 'removido') : 'sem mudança' },
  }).catch(() => {})
  return NextResponse.json({ ok: true })
}
