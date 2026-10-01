import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'
import { configEfetiva, ETAPAS, INFO_ETAPA, normalizarConfig, PADRAO, problemaNoTexto, VARIAVEIS } from '@/lib/mensagens-automaticas'

/**
 * Mensagens automáticas de status do pedido (0129). Ler e gravar a configuração da loja.
 * A loja vem da sessão; o corpo só traz a configuração. Só o servidor grava a coluna.
 */
async function autorizar() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'campanhas.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) } as const
  return { sessao } as const
}

export async function GET() {
  const r = await autorizar()
  if ('erro' in r) return r.erro
  const { data, error } = await getAdminSupabase().from('restaurantes').select('mensagens_status, evolution_instance').eq('id', r.sessao.restauranteId).maybeSingle()
  if (error) return NextResponse.json({ error: 'Não foi possível carregar.' }, { status: 500 })
  const linha = data as { mensagens_status?: unknown; evolution_instance?: string | null } | null
  return NextResponse.json({
    config: configEfetiva(normalizarConfig(linha?.mensagens_status)),
    padrao: PADRAO,
    etapas: ETAPAS.map((k) => ({ chave: k, ...INFO_ETAPA[k] })),
    variaveis: VARIAVEIS,
    whatsappConectado: !!linha?.evolution_instance,
  })
}

export async function PUT(request: Request) {
  const r = await autorizar()
  if ('erro' in r) return r.erro
  const corpo = await request.json().catch(() => null)
  const cfg = normalizarConfig(corpo?.config)
  if (!cfg) return NextResponse.json({ error: 'Configuração inválida.' }, { status: 400 })
  for (const [etapa, e] of Object.entries(cfg.etapas ?? {})) {
    if (e?.texto) {
      const p = problemaNoTexto(e.texto)
      if (p) return NextResponse.json({ error: `${INFO_ETAPA[etapa as keyof typeof INFO_ETAPA].titulo}: ${p}` }, { status: 400 })
    }
  }
  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const { error } = await admin.from('restaurantes').update({ mensagens_status: cfg }).eq('id', r.sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })
  await registrarAuditoria(admin, {
    restauranteId: r.sessao.restauranteId, usuarioId: r.sessao.userId, usuarioNome: r.sessao.nome,
    acao: 'campanhas.mensagens_automaticas', entidade: 'restaurante', entidadeId: r.sessao.restauranteId,
    dados: {
      ativo: cfg.ativo !== false,
      desligadas: ETAPAS.filter((k) => cfg.etapas?.[k]?.ativo === false).join(', '),
      personalizadas: ETAPAS.filter((k) => !!cfg.etapas?.[k]?.texto).join(', '),
    },
  })
  return NextResponse.json({ ok: true, config: configEfetiva(cfg) })
}
