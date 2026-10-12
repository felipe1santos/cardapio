import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { gastoIaHojeDaLoja, limitesIa } from '@/lib/custo/ia'

/**
 * Agente de IA (Claude, 0183) — Ajustes › Agente de IA. Módulo pago: o middleware já barra quem não tem o módulo
 * (lib/modulos.ts, '/api/admin/agente-ia'). Dono (integracoes.gerenciar). A loja vem só da sessão.
 *   GET → interruptor, robô ligado?, IA disponível no servidor?, gasto de hoje e teto
 *   PUT { ativo: boolean }
 */
const semCache = { 'Cache-Control': 'no-store' }

async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const loja = ctx.sessao.restauranteId
  const [{ data: cfg }, gasto] = await Promise.all([
    ctx.admin.from('whatsapp_robo_config').select('ia_ativo, ia_teto_usd_dia, autoatendimento_ativo').eq('restaurante_id', loja).maybeSingle(),
    gastoIaHojeDaLoja(ctx.admin, loja),
  ])
  const c = (cfg ?? {}) as { ia_ativo?: boolean; ia_teto_usd_dia?: number | string | null; autoatendimento_ativo?: boolean }
  const lim = limitesIa()
  const teto = c.ia_teto_usd_dia === null || c.ia_teto_usd_dia === undefined ? lim.usdDiaLoja : Number(c.ia_teto_usd_dia)
  return NextResponse.json({
    ativo: c.ia_ativo === true,
    roboAtivo: c.autoatendimento_ativo === true,
    disponivel: Boolean(process.env.ANTHROPIC_API_KEY),
    gastoHojeMicroUsd: gasto,
    tetoUsd: teto,
    cotacao: lim.cotacao,
  }, { headers: semCache })
}

export async function PUT(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { ativo?: unknown } | null
  if (typeof corpo?.ativo !== 'boolean') return NextResponse.json({ error: 'Valor inválido.' }, { status: 400 })
  const { sessao, admin } = ctx
  const { error } = await admin.from('whatsapp_robo_config').upsert(
    { restaurante_id: sessao.restauranteId, ia_ativo: corpo.ativo, atualizado_em: new Date().toISOString(), atualizado_por: sessao.userId, atualizado_por_nome: (sessao.nome ?? '').slice(0, 120) || null },
    { onConflict: 'restaurante_id' },
  )
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId, usuarioId: sessao.userId, usuarioNome: sessao.nome,
    acao: corpo.ativo ? 'agente_ia.ligado' : 'agente_ia.desligado', entidade: 'restaurante', entidadeId: sessao.restauranteId, dados: {},
  })
  return NextResponse.json({ ok: true }, { headers: semCache })
}
