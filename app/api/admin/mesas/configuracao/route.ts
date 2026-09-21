import { NextResponse } from 'next/server'
import { pode } from '@/lib/auth/permissoes'
import { contextoSalao } from '@/lib/auth/salao'
import { FORMAS_PAGAMENTO_OFERECIDAS, ehFormaOferecida } from '@/lib/conta'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Configuração da conta das mesas: taxa de serviço padrão, formas de pagamento aceitas e
 * as regras do salão por papel (garçom recebe? garçom transfere? caixa dá desconto?).
 *
 * Taxa e formas: quem gerencia mesas. Regras por papel: só o DONO — elas decidem o que o
 * gerente, o garçom e o caixa podem fazer com dinheiro, então não ficam com quem elas
 * mesmas regulam. Loja vem da sessão, nunca do corpo. A taxa padrão vale para contas
 * abertas DEPOIS da mudança — conta aberta mantém a taxa com que nasceu.
 */

export async function GET() {
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) return ctx.erro
  const { data } = await ctx.admin
    .from('restaurantes')
    .select('taxa_servico_padrao, formas_pagamento_mesa')
    .eq('id', ctx.sessao.restauranteId)
    .maybeSingle()
  return NextResponse.json({
    taxaServicoPadrao: Number(data?.taxa_servico_padrao ?? 0),
    // Loja que já tinha `fiado` gravado não o vê mais na lista: filtrar aqui evita
    // a caixinha marcada e invisível voltar para o banco no próximo salvar.
    formasPagamento: ((data?.formas_pagamento_mesa as string[] | null) ?? ['dinheiro', 'pix', 'credito', 'debito']).filter(
      ehFormaOferecida,
    ),
    formasDisponiveis: FORMAS_PAGAMENTO_OFERECIDAS,
    regras: ctx.regras,
    podeEditarRegras: pode(ctx.sessao.papel, 'ajustes.editar'),
  })
}

export async function PUT(request: Request) {
  const ctx = await contextoSalao('mesas.gerenciar')
  if ('erro' in ctx) return ctx.erro

  let corpo: { taxaServicoPadrao?: unknown; formasPagamento?: unknown; regras?: unknown }
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
  if (formas.length === 0 || !formas.every(ehFormaOferecida)) {
    return NextResponse.json({ error: 'Escolha pelo menos uma forma de pagamento válida.' }, { status: 400 })
  }
  // Ordem estável (a da lista oficial), para os botões não trocarem de lugar.
  const ordenadas = FORMAS_PAGAMENTO_OFERECIDAS.filter((f) => formas.includes(f))

  const patch: Record<string, unknown> = {
    taxa_servico_padrao: Math.round(taxa * 100) / 100,
    formas_pagamento_mesa: ordenadas,
  }

  // Regras: allowlist de três booleanos. Qualquer outra chave do corpo é ignorada.
  let regrasNovas = ctx.regras
  if (corpo.regras !== undefined) {
    if (!pode(ctx.sessao.papel, 'ajustes.editar')) {
      return NextResponse.json({ error: 'Só o dono altera as regras do salão.' }, { status: 403 })
    }
    const r = corpo.regras as Record<string, unknown>
    if (!r || typeof r !== 'object') return NextResponse.json({ error: 'Regras inválidas.' }, { status: 400 })
    const bool = (v: unknown, atual: boolean) => (typeof v === 'boolean' ? v : atual)
    regrasNovas = {
      garcomRecebe: bool(r.garcomRecebe, ctx.regras.garcomRecebe),
      garcomTransfere: bool(r.garcomTransfere, ctx.regras.garcomTransfere),
      caixaDesconto: bool(r.caixaDesconto, ctx.regras.caixaDesconto),
    }
    patch.salao_garcom_recebe = regrasNovas.garcomRecebe
    patch.salao_garcom_transfere = regrasNovas.garcomTransfere
    patch.salao_caixa_desconto = regrasNovas.caixaDesconto
  }

  const { data: antes } = await ctx.admin
    .from('restaurantes')
    .select('taxa_servico_padrao, formas_pagamento_mesa')
    .eq('id', ctx.sessao.restauranteId)
    .maybeSingle()

  const { error } = await ctx.admin.from('restaurantes').update(patch).eq('id', ctx.sessao.restauranteId)
  if (error) return NextResponse.json({ error: 'Não foi possível salvar.' }, { status: 500 })

  await registrarAuditoria(ctx.admin, {
    restauranteId: ctx.sessao.restauranteId,
    usuarioId: ctx.sessao.userId,
    usuarioNome: ctx.sessao.nome,
    acao: 'mesas.configurou_conta',
    entidade: 'restaurante',
    entidadeId: ctx.sessao.restauranteId,
    dados: {
      resumo: `taxa ${taxa}% · ${ordenadas.join(', ')}`,
      antes: {
        taxa: Number(antes?.taxa_servico_padrao ?? 0),
        formas: ((antes?.formas_pagamento_mesa as string[] | null) ?? []).join(', '),
        ...ctx.regras,
      },
      depois: { taxa, formas: ordenadas.join(', '), ...regrasNovas },
    },
  })
  return NextResponse.json({ ok: true, taxaServicoPadrao: taxa, formasPagamento: ordenadas, regras: regrasNovas })
}
