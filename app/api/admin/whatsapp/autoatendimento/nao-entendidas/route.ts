import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { ASSUNTOS, type Assunto } from '@/lib/robo-auto/classificador'

/**
 * "Perguntas que o robô não entendeu" (30 dias) e "ensinar".
 *   GET                         → lista (mais recentes primeiro)
 *   POST { id, assunto }        → o texto vira palavra extra do assunto e a linha fica marcada como ensinada
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'integracoes.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }
  return { sessao, admin: getAdminSupabase() }
}

export async function GET() {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const desde = new Date(Date.now() - 30 * 24 * 3600_000).toISOString()
  const { data } = await ctx.admin
    .from('whatsapp_auto_nao_entendidas')
    .select('id, texto, exemplo, vezes, ultima_em, ensinado_assunto')
    .eq('restaurante_id', ctx.sessao.restauranteId)
    .gte('ultima_em', desde)
    .order('ultima_em', { ascending: false })
    .limit(200)
  return NextResponse.json({ itens: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request) {
  const ctx = await contexto()
  if ('erro' in ctx) return ctx.erro
  const { sessao, admin } = ctx
  const corpo = (await request.json().catch(() => null)) as { id?: unknown; assunto?: unknown } | null
  const assunto = corpo?.assunto as Assunto
  if (typeof corpo?.id !== 'string' || !(ASSUNTOS as unknown[]).includes(assunto)) return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  const { data: item } = await admin.from('whatsapp_auto_nao_entendidas').select('id, texto').eq('id', corpo.id).eq('restaurante_id', sessao.restauranteId).maybeSingle()
  if (!item) return NextResponse.json({ error: 'Pergunta não encontrada.' }, { status: 404 })
  const { data: cfg } = await admin.from('whatsapp_robo_config').select('auto_palavras').eq('restaurante_id', sessao.restauranteId).maybeSingle()
  const palavras = { ...((cfg?.auto_palavras as Record<string, string[]> | null) ?? {}) }
  const lista = new Set(palavras[assunto] ?? [])
  if (lista.size >= 100) return NextResponse.json({ error: 'Esse assunto já tem 100 palavras extras.' }, { status: 400 })
  lista.add(String(item.texto).slice(0, 60))
  palavras[assunto] = [...lista]
  const { error } = await admin.from('whatsapp_robo_config').update({ auto_palavras: palavras }).eq('restaurante_id', sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await admin.from('whatsapp_auto_nao_entendidas').update({ ensinado_assunto: assunto }).eq('id', item.id)
  return NextResponse.json({ ok: true })
}
