import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAuditoria } from '@/lib/auditoria'
import type { ContextoFin } from './contexto'
import { lancar, type Carteira } from './ledger'
import { aprovar } from './aprovacao'
import { criarAlerta } from './alertas'
import { podeFin } from './permissoes'
import { formatarCentavos } from './centavos'
import { naFilaDaGaveta } from './fila-gaveta'
import {
  avaliarContagem, faltaNaGaveta, linhasDaAbertura, linhasDoAjuste, linhasDoMovimento, permissaoDoMovimento, precisaAprovacao,
  ROTULO_MOVIMENTO, type Movimento,
} from './caixa-regras'
import { exigenciasDoFechamento, TEXTO_MOTIVO, type Motivo } from './fechamento-regras'
import { conferirAprovacaoRemota } from './aprovacao-remota'

/**
 * Caixa (Fase 2, 0133). Um caixa por loja (o turno de `caixa_turnos`), com fundo de troco,
 * movimentos manuais com aprovação acima do limite, fechamento com CONTAGEM CEGA e reabertura só
 * pelo dono. Quem fez, de qual aparelho e com aprovação de quem: sempre da sessão, nunca da tela.
 */
export type Falha = { ok: false; erro: string; status: number; codigo?: string; dados?: Record<string, unknown> }
const falha = (erro: string, status: number, codigo?: string, dados?: Record<string, unknown>): Falha => ({ ok: false, erro, status, codigo, dados })

export interface TurnoFin {
  id: string
  status: 'aberto' | 'fechado' | 'reaberto'
  aberto_em: string
  aberto_por: string | null
  aberto_por_nome: string | null
  fechado_em: string | null
  fechado_por_nome: string | null
  valor_inicial_centavos: number
  contado_dinheiro_centavos: number | null
  contado_cartao_centavos: number | null
  esperado_dinheiro_centavos: number | null
  esperado_cartao_centavos: number | null
  diferenca_centavos: number | null
  diferenca_cartao_centavos: number | null
  justificativa: string | null
  fechamento_aprovado_por_nome: string | null
  pendencias: unknown
  resumo: unknown
  reaberto_por_nome: string | null
  reaberto_em: string | null
  reaberto_motivo: string | null
}
const COLS_TURNO = 'id, status, aberto_em, aberto_por, aberto_por_nome, fechado_em, fechado_por_nome, valor_inicial_centavos, contado_dinheiro_centavos, contado_cartao_centavos, esperado_dinheiro_centavos, esperado_cartao_centavos, diferenca_centavos, diferenca_cartao_centavos, justificativa, fechamento_aprovado_por_nome, pendencias, resumo, reaberto_por_nome, reaberto_em, reaberto_motivo'

/** PIN do aprovador no terminal, OU uma aprovação pedida e dada pelo celular (remotaId). */
export interface Aprovacao { aprovadorId: string; pin: string; remotaId?: string | null }

/**
 * Confere a aprovação: remota (pedida pelo celular, usada uma vez) ou PIN no terminal. Mesmo retorno de aprovar().
 */
export async function conferirAprovacao(admin: SupabaseClient, p: { restauranteId: string; solicitante: { id: string; nome: string }; aprovacao: Aprovacao; acao: string; valorCentavos?: number | null; motivo?: string | null; contexto?: Record<string, unknown> }) {
  if (p.aprovacao.remotaId) return conferirAprovacaoRemota(admin, { restauranteId: p.restauranteId, solicitanteId: p.solicitante.id, acao: p.acao, valorCentavos: p.valorCentavos, remotaId: p.aprovacao.remotaId })
  return aprovar(admin, { restauranteId: p.restauranteId, solicitante: p.solicitante, aprovadorId: p.aprovacao.aprovadorId, pin: p.aprovacao.pin, acao: p.acao, valorCentavos: p.valorCentavos, motivo: p.motivo, contexto: p.contexto })
}

export async function turnoAberto(admin: SupabaseClient, restauranteId: string): Promise<TurnoFin | null> {
  const { data } = await admin.from('caixa_turnos').select(COLS_TURNO).eq('restaurante_id', restauranteId).is('fechado_em', null).maybeSingle()
  return (data as TurnoFin | null) ?? null
}

export async function configFin(admin: SupabaseClient, restauranteId: string) {
  const { data } = await admin.from('fin_config').select('limite_saida_centavos, limite_divergencia_centavos, horas_caixa_aberto, tolerancia_fechamento_centavos, limite_comandas_fechamento_centavos').eq('restaurante_id', restauranteId).maybeSingle()
  return {
    limiteSaida: Number(data?.limite_saida_centavos ?? 10000),
    limiteDivergencia: Number(data?.limite_divergencia_centavos ?? 500),
    horasCaixaAberto: Number(data?.horas_caixa_aberto ?? 14),
    // Regras de PIN no fechamento (Fase 6, provisórias).
    toleranciaFechamento: Number(data?.tolerancia_fechamento_centavos ?? 200),
    limiteComandasFechamento: Number(data?.limite_comandas_fechamento_centavos ?? 10000),
  }
}

/** Saldos do turno por carteira (centavos). */
export async function saldosDoTurno(admin: SupabaseClient, restauranteId: string, turnoId: string): Promise<Record<Carteira, number>> {
  const s: Record<Carteira, number> = { gaveta: 0, motoboy: 0, pix_conferir: 0, cartao: 0, empresa: 0, a_receber: 0, resultado: 0, online: 0 }
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from('fin_lancamentos').select('carteira, valor_centavos').eq('restaurante_id', restauranteId).eq('turno_id', turnoId).order('id').range(de, de + 999)
    if (error) throw error
    for (const r of data ?? []) s[r.carteira as Carteira] += Number(r.valor_centavos)
    if (!data || data.length < 1000) break
  }
  return s
}

export interface LinhaExtrato {
  id: number; grupo_id: string; criado_em: string; carteira: Carteira; tipo: string; valor_centavos: number; forma: string | null
  origem: string; motivo: string | null; usuario_nome: string; aprovado_por_nome: string | null; comanda_id: string | null; dispositivo: string | null
}

export async function extratoDoTurno(admin: SupabaseClient, restauranteId: string, turnoId: string, limite = 300): Promise<LinhaExtrato[]> {
  const { data, error } = await admin.from('fin_lancamentos')
    .select('id, grupo_id, criado_em, carteira, tipo, valor_centavos, forma, origem, motivo, usuario_nome, aprovado_por_nome, comanda_id, dispositivo')
    .eq('restaurante_id', restauranteId).eq('turno_id', turnoId).neq('carteira', 'empresa').neq('carteira', 'resultado')
    .order('id', { ascending: false }).limit(limite)
  if (error) throw error
  return (data ?? []) as LinhaExtrato[]
}

/** O que está pendente para fechar: motoboys sem acerto, contas abertas, Pix a conferir. */
export async function pendenciasDoFechamento(admin: SupabaseClient, restauranteId: string, turnoId: string) {
  const { data: t } = await admin.from('caixa_turnos').select('aberto_em').eq('id', turnoId).maybeSingle()
  const [motoboysFin, { data: pf }, saldos] = await Promise.all([
    import('./motoboy').then((m) => m.situacaoMotoboys(admin, restauranteId)),
    admin.rpc('fin_pendencias_fechamento', { p_restaurante: restauranteId, p_desde: (t?.aberto_em as string) ?? new Date(0).toISOString() }),
    saldosDoTurno(admin, restauranteId, turnoId),
  ])
  const p = (pf ?? {}) as { comandas_abertas?: number; comandas_abertas_centavos?: number; nao_pagos?: number; nao_pagos_centavos?: number }
  // Fase 3: o que cada motoboy tem para acertar é o saldo dele no livro-caixa (troco, recebimentos, pendências).
  const motoboys = motoboysFin.filter((m) => m.saldoCentavos !== 0).map((m) => ({
    entregadorId: m.entregadorId, nome: m.nome, pedidos: m.pedidos.length, emRota: 0,
    esperadoCentavos: m.saldoCentavos, trocoLevadoCentavos: m.trocoLevadoCentavos,
  }))
  return {
    motoboys,
    contasAbertas: Number(p.comandas_abertas ?? 0),
    contasAbertasCentavos: Number(p.comandas_abertas_centavos ?? 0),
    naoPagos: Number(p.nao_pagos ?? 0),
    naoPagosCentavos: Number(p.nao_pagos_centavos ?? 0),
    pixAConferirCentavos: saldos.pix_conferir,
    pixOnline: await pixOnlineDoTurno(admin, restauranteId, turnoId, (t?.aberto_em as string) ?? null),
  }
}

/**
 * Pix online (0148) no fechamento — só informativo (é dinheiro na conta do Mercado Pago, não na gaveta):
 * o que entrou com este turno aberto e o que entrou com o caixa FECHADO antes dele (adotado por este turno).
 */
export async function pixOnlineDoTurno(admin: SupabaseClient, restauranteId: string, turnoId: string, abertoEm: string | null) {
  const somar = (ls: { tipo: string; valor_centavos: number }[]) => ({
    qtd: ls.filter((l) => l.tipo === 'recebimento').length,
    brutoCentavos: ls.filter((l) => l.tipo === 'recebimento').reduce((s, l) => s + Number(l.valor_centavos), 0),
    taxaCentavos: -ls.filter((l) => l.tipo === 'taxa').reduce((s, l) => s + Number(l.valor_centavos), 0),
  })
  const { data: doTurno } = await admin.from('fin_lancamentos').select('tipo, valor_centavos').eq('restaurante_id', restauranteId).eq('turno_id', turnoId).eq('carteira', 'online')
  let adotado = { qtd: 0, brutoCentavos: 0, taxaCentavos: 0 }
  if (abertoEm) {
    const { data: antes } = await admin.from('caixa_turnos').select('fechado_em').eq('restaurante_id', restauranteId).lt('aberto_em', abertoEm).not('fechado_em', 'is', null).order('aberto_em', { ascending: false }).limit(1).maybeSingle()
    const desde = (antes?.fechado_em as string | undefined) ?? new Date(new Date(abertoEm).getTime() - 7 * 86_400_000).toISOString()
    const { data: fora } = await admin.from('fin_lancamentos').select('tipo, valor_centavos').eq('restaurante_id', restauranteId).is('turno_id', null).eq('carteira', 'online').gte('criado_em', desde).lt('criado_em', abertoEm)
    adotado = somar((fora ?? []) as { tipo: string; valor_centavos: number }[])
  }
  return { turno: somar((doTurno ?? []) as { tipo: string; valor_centavos: number }[]), caixaFechado: adotado }
}

async function auditar(ctx: ContextoFin, acao: string, entidadeId: string | null, dados: Record<string, unknown>) {
  await registrarAuditoria(ctx.admin, {
    restauranteId: ctx.sessao.restauranteId, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome,
    acao, entidade: 'caixa', entidadeId: entidadeId ?? undefined, dados: { ...dados, dispositivo: ctx.dispositivo },
  })
}

// ─── abrir ──────────────────────────────────────────────────────────────────
export async function abrirCaixa(ctx: ContextoFin, fundoCentavos: number): Promise<{ ok: true; turno: TurnoFin } | Falha> {
  if (!Number.isSafeInteger(fundoCentavos) || fundoCentavos < 0 || fundoCentavos > 10_000_000) return falha('Informe o fundo de troco.', 400)
  const loja = ctx.sessao.restauranteId
  const { data, error } = await ctx.admin.from('caixa_turnos').insert({
    restaurante_id: loja, aberto_por: ctx.sessao.userId, aberto_por_nome: ctx.sessao.nome,
    valor_inicial_centavos: fundoCentavos, dispositivo_abertura: ctx.dispositivo.slice(0, 200),
  }).select(COLS_TURNO).single()
  if (error) {
    if ((error as { code?: string }).code === '23505') return falha('O caixa já está aberto.', 409, 'ja_aberto')
    throw error
  }
  const turno = data as TurnoFin
  const linhas = linhasDaAbertura(fundoCentavos)
  if (linhas.length) {
    const r = await lancar(ctx.admin, { restauranteId: loja, turnoId: turno.id, chave: `abertura:${turno.id}`, origem: 'manual', usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, motivo: 'Fundo de troco', dispositivo: ctx.dispositivo, linhas })
    if (!r.ok) {
      await ctx.admin.from('caixa_turnos').delete().eq('id', turno.id)
      return falha(r.erro, 500)
    }
  }
  // Troca do modo de troco do motoboy marcada para o próximo caixa (0136).
  await import('./motoboy').then((m) => m.aplicarModoPendente(ctx.admin, loja)).catch(() => {})
  await auditar(ctx, 'caixa.abriu_turno', turno.id, { fundo_centavos: fundoCentavos })
  return { ok: true, turno }
}

// ─── movimentos ─────────────────────────────────────────────────────────────
type EntradaMovimento = { movimento: Movimento; valorCentavos: number; motivo: string; chave: string; aprovacao?: Aprovacao | null }
type ResultadoMovimento = { ok: true; repetido: boolean; aprovadoPor: string | null } | Falha

/** Saída da gaveta passa pela fila da loja (conferir + gravar em sequência); reforço (entrada) não precisa. */
export async function movimentar(ctx: ContextoFin, p: EntradaMovimento): Promise<ResultadoMovimento> {
  if (p.movimento === 'reforco') return movimentarAgora(ctx, p)
  return naFilaDaGaveta(ctx.sessao.restauranteId, () => movimentarAgora(ctx, p))
}

async function movimentarAgora(ctx: ContextoFin, p: EntradaMovimento): Promise<ResultadoMovimento> {
  const loja = ctx.sessao.restauranteId
  if (!podeFin(ctx.sessao.papel, ctx.acessos, permissaoDoMovimento(p.movimento))) return falha('Você não tem permissão para este movimento.', 403, 'sem_permissao_acao')
  if (!Number.isSafeInteger(p.valorCentavos) || p.valorCentavos <= 0 || p.valorCentavos > 10_000_000) return falha('Informe o valor.', 400)
  const motivo = p.motivo.trim()
  if (motivo.length < 3) return falha('Diga o motivo.', 400, 'motivo')
  if (!/^[\w:.-]{8,120}$/.test(p.chave)) return falha('Chave inválida.', 400)
  const turno = await turnoAberto(ctx.admin, loja)
  if (!turno) return falha('Abra o caixa primeiro.', 409, 'caixa_fechado')
  // Repetição (clique duplo, rede): devolve o que já foi gravado, sem pedir PIN de novo.
  const { data: ja } = await ctx.admin.from('fin_lancamentos').select('aprovado_por_nome').eq('restaurante_id', loja).eq('chave_idempotencia', `mov:${p.chave}`).limit(1)
  if (ja?.length) return { ok: true, repetido: true, aprovadoPor: (ja[0].aprovado_por_nome as string | null) ?? null }

  // Antes do PIN: não gasta a aprovação de ninguém numa saída que não cabe na gaveta.
  if (p.movimento !== 'reforco') {
    const falta = faltaNaGaveta({ movimento: p.movimento, valor: p.valorCentavos, gaveta: (await saldosDoTurno(ctx.admin, loja, turno.id)).gaveta })
    if (falta) return falha(falta, 409, 'gaveta_insuficiente')
  }
  const cfg = await configFin(ctx.admin, loja)
  let aprovacao: { id: string; nome: string } | null = null
  if (precisaAprovacao({ movimento: p.movimento, valor: p.valorCentavos, limite: cfg.limiteSaida, papel: ctx.sessao.papel })) {
    if (!p.aprovacao) return falha(`Acima de ${formatarCentavos(cfg.limiteSaida)} precisa da aprovação de um gerente.`, 409, 'aprovacao_necessaria', { limiteCentavos: cfg.limiteSaida, pedidoRemoto: { acao: p.movimento, valorCentavos: p.valorCentavos, motivo } })
    const a = await conferirAprovacao(ctx.admin, {
      restauranteId: loja, solicitante: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, aprovacao: p.aprovacao,
      acao: p.movimento, valorCentavos: p.valorCentavos, motivo, contexto: { turno: turno.id },
    })
    if (!a.ok) return falha(a.erro, a.status, a.codigo)
    aprovacao = { id: a.id, nome: a.aprovadorNome }
  }
  // Linhas + aprovação usada numa transação (fin_lancar_grupo, 0143/0144).
  const { error: eL } = await ctx.admin.rpc('fin_lancar_grupo', {
    p_restaurante: loja, p_turno: turno.id, p_chave: `mov:${p.chave}`, p_origem: 'manual', p_usuario: ctx.sessao.userId, p_usuario_nome: ctx.sessao.nome,
    p_motivo: motivo, p_aprovacao: aprovacao?.id ?? null, p_aprovado_por: aprovacao?.nome ?? null, p_dispositivo: ctx.dispositivo,
    p_linhas: linhasDoMovimento(p.movimento, p.valorCentavos).map((l) => ({ carteira: l.carteira, tipo: l.tipo, valor_centavos: l.valorCentavos, forma: l.forma ?? null, dados: l.dados ?? null })),
  })
  if (eL) {
    if (/aprovacao_usada/.test(eL.message)) return falha('Esta aprovação já foi usada. Peça de novo.', 409, 'usada')
    // Trava do banco (0162): outra saída gravou antes (outro aparelho ou outra instância do app).
    const g = /gaveta_insuficiente:(-?d+)/.exec(eL.message)
    if (g) return falha(`Só há ${formatarCentavos(Number(g[1]))} na gaveta.`, 409, 'gaveta_insuficiente')
    if (/caixa_fechado|turno_imutavel/.test(eL.message)) return falha('O caixa está fechado.', 409, 'caixa_fechado')
    throw eL
  }
  const r = { repetido: false }
  await auditar(ctx, `caixa.${p.movimento}`, turno.id, { valor_centavos: p.valorCentavos, motivo, aprovado_por: aprovacao?.nome ?? null })
  return { ok: true, repetido: r.repetido, aprovadoPor: aprovacao?.nome ?? null }
}

// ─── fechar (contagem cega) ─────────────────────────────────────────────────
export async function fecharCaixa(ctx: ContextoFin, p: {
  contadoDinheiroCentavos: number; contadoCartaoCentavos: number; justificativa?: string | null; aceitarPendencias?: boolean; aprovacao?: Aprovacao | null
}): Promise<{ ok: true; turno: TurnoFin } | Falha> {
  const loja = ctx.sessao.restauranteId
  for (const v of [p.contadoDinheiroCentavos, p.contadoCartaoCentavos]) {
    if (!Number.isSafeInteger(v) || v < 0 || v > 100_000_000) return falha('Informe o que você contou.', 400)
  }
  const turno = await turnoAberto(ctx.admin, loja)
  if (!turno) return falha('O caixa não está aberto.', 409, 'caixa_fechado')
  const [cfg, saldos, pend] = await Promise.all([configFin(ctx.admin, loja), saldosDoTurno(ctx.admin, loja, turno.id), pendenciasDoFechamento(ctx.admin, loja, turno.id)])
  const dinheiro = avaliarContagem({ esperado: saldos.gaveta, contado: p.contadoDinheiroCentavos, limite: cfg.limiteDivergencia })
  const cartao = avaliarContagem({ esperado: saldos.cartao, contado: p.contadoCartaoCentavos, limite: cfg.limiteDivergencia })
  // Toda contagem fica registrada — recontar até "bater" aparece na auditoria.
  await auditar(ctx, 'caixa.contou', turno.id, {
    contado_dinheiro_centavos: p.contadoDinheiroCentavos, contado_cartao_centavos: p.contadoCartaoCentavos,
    diferenca_centavos: dinheiro.diferenca, diferenca_cartao_centavos: cartao.diferenca,
  })

  const temPendencia = pend.motoboys.length > 0 || pend.contasAbertas > 0 || pend.naoPagos > 0
  if (temPendencia && !p.aceitarPendencias) return falha('Há pendências antes de fechar.', 409, 'pendencias', { pendencias: pend })

  // Regras de PIN no fechamento (Fase 6, provisórias, por loja): ver lib/financeiro/fechamento-regras.ts.
  const ex = exigenciasDoFechamento({
    diferencaDinheiro: dinheiro.diferenca, diferencaCartao: cartao.diferenca, motoboysSemAcerto: pend.motoboys.length, entreguesNaoPagos: pend.naoPagos,
    pixAConferirCentavos: pend.pixAConferirCentavos, comandasAbertas: pend.contasAbertas, comandasAbertasCentavos: pend.contasAbertasCentavos,
  }, { toleranciaCentavos: cfg.toleranciaFechamento, limiteComandasCentavos: cfg.limiteComandasFechamento }, ctx.sessao.papel)
  const divergente = dinheiro.diferenca !== 0 || cartao.diferenca !== 0
  const acimaDaTolerancia = ex.motivos.some((m) => m === 'diferenca_dinheiro_acima' || m === 'diferenca_cartao_acima')
  const justificativa = p.justificativa?.trim() || null
  const dados = {
    diferencaCentavos: dinheiro.diferenca, diferencaCartaoCentavos: cartao.diferenca, limiteCentavos: cfg.toleranciaFechamento,
    motivos: ex.motivos, textos: ex.motivos.map((m: Motivo) => TEXTO_MOTIVO[m]),
  }
  if (ex.justificativa && (!justificativa || justificativa.length < 10)) {
    return falha(divergente ? 'A contagem não bateu. Explique a diferença.' : 'Explique as pendências antes de fechar.', 409, divergente ? 'divergencia' : 'justificativa_necessaria', dados)
  }
  let aprovacao: { id: string; nome: string } | null = null
  if (ex.pin) {
    if (!p.aprovacao) return falha('Precisa da aprovação de um gerente para fechar.', 409, 'aprovacao_necessaria', { ...dados, pedidoRemoto: { acao: acimaDaTolerancia ? 'fechar_caixa_divergente' : 'fechar_caixa', valorCentavos: dinheiro.diferenca, motivo: justificativa } })
    const a = await conferirAprovacao(ctx.admin, {
      restauranteId: loja, solicitante: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, aprovacao: p.aprovacao,
      acao: acimaDaTolerancia ? 'fechar_caixa_divergente' : 'fechar_caixa', valorCentavos: dinheiro.diferenca, motivo: justificativa, contexto: { turno: turno.id, ...dados },
    })
    if (!a.ok) return falha(a.erro, a.status, a.codigo)
    aprovacao = { id: a.id, nome: a.aprovadorNome }
  }

  const ajuste = linhasDoAjuste(dinheiro.diferenca)
  const resumo = { saldos, fechado_por: ctx.sessao.nome, pix_online: pend.pixOnline, ...(turno.resumo && typeof turno.resumo === 'object' && 'fechamento_anterior' in (turno.resumo as object) ? { fechamento_anterior: (turno.resumo as Record<string, unknown>).fechamento_anterior } : {}) }
  // Tudo numa transação (fin_caixa_fechar, 0144): ajuste da contagem + turno fechado + aprovação usada + auditoria.
  const { error: eF } = await ctx.admin.rpc('fin_caixa_fechar', {
    p_restaurante: loja, p_turno: turno.id, p_chave: `fechamento:${turno.id}:${turno.reaberto_em ?? 'x'}`.slice(0, 120),
    p_linhas: ajuste.map((l) => ({ carteira: l.carteira, tipo: l.tipo, valor_centavos: l.valorCentavos, forma: l.forma ?? null, dados: l.dados ?? null })),
    p_campos: {
      contado_dinheiro_centavos: p.contadoDinheiroCentavos, contado_cartao_centavos: p.contadoCartaoCentavos, esperado_dinheiro_centavos: saldos.gaveta,
      esperado_cartao_centavos: saldos.cartao, diferenca_centavos: dinheiro.diferenca, diferenca_cartao_centavos: cartao.diferenca,
      pendencias: temPendencia ? pend : null, resumo, justificativa,
    },
    p_usuario: ctx.sessao.userId, p_usuario_nome: ctx.sessao.nome, p_aprovacao: aprovacao?.id ?? null, p_aprovado_por: aprovacao?.nome ?? null,
    p_dispositivo: ctx.dispositivo, p_motivo: justificativa ?? 'Diferença na contagem do fechamento',
    p_auditoria: {
      esperado_centavos: saldos.gaveta, contado_centavos: p.contadoDinheiroCentavos, diferenca_centavos: dinheiro.diferenca,
      diferenca_cartao_centavos: cartao.diferenca, pendencias: temPendencia, aprovado_por: aprovacao?.nome ?? null, dispositivo: ctx.dispositivo,
    },
  })
  if (eF) {
    if (/ja_fechado/.test(eF.message)) return falha('O caixa já foi fechado.', 409, 'ja_fechado')
    if (/aprovacao_usada/.test(eF.message)) return falha('Esta aprovação já foi usada. Peça de novo.', 409, 'usada')
    throw eF
  }
  const { data: fechado } = await ctx.admin.from('caixa_turnos').select(COLS_TURNO).eq('id', turno.id).single()
  const data = [fechado]

  if (acimaDaTolerancia) {
    await criarAlerta(ctx.admin, {
      restauranteId: loja, tipo: 'caixa_divergente', gravidade: 'grave',
      mensagem: `Caixa fechado por ${ctx.sessao.nome} com diferença de ${formatarCentavos(dinheiro.diferenca)} no dinheiro` +
        (cartao.diferenca ? ` e ${formatarCentavos(cartao.diferenca)} no cartão` : '') + `. Justificativa: ${justificativa}` + (aprovacao ? ` (aprovado por ${aprovacao.nome})` : ''),
      usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, dados: { turno: turno.id },
    })
  }
  if (ex.pixParaODono) {
    await criarAlerta(ctx.admin, {
      restauranteId: loja, tipo: 'pix_a_conferir', gravidade: 'atencao',
      mensagem: `Caixa fechado por ${ctx.sessao.nome} com ${formatarCentavos(pend.pixAConferirCentavos)} em Pix a conferir. Confira em Financeiro › Conferir Pix.`,
      usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, dados: { turno: turno.id },
    })
  }
  if (pend.contasAbertas > 0) {
    await criarAlerta(ctx.admin, {
      restauranteId: loja, tipo: 'comanda_passou_turno', gravidade: 'atencao',
      mensagem: `Caixa fechado por ${ctx.sessao.nome} com ${pend.contasAbertas} mesa(s)/comanda(s) aberta(s) (${formatarCentavos(pend.contasAbertasCentavos)}), que passam para o próximo turno. Justificativa: ${justificativa}`,
      usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, dados: { turno: turno.id },
    })
  }
  if (pend.motoboys.length) {
    await criarAlerta(ctx.admin, {
      restauranteId: loja, tipo: 'caixa_fechado_com_pendencia', gravidade: 'atencao',
      mensagem: `Caixa fechado por ${ctx.sessao.nome} com motoboy sem acerto: ${pend.motoboys.map((m) => `${m.nome} (${formatarCentavos(m.esperadoCentavos)})`).join(', ')}.`,
      usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, dados: { turno: turno.id },
    })
  }
  return { ok: true, turno: data[0] as TurnoFin }
}

// ─── reabrir (só o dono) ────────────────────────────────────────────────────
export async function reabrirCaixa(ctx: ContextoFin, turnoId: string, motivo: string): Promise<{ ok: true; turno: TurnoFin } | Falha> {
  const loja = ctx.sessao.restauranteId
  if (!podeFin(ctx.sessao.papel, ctx.acessos, 'caixa_reabrir')) return falha('Só o dono reabre um caixa fechado.', 403, 'sem_permissao_acao')
  const m = motivo.trim()
  if (m.length < 10) return falha('Explique por que vai reabrir (mínimo 10 letras).', 400, 'motivo')
  if (await turnoAberto(ctx.admin, loja)) return falha('Já existe um caixa aberto. Feche-o antes de reabrir outro.', 409, 'ja_aberto')
  const { data: ultimo } = await ctx.admin.from('caixa_turnos').select(COLS_TURNO).eq('restaurante_id', loja).order('aberto_em', { ascending: false }).limit(1).maybeSingle()
  const t = ultimo as TurnoFin | null
  if (!t || t.id !== turnoId) return falha('Só o último caixa fechado pode ser reaberto.', 409, 'nao_e_o_ultimo')
  const anterior = {
    fechado_em: t.fechado_em, fechado_por_nome: t.fechado_por_nome, contado_dinheiro_centavos: t.contado_dinheiro_centavos,
    esperado_dinheiro_centavos: t.esperado_dinheiro_centavos, diferenca_centavos: t.diferenca_centavos, justificativa: t.justificativa,
  }
  const { data, error } = await ctx.admin.from('caixa_turnos').update({
    status: 'reaberto', fechado_em: null, fechado_por: null, fechado_por_nome: null,
    reaberto_por: ctx.sessao.userId, reaberto_por_nome: ctx.sessao.nome, reaberto_em: new Date().toISOString(), reaberto_motivo: m,
    resumo: { fechamento_anterior: anterior },
  }).eq('id', turnoId).eq('restaurante_id', loja).not('fechado_em', 'is', null).select(COLS_TURNO)
  if (error) {
    if ((error as { code?: string }).code === '23505') return falha('Já existe um caixa aberto.', 409, 'ja_aberto')
    throw error
  }
  if (!data?.length) return falha('Este caixa não está fechado.', 409)
  await auditar(ctx, 'caixa.reabriu_turno', turnoId, { motivo: m, fechamento_anterior: anterior })
  await criarAlerta(ctx.admin, {
    restauranteId: loja, tipo: 'caixa_reaberto', gravidade: 'grave',
    mensagem: `${ctx.sessao.nome} reabriu o caixa fechado em ${t.fechado_em ? new Date(t.fechado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}. Motivo: ${m}`,
    usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, dados: { turno: turnoId },
  })
  return { ok: true, turno: data[0] as TurnoFin }
}

/** Avisa o dono quando o caixa passa muito tempo aberto (chamado pelo aviso do topo). */
export async function conferirCaixaAbertoDemais(admin: SupabaseClient, restauranteId: string, turno: TurnoFin) {
  const cfg = await configFin(admin, restauranteId)
  const horas = (Date.now() - new Date(turno.aberto_em).getTime()) / 3_600_000
  if (horas < cfg.horasCaixaAberto) return
  await criarAlerta(admin, {
    restauranteId, tipo: 'caixa_aberto_demais', gravidade: 'atencao',
    mensagem: `O caixa aberto por ${turno.aberto_por_nome ?? '—'} está aberto há ${Math.floor(horas)} horas.`,
    dedupeMin: 6 * 60, dedupeChave: turno.id,
  })
}

export { ROTULO_MOVIMENTO }
