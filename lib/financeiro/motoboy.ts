import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAuditoria } from '@/lib/auditoria'
import type { ContextoFin } from './contexto'
import { lancar, type LinhaLancamento } from './ledger'
import { criarAlerta } from './alertas'
import { podeFin, veValoresFin } from './permissoes'
import { formatarCentavos } from './centavos'
import { configFin, turnoAberto } from './caixa'

/**
 * Motoboy no financeiro (Fase 3, 0136). O dinheiro com cada motoboy é o SALDO da carteira `motoboy`
 * dele no livro-caixa: troco que levou da gaveta + o que recebeu dos clientes − troco que deu − o que
 * devolveu no acerto. Cada linha guarda o pedido (quando é de um pedido), então dá para acertar por
 * pedido ou tudo de uma vez. Diferença no acerto vira pendência (linha sem pedido) até novo acerto
 * ou baixa pelo dono. Quem fez e quem aprovou vêm da sessão.
 */
export type Falha = { ok: false; erro: string; status: number; codigo?: string; dados?: Record<string, unknown> }
const falha = (erro: string, status: number, codigo?: string, dados?: Record<string, unknown>): Falha => ({ ok: false, erro, status, codigo, dados })

interface LinhaMoto { id: number; entregador_id: string; pedido_id: string | null; tipo: string; valor_centavos: number; criado_em: string }

async function linhasMotoboy(admin: SupabaseClient, loja: string, entregadorId?: string): Promise<LinhaMoto[]> {
  const todas: LinhaMoto[] = []
  for (let de = 0; ; de += 1000) {
    let q = admin.from('fin_lancamentos').select('id, entregador_id, pedido_id, tipo, valor_centavos, criado_em').eq('restaurante_id', loja).eq('carteira', 'motoboy')
    if (entregadorId) q = q.eq('entregador_id', entregadorId)
    const { data, error } = await q.order('seq').range(de, de + 999)
    if (error) throw error
    todas.push(...((data ?? []) as LinhaMoto[]))
    if (!data || data.length < 1000) break
  }
  return todas
}

export interface SituacaoMotoboy {
  entregadorId: string; nome: string; desativado: boolean
  saldoCentavos: number
  /** Por pedido ainda não acertado: pedido → saldo. */
  pedidos: { pedidoId: string; numero: number | null; saldoCentavos: number }[]
  /** Parte sem pedido: fundo de troco + pendência de acerto anterior. */
  semPedidoCentavos: number
  trocoLevadoCentavos: number; recebidoCentavos: number; trocoDadoCentavos: number
}

export async function situacaoMotoboys(admin: SupabaseClient, loja: string): Promise<SituacaoMotoboy[]> {
  const [{ data: ents }, linhas] = await Promise.all([
    admin.from('entregadores').select('id, nome, desativado_em').eq('restaurante_id', loja).order('nome'),
    linhasMotoboy(admin, loja),
  ])
  const porEnt = new Map<string, LinhaMoto[]>()
  for (const l of linhas) porEnt.set(l.entregador_id, [...(porEnt.get(l.entregador_id) ?? []), l])
  const idsPed = [...new Set(linhas.map((l) => l.pedido_id).filter((x): x is string => !!x))]
  const numeros = new Map<string, number>()
  for (let i = 0; i < idsPed.length; i += 80) {
    const { data } = await admin.from('pedidos').select('id, numero').in('id', idsPed.slice(i, i + 80))
    for (const p of data ?? []) numeros.set(p.id as string, p.numero as number)
  }
  return (ents ?? []).map((e) => {
    const ls = porEnt.get(e.id as string) ?? []
    const porPedido = new Map<string, number>()
    let semPedido = 0, troco = 0, receb = 0, dado = 0
    for (const l of ls) {
      const v = Number(l.valor_centavos)
      if (l.pedido_id) porPedido.set(l.pedido_id, (porPedido.get(l.pedido_id) ?? 0) + v)
      else semPedido += v
      if (l.tipo === 'troco_motoboy') troco += v
      if (l.tipo === 'recebimento' || l.tipo === 'pendencia_motoboy') receb += Math.max(0, v)
      if (l.tipo === 'troco') dado += -v
    }
    const pedidos = [...porPedido].filter(([, s]) => s !== 0).map(([pedidoId, s]) => ({ pedidoId, numero: numeros.get(pedidoId) ?? null, saldoCentavos: s }))
    return {
      entregadorId: e.id as string, nome: e.nome as string, desativado: !!e.desativado_em,
      saldoCentavos: ls.reduce((s, l) => s + Number(l.valor_centavos), 0), pedidos, semPedidoCentavos: semPedido,
      trocoLevadoCentavos: troco, recebidoCentavos: receb, trocoDadoCentavos: dado,
    }
  })
}

// ─── modo do troco ──────────────────────────────────────────────────────────────────────────
export async function modoTroco(admin: SupabaseClient, loja: string) {
  const { data } = await admin.from('fin_config').select('troco_modo, troco_modo_proximo, fundo_padrao_centavos').eq('restaurante_id', loja).maybeSingle()
  return { modo: (data?.troco_modo as 'pedido' | 'fundo') ?? 'pedido', proximo: (data?.troco_modo_proximo as 'pedido' | 'fundo' | null) ?? null, fundoPadraoCentavos: Number(data?.fundo_padrao_centavos ?? 5000) }
}

/** Troca de modo: vale já se nenhum motoboy tem dinheiro; senão, no próximo caixa aberto. */
export async function definirModoTroco(ctx: ContextoFin, modo: 'pedido' | 'fundo', fundoPadraoCentavos?: number) {
  const loja = ctx.sessao.restauranteId
  if (!['dono', 'gerente'].includes(ctx.sessao.papel)) return falha('Só gerente ou dono muda o modo do troco.', 403, 'sem_permissao_acao')
  const atual = await modoTroco(ctx.admin, loja)
  const algumComDinheiro = (await situacaoMotoboys(ctx.admin, loja)).some((m) => m.saldoCentavos !== 0)
  const imediato = !algumComDinheiro
  const fundo = Number.isSafeInteger(fundoPadraoCentavos) && fundoPadraoCentavos! >= 0 ? fundoPadraoCentavos! : atual.fundoPadraoCentavos
  await ctx.admin.from('fin_config').upsert({
    restaurante_id: loja, fundo_padrao_centavos: fundo,
    ...(imediato ? { troco_modo: modo, troco_modo_proximo: null } : { troco_modo_proximo: modo === atual.modo ? null : modo }),
  }, { onConflict: 'restaurante_id' })
  await registrarAuditoria(ctx.admin, { restauranteId: loja, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: 'fin.troco_modo', entidade: 'restaurante', entidadeId: loja, dados: { de: atual.modo, para: modo, imediato, fundo_padrao_centavos: fundo } })
  return { ok: true as const, imediato }
}

/** Ao abrir o caixa: aplica a troca de modo pendente. */
export async function aplicarModoPendente(admin: SupabaseClient, loja: string) {
  const m = await modoTroco(admin, loja)
  if (m.proximo && m.proximo !== m.modo) await admin.from('fin_config').update({ troco_modo: m.proximo, troco_modo_proximo: null }).eq('restaurante_id', loja)
}

// ─── troco que sai da gaveta para o motoboy ─────────────────────────────────────────────────
export async function entregarTroco(ctx: ContextoFin, p: { entregadorId: string; valorCentavos: number; pedidoId?: string | null; motivo: 'pedido' | 'fundo' | 'complemento'; chave: string }) {
  const loja = ctx.sessao.restauranteId
  if (!Number.isSafeInteger(p.valorCentavos) || p.valorCentavos <= 0 || p.valorCentavos > 500_000) return falha('Informe o valor do troco.', 400)
  const turno = await turnoAberto(ctx.admin, loja)
  if (!turno) return falha('Abra o caixa: o troco sai da gaveta.', 409, 'caixa_fechado')
  const { data: e } = await ctx.admin.from('entregadores').select('id, nome, desativado_em').eq('id', p.entregadorId).eq('restaurante_id', loja).maybeSingle()
  if (!e || e.desativado_em) return falha('Motoboy não encontrado.', 404)
  if (p.pedidoId) {
    const { data: ped } = await ctx.admin.from('pedidos').select('id').eq('id', p.pedidoId).eq('restaurante_id', loja).maybeSingle()
    if (!ped) return falha('Pedido não encontrado.', 404)
  }
  const rotulo = p.motivo === 'fundo' ? 'Fundo de troco do motoboy' : p.motivo === 'complemento' ? 'Complemento de troco' : 'Troco do pedido'
  const linhas: LinhaLancamento[] = [
    { carteira: 'gaveta', tipo: 'troco_motoboy', valorCentavos: -p.valorCentavos, forma: 'dinheiro', entregadorId: e.id as string, pedidoId: p.pedidoId ?? null },
    { carteira: 'motoboy', tipo: 'troco_motoboy', valorCentavos: p.valorCentavos, forma: 'dinheiro', entregadorId: e.id as string, pedidoId: p.pedidoId ?? null },
  ]
  const r = await lancar(ctx.admin, { restauranteId: loja, turnoId: turno.id, chave: `troco:${p.chave}`, origem: 'motoboy', usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, motivo: `${rotulo} — ${e.nome}`, dispositivo: ctx.dispositivo, linhas })
  if (!r.ok) return falha(r.erro, 400)
  if (!r.repetido) await registrarAuditoria(ctx.admin, { restauranteId: loja, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: 'fin.troco_motoboy', entidade: 'entregador', entidadeId: e.id as string, dados: { motoboy: e.nome, valor_centavos: p.valorCentavos, tipo: p.motivo, pedido: p.pedidoId ?? null } })
  return { ok: true as const, repetido: r.repetido }
}

// ─── acerto às cegas ────────────────────────────────────────────────────────────────────────
export async function acertarMotoboy(ctx: ContextoFin, p: { entregadorId: string; contadoCentavos: number; pedidoIds?: string[] | null; chave: string }) {
  const loja = ctx.sessao.restauranteId
  if (!podeFin(ctx.sessao.papel, ctx.acessos, 'acerto_motoboy')) return falha('Você não tem permissão para o acerto.', 403, 'sem_permissao_acao')
  if (!Number.isSafeInteger(p.contadoCentavos) || p.contadoCentavos < 0 || p.contadoCentavos > 10_000_000) return falha('Informe o dinheiro contado.', 400)
  if (!/^[\w:.-]{8,120}$/.test(p.chave)) return falha('Chave inválida.', 400)
  const turno = await turnoAberto(ctx.admin, loja)
  if (!turno) return falha('Abra o caixa: o acerto entra no caixa de quem acerta.', 409, 'caixa_fechado')
  const { data: e } = await ctx.admin.from('entregadores').select('id, nome').eq('id', p.entregadorId).eq('restaurante_id', loja).maybeSingle()
  if (!e) return falha('Motoboy não encontrado.', 404)
  const { data: ja } = await ctx.admin.from('fin_lancamentos').select('dados').eq('restaurante_id', loja).eq('chave_idempotencia', `acerto:${p.chave}`).limit(1)
  if (ja?.length) return { ok: true as const, repetido: true, ...((ja[0].dados as Record<string, number>) ?? {}) }

  const linhasAtuais = await linhasMotoboy(ctx.admin, loja, e.id as string)
  const porPedido = new Map<string, number>()
  let semPedido = 0
  for (const l of linhasAtuais) {
    if (l.pedido_id) porPedido.set(l.pedido_id, (porPedido.get(l.pedido_id) ?? 0) + Number(l.valor_centavos))
    else semPedido += Number(l.valor_centavos)
  }
  const selecionados = p.pedidoIds?.length ? p.pedidoIds.filter((id) => porPedido.has(id)) : [...porPedido.keys()]
  if (p.pedidoIds?.length && selecionados.length !== p.pedidoIds.length) return falha('Há pedido que não está com este motoboy.', 400)
  const incluiSemPedido = !p.pedidoIds?.length
  const esperado = selecionados.reduce((s, id) => s + (porPedido.get(id) ?? 0), 0) + (incluiSemPedido ? semPedido : 0)
  const diferenca = p.contadoCentavos - esperado
  const dados = { esperado_centavos: esperado, contado_centavos: p.contadoCentavos, diferenca_centavos: diferenca, pedidos: selecionados.length }
  const linhas: LinhaLancamento[] = []
  for (const id of selecionados) { const v = porPedido.get(id)!; if (v) linhas.push({ carteira: 'motoboy', tipo: 'acerto_motoboy', valorCentavos: -v, forma: 'dinheiro', entregadorId: e.id as string, pedidoId: id, dados }) }
  if (incluiSemPedido && semPedido) linhas.push({ carteira: 'motoboy', tipo: 'acerto_motoboy', valorCentavos: -semPedido, forma: 'dinheiro', entregadorId: e.id as string, dados })
  if (p.contadoCentavos > 0) linhas.push({ carteira: 'gaveta', tipo: 'acerto_motoboy', valorCentavos: p.contadoCentavos, forma: 'dinheiro', entregadorId: e.id as string, dados })
  // Faltou: o motoboy continua devendo (pendência, sem pedido). Sobrou: crédito dele, até baixa.
  if (diferenca !== 0) linhas.push({ carteira: 'motoboy', tipo: 'pendencia_motoboy', valorCentavos: -diferenca, forma: 'dinheiro', entregadorId: e.id as string, dados: { ...dados, acerto: true } })
  if (!linhas.length) return falha('Nada a acertar com este motoboy.', 409, 'nada_a_acertar')
  const r = await lancar(ctx.admin, { restauranteId: loja, turnoId: turno.id, chave: `acerto:${p.chave}`, origem: 'motoboy', usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, motivo: `Acerto — ${e.nome}`, dispositivo: ctx.dispositivo, linhas })
  if (!r.ok) return falha(r.erro, 400)
  // Histórico de sempre (Logística) também ganha o acerto.
  await ctx.admin.from('fechamentos_caixa').insert({
    restaurante_id: loja, entregador_id: e.id, turno_id: turno.id, valor_esperado: esperado / 100, troco_levado: 0,
    valor_declarado: p.contadoCentavos / 100, diferenca: diferenca / 100, pedidos: selecionados.length, registrado_por_nome: ctx.sessao.nome, fechado_em: new Date().toISOString(),
  })
  await registrarAuditoria(ctx.admin, { restauranteId: loja, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: 'fin.acerto_motoboy', entidade: 'entregador', entidadeId: e.id as string, dados: { motoboy: e.nome, ...dados } })
  if (diferenca !== 0) {
    const cfg = await configFin(ctx.admin, loja)
    await criarAlerta(ctx.admin, {
      restauranteId: loja, tipo: 'acerto_motoboy_divergente', gravidade: Math.abs(diferenca) > cfg.limiteDivergencia ? 'grave' : 'atencao',
      mensagem: `Acerto de ${e.nome} por ${ctx.sessao.nome}: ${diferenca < 0 ? 'faltou' : 'sobrou'} ${formatarCentavos(Math.abs(diferenca))} (esperado ${formatarCentavos(esperado)}, contado ${formatarCentavos(p.contadoCentavos)}). Ficou como pendência do motoboy.`,
      usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, dados: { entregador: e.id },
    })
  }
  return { ok: true as const, repetido: false, ...dados }
}

/** Baixa da pendência do motoboy: só o dono, com motivo. Zera o saldo SEM pedido (o que ficou do acerto). */
export async function baixarPendencia(ctx: ContextoFin, p: { entregadorId: string; motivo: string; chave: string }) {
  const loja = ctx.sessao.restauranteId
  if (ctx.sessao.papel !== 'dono') return falha('Só o dono dá baixa em pendência de motoboy.', 403, 'sem_permissao_acao')
  if (p.motivo.trim().length < 10) return falha('Explique a baixa (mínimo 10 letras).', 400, 'motivo')
  const turno = await turnoAberto(ctx.admin, loja)
  const { data: e } = await ctx.admin.from('entregadores').select('id, nome').eq('id', p.entregadorId).eq('restaurante_id', loja).maybeSingle()
  if (!e) return falha('Motoboy não encontrado.', 404)
  const semPedido = (await linhasMotoboy(ctx.admin, loja, e.id as string)).filter((l) => !l.pedido_id).reduce((s, l) => s + Number(l.valor_centavos), 0)
  if (semPedido === 0) return falha('Este motoboy não tem pendência.', 409, 'sem_pendencia')
  const r = await lancar(ctx.admin, {
    restauranteId: loja, turnoId: turno?.id ?? null, chave: `baixa:${p.chave}`, origem: 'manual', usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, motivo: p.motivo.trim(), dispositivo: ctx.dispositivo,
    linhas: [
      { carteira: 'motoboy', tipo: 'ajuste', valorCentavos: -semPedido, forma: 'dinheiro', entregadorId: e.id as string, dados: { baixa: true } },
      { carteira: 'resultado', tipo: 'perda', valorCentavos: -semPedido, forma: 'dinheiro', entregadorId: e.id as string, dados: { baixa: true } },
    ],
  })
  if (!r.ok) return falha(r.erro, 400)
  await registrarAuditoria(ctx.admin, { restauranteId: loja, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: 'fin.baixa_pendencia_motoboy', entidade: 'entregador', entidadeId: e.id as string, dados: { motoboy: e.nome, valor_centavos: semPedido, motivo: p.motivo.trim() } })
  await criarAlerta(ctx.admin, { restauranteId: loja, tipo: 'baixa_pendencia_motoboy', gravidade: 'atencao', mensagem: `${ctx.sessao.nome} deu baixa de ${formatarCentavos(semPedido)} na pendência de ${e.nome}. Motivo: ${p.motivo.trim()}`, usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, dados: { entregador: e.id } })
  return { ok: true as const, valorCentavos: semPedido }
}

// ─── Pix a conferir ─────────────────────────────────────────────────────────────────────────
export async function pixAConferir(admin: SupabaseClient, loja: string) {
  const { data: pix } = await admin.from('fin_lancamentos').select('id, valor_centavos, pedido_id, comanda_id, usuario_nome, criado_em, dados, origem')
    .eq('restaurante_id', loja).eq('carteira', 'pix_conferir').gt('valor_centavos', 0).order('seq', { ascending: false }).limit(300)
  const ids = (pix ?? []).map((l) => l.id as number)
  if (!ids.length) return []
  const { data: refs } = await admin.from('fin_lancamentos').select('referencia_id').eq('restaurante_id', loja).eq('carteira', 'pix_conferir').in('referencia_id', ids)
  const resolvidos = new Set((refs ?? []).map((r) => r.referencia_id as number))
  // Estorno de pagamento presencial também baixa o Pix (pagamento_id): conta pelo saldo por pagamento.
  return (pix ?? []).filter((l) => !resolvidos.has(l.id as number)).map((l) => ({
    id: l.id as number, valorCentavos: Number(l.valor_centavos), pedidoId: l.pedido_id as string | null, comandaId: l.comanda_id as string | null,
    numero: ((l.dados as Record<string, unknown> | null)?.numero as number | undefined) ?? null, origem: l.origem as string, registradoPor: l.usuario_nome as string, em: l.criado_em as string,
  }))
}

export async function conferirPix(ctx: ContextoFin, p: { lancamentoId: number; caiu: boolean; motivo?: string | null }) {
  const loja = ctx.sessao.restauranteId
  if (!podeFin(ctx.sessao.papel, ctx.acessos, 'pix_conferir')) return falha('Você não tem permissão para conferir Pix.', 403, 'sem_permissao_acao')
  const { data: l } = await ctx.admin.from('fin_lancamentos').select('id, valor_centavos, pedido_id, comanda_id, carteira, restaurante_id').eq('id', p.lancamentoId).eq('restaurante_id', loja).maybeSingle()
  if (!l || l.carteira !== 'pix_conferir' || Number(l.valor_centavos) <= 0) return falha('Pix não encontrado.', 404)
  if (!p.caiu && (p.motivo ?? '').trim().length < 3) return falha('Diga por que o Pix não caiu.', 400, 'motivo')
  const v = Number(l.valor_centavos)
  const turno = await turnoAberto(ctx.admin, loja)
  const r = await lancar(ctx.admin, {
    restauranteId: loja, turnoId: turno?.id ?? null, chave: `pixconf:${l.id}`, origem: 'manual', usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome },
    motivo: p.caiu ? 'Pix conferido: caiu na conta' : `Pix não caiu: ${(p.motivo ?? '').trim()}`, dispositivo: ctx.dispositivo,
    linhas: [
      { carteira: 'pix_conferir', tipo: 'pix_confirmado', valorCentavos: -v, forma: 'pix', pedidoId: l.pedido_id as string | null, comandaId: l.comanda_id as string | null, referenciaId: l.id as number },
      { carteira: p.caiu ? 'empresa' : 'a_receber', tipo: 'pix_confirmado', valorCentavos: v, forma: 'pix', pedidoId: l.pedido_id as string | null, comandaId: l.comanda_id as string | null, referenciaId: l.id as number },
    ],
  })
  if (!r.ok) return falha(r.erro, 400)
  if (r.repetido) return falha('Este Pix já foi conferido.', 409, 'ja_conferido')
  if (p.caiu && l.pedido_id) await ctx.admin.from('pedidos').update({ pago: true }).eq('id', l.pedido_id).eq('restaurante_id', loja)
  await registrarAuditoria(ctx.admin, { restauranteId: loja, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: p.caiu ? 'fin.pix_confirmado' : 'fin.pix_nao_caiu', entidade: 'lancamento', entidadeId: undefined, dados: { lancamento: l.id, valor_centavos: v, pedido: l.pedido_id, motivo: p.motivo ?? null } })
  return { ok: true as const }
}

// ─── entregas sem registro (sem motoboy no app, Nexta) ──────────────────────────────────────
export async function entregasSemRegistro(admin: SupabaseClient, loja: string) {
  const { data: primeiro } = await admin.from('fin_lancamentos').select('criado_em').eq('restaurante_id', loja).order('seq').limit(1)
  const desde = new Date(Math.max(Date.now() - 14 * 86_400_000, primeiro?.[0] ? Date.parse(primeiro[0].criado_em as string) : 0)).toISOString()
  const { data: peds } = await admin.from('pedidos').select('id, numero, total, forma_pagamento, cartao_tipo, troco_para, entregador_id, entregue_em, cliente_nome, pago, comanda_id, entregadores ( nome )')
    .eq('restaurante_id', loja).eq('tipo', 'entrega').in('status', ['entregue', 'em_rota']).gte('criado_em', desde).order('criado_em', { ascending: false }).limit(300)
  const ids = (peds ?? []).map((p) => p.id as string)
  if (!ids.length) return []
  const registrados = new Set<string>()
  const comPendencia = new Set<string>()
  const nexta = new Set<string>()
  for (let i = 0; i < ids.length; i += 80) {
    const parte = ids.slice(i, i + 80)
    const [{ data: reg }, { data: pend }, { data: nx }] = await Promise.all([
      admin.from('fin_entregas_pagamento').select('pedido_id').in('pedido_id', parte),
      admin.from('fin_lancamentos').select('pedido_id').eq('restaurante_id', loja).eq('tipo', 'pendencia_motoboy').in('pedido_id', parte),
      admin.from('nexta_entregas').select('pedido_id').in('pedido_id', parte),
    ])
    for (const r of reg ?? []) registrados.add(r.pedido_id as string)
    for (const r of pend ?? []) comPendencia.add(r.pedido_id as string)
    for (const r of nx ?? []) nexta.add(r.pedido_id as string)
  }
  // Fora: já registrados; já pagos (Pix confirmado, pago no caixa); os que já viraram "a acertar" do motoboy.
  return (peds ?? []).filter((p) => !registrados.has(p.id as string) && !p.pago && !comPendencia.has(p.id as string)).map((p) => ({
    pedidoId: p.id as string, numero: p.numero as number, totalCentavos: Math.round(Number(p.total) * 100), forma: p.forma_pagamento as string,
    cartaoTipo: (p.cartao_tipo as string | null) ?? null, trocoPara: p.troco_para === null ? null : Number(p.troco_para), cliente: p.cliente_nome as string,
    entregador: (p.entregadores as unknown as { nome?: string } | null)?.nome ?? null, nexta: nexta.has(p.id as string), entregueEm: (p.entregue_em as string | null) ?? null,
  }))
}

export async function registrarEntregaOperador(ctx: ContextoFin, p: { pedidoId: string; forma: string; recebidoCentavos?: number | null; nsu?: string | null; motivo?: string | null; chave: string }) {
  const loja = ctx.sessao.restauranteId
  if (!podeFin(ctx.sessao.papel, ctx.acessos, 'acerto_motoboy') && !podeFin(ctx.sessao.papel, ctx.acessos, 'receber_pagamento')) return falha('Você não tem permissão para registrar recebimentos.', 403, 'sem_permissao_acao')
  const { data, error } = await ctx.admin.rpc('entrega_registrar', {
    p_restaurante: loja, p_pedido: p.pedidoId, p_entregador: null, p_forma: p.forma, p_recebido_centavos: p.recebidoCentavos ?? null,
    p_nsu: p.nsu ?? null, p_motivo: p.motivo ?? null, p_chave: p.chave, p_ator: ctx.sessao.userId, p_ator_nome: ctx.sessao.nome, p_origem: 'operador',
  })
  if (error) {
    const cod = (/([a-z_]+)/.exec(error.message)?.[1]) ?? ''
    const msg: Record<string, string> = { caixa_fechado: 'Abra o caixa: o dinheiro entra na gaveta.', ja_registrado: 'Esta entrega já foi registrada.', motivo_obrigatorio: 'Diga o motivo.', recebido_menor_que_total: 'O recebido é menor que o total.', pedido_nao_saiu: 'O pedido ainda não saiu para entrega.' }
    return falha(msg[cod] ?? 'Não foi possível registrar.', 409, cod)
  }
  return { ok: true as const, ...(data as Record<string, unknown>) }
}

/** Nexta repassou o dinheiro que o entregador dela recebeu: sai do "a receber", entra na gaveta. */
export async function repasseNexta(ctx: ContextoFin, p: { lancamentoIds: number[]; chave: string }) {
  const loja = ctx.sessao.restauranteId
  if (!podeFin(ctx.sessao.papel, ctx.acessos, 'receber_pagamento') && !podeFin(ctx.sessao.papel, ctx.acessos, 'acerto_motoboy')) return falha('Sem permissão.', 403, 'sem_permissao_acao')
  const turno = await turnoAberto(ctx.admin, loja)
  if (!turno) return falha('Abra o caixa: o repasse entra na gaveta.', 409, 'caixa_fechado')
  const { data: ls } = await ctx.admin.from('fin_lancamentos').select('id, valor_centavos, pedido_id, dados, carteira').eq('restaurante_id', loja).in('id', p.lancamentoIds)
  const validos = (ls ?? []).filter((l) => l.carteira === 'a_receber' && (l.dados as Record<string, unknown> | null)?.nexta === true && Number(l.valor_centavos) > 0)
  if (!validos.length) return falha('Nada a repassar.', 409)
  const total = validos.reduce((s, l) => s + Number(l.valor_centavos), 0)
  const linhas: LinhaLancamento[] = validos.map((l) => ({ carteira: 'a_receber', tipo: 'recebimento', valorCentavos: -Number(l.valor_centavos), forma: 'dinheiro', pedidoId: l.pedido_id as string | null, referenciaId: l.id as number, dados: { nexta: true, repasse: true } }))
  linhas.push({ carteira: 'gaveta', tipo: 'recebimento', valorCentavos: total, forma: 'dinheiro', dados: { nexta: true, repasse: true } })
  const r = await lancar(ctx.admin, { restauranteId: loja, turnoId: turno.id, chave: `nexta:${p.chave}`, origem: 'delivery', usuario: { id: ctx.sessao.userId, nome: ctx.sessao.nome }, motivo: 'Repasse da Nexta', dispositivo: ctx.dispositivo, linhas })
  if (!r.ok) return falha(r.erro, 400)
  if (!r.repetido) await registrarAuditoria(ctx.admin, { restauranteId: loja, usuarioId: ctx.sessao.userId, usuarioNome: ctx.sessao.nome, acao: 'fin.repasse_nexta', entidade: 'lancamento', entidadeId: undefined, dados: { valor_centavos: total, lancamentos: validos.map((l) => l.id) } })
  return { ok: true as const, totalCentavos: total }
}

export async function nextaAReceber(admin: SupabaseClient, loja: string) {
  const { data } = await admin.from('fin_lancamentos').select('id, valor_centavos, pedido_id, dados, criado_em').eq('restaurante_id', loja).eq('carteira', 'a_receber').gt('valor_centavos', 0).order('seq', { ascending: false }).limit(200)
  const nx = (data ?? []).filter((l) => (l.dados as Record<string, unknown> | null)?.nexta === true)
  if (!nx.length) return []
  const { data: refs } = await admin.from('fin_lancamentos').select('referencia_id').eq('restaurante_id', loja).eq('carteira', 'a_receber').in('referencia_id', nx.map((l) => l.id as number))
  const pagos = new Set((refs ?? []).map((r) => r.referencia_id as number))
  return nx.filter((l) => !pagos.has(l.id as number)).map((l) => ({ id: l.id as number, valorCentavos: Number(l.valor_centavos), pedidoId: l.pedido_id as string | null, numero: ((l.dados as Record<string, unknown>)?.numero as number | undefined) ?? null, em: l.criado_em as string }))
}

export { veValoresFin }
