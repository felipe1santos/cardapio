import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { FORMAS_PAGAMENTO, ehForma } from '@/lib/conta'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Configuração da conta das mesas: taxa de serviço padrão e formas de pagamento aceitas.
 *
 * Só quem gerencia mesas altera. Loja vem da sessão, nunca do corpo. A taxa padrão vale
 * para contas abertas DEPOIS da mudança — conta aberta mantém a taxa com que nasceu, e
 * quem ajusta essa é o gerente, na própria conta.
 */

async function sessaoGestora() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) } as const
  if (!pode(sessao.papel, 'mesas.gerenciar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) } as const
  return { sessao } as const
}

export async function GET() {
  const ctx = await sessaoGestora()
  if ('erro' in ctx) return ctx.erro
  const { data } = await getAdminSupabase()
    .from('restaurantes')
    .select('taxa_servico_padrao, formas_pagamento_mesa')
    .eq('id', ctx.sessao.restauranteId)
    .maybeSingle()
  return NextResponse.json({
    taxaServicoPadrao: Number(data?.taxa_servico_padrao ?? 0),
    formasPagamento: (data?.formas_pagamento_mesa as string[] | null) ?? ['dinheiro', 'pix', 'credito', 'debito'],
    formasDisponiveis: FORMAS_PAGAMENTO,
  })
}

export async function PUT(request: Request) {
  const ctx = await sessaoGestora()
  if ('erro' in ctx) return ctx.erro

  let corpo: { taxaServicoPadrao?: unknown; formasPagamento?: unknown }
  try {
    corpo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const taxa = Number(corpo.taxaServicoPadrao)
  if (!Number.isFinite(taxa) || taxa < 0 || taxa > 30) {
    return NextResponse.json({ error: 'Taxa de serviço entre 0% e 30%.' }, { status: 400 })
  }
  const formas = Array.isArray(corpo.formasPagamento) ? [...new Set(corpo.formasPagamento)] : []
  if (formas.length === 0 || !formas.every(ehForma)) {
    return NextResponse.json({ error: 'Escolha pelo menos uma forma de pagamento válida.' }, { status: 400 })
  }
  // Ordem estável (a da lista oficial), para os botões não trocarem de lugar.
  const ordenadas = FORMAS_PAGAMENTO.filter((f) => formas.includes(f))

  const admin = getAdminSupabase()
  const { error } = await admin
    .from('restaurantes')
    .update({ taxa_servico_padrao: Math.round(taxa * 100) / 100, formas_pagamento_mesa: ordenadas })
    .eq('id', ctx.sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })

  await registrarAuditoria(admin, {
    restauranteId: ctx.sessao.restauranteId,
    usuarioId: ctx.sessao.userId,
    usuarioNome: ctx.sessao.nome,
    acao: 'mesas.configurou_conta',
    entidade: 'restaurante',
    entidadeId: ctx.sessao.restauranteId,
    dados: { resumo: `taxa ${taxa}% · ${ordenadas.join(', ')}` },
  })
  return NextResponse.json({ ok: true, taxaServicoPadrao: taxa, formasPagamento: ordenadas })
}
