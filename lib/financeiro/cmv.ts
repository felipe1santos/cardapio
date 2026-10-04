import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAuditoria } from '@/lib/auditoria'
import type { ContextoFin } from './contexto'
import {
  centavos, conversaoPadrao, custoFicha, custoPorBase, lerQuantidadeTexto, margemPct, precoSugerido,
  type Arredondamento, type UnidadeBase, type UnidadeCompra,
} from './cmv-regras'

/**
 * Precificação / CMV (Fase 5) — servidor. Tabelas cmv_* só são lidas aqui (service_role), sempre filtradas
 * pela loja da SESSÃO. Custos são calculados a partir dos insumos; o preço NUNCA muda sozinho.
 */

type Ctx = Pick<ContextoFin, 'admin' | 'sessao' | 'dispositivo'>
const reais = (v: unknown) => Math.round(Number(v ?? 0) * 100)

export interface Insumo {
  id: string; nome: string; unidadeCompra: UnidadeCompra; quantidadeCompra: number; basePorUnidade: number; unidadeBase: UnidadeBase
  custoCompraCentavos: number; aproveitamentoPct: number; preparado: boolean; rendimentoBase: number | null; ativo: boolean
  componentes: { componenteId: string; quantidadeBase: number }[]
  /** Centavos por unidade base, com fração. */
  custoPorBase: number
  usos: number
}

async function todas<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

/** Insumos da loja com o custo por unidade base (sub-receita resolvida em ordem, sem ciclo). */
export async function listarInsumos(admin: SupabaseClient, loja: string): Promise<Insumo[]> {
  const [ins, comps, usos] = await Promise.all([
    todas<Record<string, unknown>>((a, b) => admin.from('cmv_insumos').select('*').eq('restaurante_id', loja).order('nome').range(a, b)),
    todas<Record<string, unknown>>((a, b) => admin.from('cmv_insumo_componentes').select('insumo_id, componente_id, quantidade_base, cmv_insumos!cmv_insumo_componentes_insumo_id_fkey!inner(restaurante_id)').eq('cmv_insumos.restaurante_id', loja).range(a, b)),
    todas<Record<string, unknown>>((a, b) => admin.from('cmv_ficha_componentes').select('insumo_id, cmv_fichas!inner(restaurante_id)').eq('cmv_fichas.restaurante_id', loja).range(a, b)),
  ])
  const porId = new Map<string, Insumo>()
  for (const r of ins) {
    porId.set(r.id as string, {
      id: r.id as string, nome: r.nome as string, unidadeCompra: r.unidade_compra as UnidadeCompra, quantidadeCompra: Number(r.quantidade_compra),
      basePorUnidade: Number(r.base_por_unidade), unidadeBase: r.unidade_base as UnidadeBase, custoCompraCentavos: Number(r.custo_compra_centavos),
      aproveitamentoPct: Number(r.aproveitamento_pct), preparado: !!r.preparado, rendimentoBase: r.rendimento_base === null ? null : Number(r.rendimento_base),
      ativo: !!r.ativo, componentes: [], custoPorBase: 0, usos: 0,
    })
  }
  for (const c of comps) porId.get(c.insumo_id as string)?.componentes.push({ componenteId: c.componente_id as string, quantidadeBase: Number(c.quantidade_base) })
  for (const u of usos) { const i = porId.get(u.insumo_id as string); if (i) i.usos++ }
  for (const c of comps) { const i = porId.get(c.componente_id as string); if (i) i.usos++ }
  const custo = (id: string, nivel = 0): number => {
    const i = porId.get(id)
    if (!i || nivel > 5) return 0
    return custoPorBase({ ...i, componentes: i.componentes.map((c) => ({ quantidadeBase: c.quantidadeBase, custoPorBase: custo(c.componenteId, nivel + 1) })) })
  }
  for (const i of porId.values()) i.custoPorBase = custo(i.id)
  return [...porId.values()]
}

export interface Config { margemAlvoPct: number; margemBaixaPct: number; custosVariaveisPct: number; arredondamento: Arredondamento; porCategoria: Record<string, number> }
export async function lerConfig(admin: SupabaseClient, loja: string): Promise<Config> {
  const [{ data: c }, { data: cats }] = await Promise.all([
    admin.from('cmv_config').select('*').eq('restaurante_id', loja).maybeSingle(),
    admin.from('cmv_config_categoria').select('grupo_id, margem_alvo_pct').eq('restaurante_id', loja),
  ])
  return {
    margemAlvoPct: c ? Number(c.margem_alvo_pct) : 65, margemBaixaPct: c ? Number(c.margem_baixa_pct) : 30,
    custosVariaveisPct: c ? Number(c.custos_variaveis_pct) : 0, arredondamento: (c?.arredondamento as Arredondamento) ?? '90',
    porCategoria: Object.fromEntries((cats ?? []).map((x) => [x.grupo_id as string, Number(x.margem_alvo_pct)])),
  }
}

export type AlvoTipo = 'item' | 'tamanho' | 'sabor' | 'complemento' | 'borda' | 'massa'
export interface LinhaPreco {
  chave: string; itemId: string; nome: string; variante: string | null; categoria: string; grupoId: string | null; foto: string | null
  status: string; alvo: { tipo: AlvoTipo; id: string; tamanhoId: string | null }
  precoCentavos: number; custoCentavos: number | null; lucroCentavos: number | null; margemPct: number | null
  margemBaixa: boolean; temFicha: boolean; custoManualCentavos: number | null
  margemAlvoPct: number; sugestaoCentavos: number | null
}

/** Lista de precificação: uma linha por variante vendável (item, tamanho, sabor × tamanho da pizza). */
export async function listaPrecificacao(admin: SupabaseClient, loja: string) {
  const [itens, grupos, tamanhos, sabores, saborPrecos, tamPizza, fichas, fcomps, gestao, insumos, config] = await Promise.all([
    todas<Record<string, unknown>>((a, b) => admin.from('itens_cardapio').select('id, nome, preco, status, tipo_item, grupo_id, imagem_url, imagem_thumb_url').eq('restaurante_id', loja).order('nome').range(a, b)),
    admin.from('grupos_cardapio').select('id, nome').eq('restaurante_id', loja).then((r) => r.data ?? []),
    todas<Record<string, unknown>>((a, b) => admin.from('tamanhos_item').select('id, item_id, nome, preco, posicao, itens_cardapio!inner(restaurante_id)').eq('itens_cardapio.restaurante_id', loja).order('posicao').range(a, b)),
    todas<Record<string, unknown>>((a, b) => admin.from('pizza_sabores').select('id, item_id, nome, status, posicao, itens_cardapio!inner(restaurante_id)').eq('itens_cardapio.restaurante_id', loja).order('posicao').range(a, b)),
    todas<Record<string, unknown>>((a, b) => admin.from('pizza_sabor_precos').select('sabor_id, tamanho_padrao_id, preco, pizza_sabores!inner(item_id, itens_cardapio!inner(restaurante_id))').eq('pizza_sabores.itens_cardapio.restaurante_id', loja).range(a, b)),
    admin.from('tamanhos_padrao_pizza').select('id, nome, posicao').eq('restaurante_id', loja).order('posicao').then((r) => r.data ?? []),
    todas<Record<string, unknown>>((a, b) => admin.from('cmv_fichas').select('id, alvo_tipo, alvo_id, tamanho_padrao_id').eq('restaurante_id', loja).range(a, b)),
    todas<Record<string, unknown>>((a, b) => admin.from('cmv_ficha_componentes').select('ficha_id, insumo_id, quantidade_base, cmv_fichas!inner(restaurante_id)').eq('cmv_fichas.restaurante_id', loja).range(a, b)),
    todas<Record<string, unknown>>((a, b) => admin.from('itens_cardapio_gestao').select('item_id, preco_custo').eq('restaurante_id', loja).range(a, b)),
    listarInsumos(admin, loja),
    lerConfig(admin, loja),
  ])
  const custoIns = new Map(insumos.map((i) => [i.id, i.custoPorBase]))
  const compsPorFicha = new Map<string, { quantidadeBase: number; custoPorBase: number }[]>()
  for (const c of fcomps) {
    const l = compsPorFicha.get(c.ficha_id as string) ?? []
    l.push({ quantidadeBase: Number(c.quantidade_base), custoPorBase: custoIns.get(c.insumo_id as string) ?? 0 })
    compsPorFicha.set(c.ficha_id as string, l)
  }
  const fichaDe = new Map<string, string>()
  for (const f of fichas) fichaDe.set(`${f.alvo_tipo}:${f.alvo_id}:${f.tamanho_padrao_id ?? ''}`, f.id as string)
  const custoDe = (tipo: AlvoTipo, id: string, tam: string | null = null): number | null => {
    const f = fichaDe.get(`${tipo}:${id}:${tam ?? ''}`)
    return f ? custoFicha(compsPorFicha.get(f) ?? []) : null
  }
  const grupoNome = new Map(grupos.map((g) => [g.id as string, g.nome as string]))
  const manual = new Map(gestao.map((g) => [g.item_id as string, g.preco_custo === null ? null : reais(g.preco_custo)]))
  const tamNome = new Map(tamPizza.map((t) => [t.id as string, t.nome as string]))
  const linhas: LinhaPreco[] = []
  const empurrar = (it: Record<string, unknown>, variante: string | null, alvo: LinhaPreco['alvo'], preco: number, custoBruto: number | null) => {
    const grupoId = (it.grupo_id as string) ?? null
    const alvoPct = (grupoId && config.porCategoria[grupoId] !== undefined) ? config.porCategoria[grupoId] : config.margemAlvoPct
    const custo = custoBruto === null ? null : centavos(custoBruto)
    const m = custo === null ? null : margemPct(preco, custo)
    linhas.push({
      chave: `${alvo.tipo}:${alvo.id}:${alvo.tamanhoId ?? ''}`, itemId: it.id as string, nome: it.nome as string, variante, categoria: grupoNome.get(grupoId ?? '') ?? '—', grupoId,
      foto: (it.imagem_thumb_url as string) || (it.imagem_url as string) || null, status: it.status as string, alvo,
      precoCentavos: preco, custoCentavos: custo, lucroCentavos: custo === null ? null : preco - custo, margemPct: m,
      margemBaixa: m !== null && m < config.margemBaixaPct, temFicha: custo !== null, custoManualCentavos: manual.get(it.id as string) ?? null,
      margemAlvoPct: alvoPct, sugestaoCentavos: custo === null ? null : precoSugerido(custo, alvoPct, config.custosVariaveisPct, config.arredondamento),
    })
  }
  for (const it of itens) {
    const id = it.id as string
    if (it.tipo_item === 'pizza') {
      const ss = sabores.filter((s) => s.item_id === id && s.status !== 'inativo')
      const precos = saborPrecos.filter((p) => ss.some((s) => s.id === (p.sabor_id as string)) && Number(p.preco) > 0)
      if (ss.length && precos.length) {
        for (const s of ss) for (const t of tamPizza) {
          const p = precos.find((x) => x.sabor_id === s.id && x.tamanho_padrao_id === t.id)
          if (!p) continue
          empurrar(it, `${s.nome as string} · ${t.nome as string}`, { tipo: 'sabor', id: s.id as string, tamanhoId: t.id as string }, reais(p.preco), custoDe('sabor', s.id as string, t.id as string))
        }
        continue
      }
    }
    const ts = tamanhos.filter((t) => t.item_id === id)
    if (ts.length) {
      for (const t of ts) empurrar(it, t.nome as string, { tipo: 'tamanho', id: t.id as string, tamanhoId: null }, reais(t.preco), custoDe('tamanho', t.id as string) ?? custoDe('item', id))
      continue
    }
    empurrar(it, null, { tipo: 'item', id, tamanhoId: null }, reais(it.preco), custoDe('item', id))
  }
  const comFicha = linhas.filter((l) => l.temFicha)
  const resumo = {
    total: linhas.length, comFicha: comFicha.length, semFicha: linhas.length - comFicha.length,
    margemBaixa: linhas.filter((l) => l.margemBaixa).length,
    margemMediaPct: comFicha.length ? comFicha.reduce((s, l) => s + (l.margemPct ?? 0), 0) / comFicha.length : null,
  }
  void tamNome
  return { linhas, resumo, config, categorias: grupos.map((g) => ({ id: g.id as string, nome: g.nome as string })) }
}

// ── Insumos: criar/editar com histórico ─────────────────────────────────────────────────────
export interface EntradaInsumo {
  nome: string; unidadeCompra: UnidadeCompra; quantidadeCompra: number; basePorUnidade: number | null; unidadeBase: UnidadeBase | null
  custoCompraCentavos: number; aproveitamentoPct: number; preparado: boolean; rendimentoBase: number | null
  componentes?: { componenteId: string; quantidadeBase: number }[]; motivo?: string | null
}
type Res<T> = { ok: true; valor: T } | { ok: false; erro: string; status: number }
const falha = (erro: string, status = 400) => ({ ok: false as const, erro, status })

/** Lê do corpo SÓ os campos do insumo (nunca loja, custo calculado ou quem fez). */
export function lerEntradaInsumo(corpo: Record<string, unknown> | null): EntradaInsumo {
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
  return {
    nome: typeof corpo?.nome === 'string' ? corpo.nome : '',
    unidadeCompra: String(corpo?.unidadeCompra ?? '') as EntradaInsumo['unidadeCompra'],
    quantidadeCompra: Number(corpo?.quantidadeCompra ?? 1),
    basePorUnidade: n(corpo?.basePorUnidade),
    unidadeBase: (corpo?.unidadeBase as EntradaInsumo['unidadeBase']) ?? null,
    custoCompraCentavos: Number(corpo?.custoCompraCentavos ?? 0),
    aproveitamentoPct: Number(corpo?.aproveitamentoPct ?? 100),
    preparado: corpo?.preparado === true,
    rendimentoBase: n(corpo?.rendimentoBase),
    componentes: Array.isArray(corpo?.componentes) ? (corpo!.componentes as { componenteId?: unknown; quantidadeBase?: unknown }[])
      .filter((x) => typeof x?.componenteId === 'string' && /^[0-9a-f-]{36}$/i.test(x.componenteId as string))
      .map((x) => ({ componenteId: x.componenteId as string, quantidadeBase: Number(x.quantidadeBase) })) : [],
    motivo: typeof corpo?.motivo === 'string' ? corpo.motivo : null,
  }
}

export function validarInsumo(e: EntradaInsumo): string | null {
  if (!e.nome?.trim() || e.nome.trim().length > 80) return 'Informe o nome do insumo.'
  const conv = e.preparado ? null : conversaoPadrao(e.unidadeCompra)
  if (!conv && (!e.unidadeBase || !['g', 'ml', 'un'].includes(e.unidadeBase))) return 'Escolha a unidade base (g, ml ou unidade).'
  if (!conv && !e.preparado && !(Number(e.basePorUnidade) > 0)) return 'Informe quanto vem em cada unidade de compra (ex.: pacote com 24).'
  if (!(Number(e.quantidadeCompra) > 0)) return 'Informe a quantidade comprada.'
  if (!Number.isSafeInteger(e.custoCompraCentavos) || e.custoCompraCentavos < 0 || e.custoCompraCentavos > 100_000_000) return 'Custo inválido.'
  if (!(e.aproveitamentoPct > 0 && e.aproveitamentoPct <= 100)) return 'Aproveitamento entre 1% e 100%.'
  if (e.preparado && !(Number(e.rendimentoBase) > 0)) return 'Informe quanto a receita rende.'
  return null
}

export async function salvarInsumo(c: Ctx, id: string | null, entrada: EntradaInsumo): Promise<Res<{ id: string }>> {
  const loja = c.sessao.restauranteId
  let e = entrada
  const erro = validarInsumo(e)
  if (erro) return falha(erro)
  // Preparado: a 'compra' é a própria receita, na unidade base escolhida.
  if (e.preparado) { e = { ...e, unidadeCompra: (e.unidadeBase ?? 'g') as UnidadeCompra, quantidadeCompra: 1, basePorUnidade: 1 } }
  const conv = e.preparado ? null : conversaoPadrao(e.unidadeCompra)
  const linha = {
    restaurante_id: loja, nome: e.nome.trim(), unidade_compra: e.unidadeCompra, quantidade_compra: e.quantidadeCompra,
    base_por_unidade: conv ? conv.fator : e.basePorUnidade, unidade_base: conv ? conv.base : e.unidadeBase ?? 'g',
    custo_compra_centavos: e.preparado ? 0 : e.custoCompraCentavos, aproveitamento_pct: e.aproveitamentoPct,
    preparado: !!e.preparado, rendimento_base: e.preparado ? e.rendimentoBase : null, atualizado_em: new Date().toISOString(),
  }
  let antigo: Record<string, unknown> | null = null
  if (id) {
    const { data } = await c.admin.from('cmv_insumos').select('*').eq('id', id).eq('restaurante_id', loja).maybeSingle()
    if (!data) return falha('Insumo não encontrado.', 404)
    antigo = data
  }
  // Sub-receita: componentes só da mesma loja, sem ciclo.
  const comps = (e.preparado ? e.componentes ?? [] : []).filter((x) => x.quantidadeBase > 0)
  if (comps.length) {
    const { data: ok } = await c.admin.from('cmv_insumos').select('id').eq('restaurante_id', loja).in('id', comps.map((x) => x.componenteId))
    if ((ok ?? []).length !== new Set(comps.map((x) => x.componenteId)).size) return falha('Componente inválido.', 404)
    if (id && comps.some((x) => x.componenteId === id)) return falha('O insumo não pode usar ele mesmo.')
  }
  // Histórico append-only: custo (ou o que muda o custo) mudou → registra antigo, novo, quem e motivo.
  const mudouCusto = !antigo || Number(antigo.custo_compra_centavos) !== linha.custo_compra_centavos || Number(antigo.quantidade_compra) !== Number(linha.quantidade_compra)
    || Number(antigo.base_por_unidade) !== Number(linha.base_por_unidade) || Number(antigo.aproveitamento_pct) !== Number(linha.aproveitamento_pct)
  // Tudo numa transação (cmv_insumo_salvar, 0142): insumo + componentes + histórico + auditoria.
  const { data: novoId, error } = await c.admin.rpc('cmv_insumo_salvar', {
    p_restaurante: loja, p_id: id, p_linha: linha, p_trocar_componentes: !!(e.preparado || antigo?.preparado), p_componentes: comps,
    p_historico: mudouCusto ? {
      custo_antigo_centavos: antigo ? Number(antigo.custo_compra_centavos) : null, custo_novo_centavos: linha.custo_compra_centavos,
      quantidade_compra: linha.quantidade_compra, base_por_unidade: linha.base_por_unidade, aproveitamento_pct: linha.aproveitamento_pct,
      motivo: e.motivo?.trim()?.slice(0, 300) || null, usuario_id: c.sessao.userId, usuario_nome: c.sessao.nome,
    } : null,
    p_auditoria: {
      usuario_id: c.sessao.userId, usuario_nome: c.sessao.nome, acao: id ? (mudouCusto ? 'cmv.custo_alterado' : 'cmv.insumo_editado') : 'cmv.insumo_criado',
      dados: { nome: linha.nome, custoAntigo: antigo ? Number(antigo.custo_compra_centavos) : null, custoNovo: linha.custo_compra_centavos, motivo: e.motivo ?? null, dispositivo: c.dispositivo },
    },
  })
  if (error) {
    if (/cmv_insumos_nome_uidx|duplicate/.test(error.message)) return falha('Já existe um insumo com esse nome.', 409)
    if (/insumo_nao_encontrado/.test(error.message)) return falha('Insumo não encontrado.', 404)
    throw error
  }
  return { ok: true, valor: { id: novoId as string } }
}

export async function ativarInsumo(c: Ctx, id: string, ativo: boolean): Promise<Res<null>> {
  const loja = c.sessao.restauranteId
  const { data, error } = await c.admin.from('cmv_insumos').update({ ativo, atualizado_em: new Date().toISOString() }).eq('id', id).eq('restaurante_id', loja).select('nome')
  if (error) return falha('Não foi possível alterar.', 500)
  if (!data?.length) return falha('Insumo não encontrado.', 404)
  await registrarAuditoria(c.admin, { restauranteId: loja, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: ativo ? 'cmv.insumo_reativado' : 'cmv.insumo_desativado', entidade: 'insumo', entidadeId: id, dados: { nome: data[0].nome } })
  return { ok: true, valor: null }
}

export async function historicoInsumo(admin: SupabaseClient, loja: string, id: string) {
  const { data: i } = await admin.from('cmv_insumos').select('id, nome').eq('id', id).eq('restaurante_id', loja).maybeSingle()
  if (!i) return null
  const { data } = await admin.from('cmv_custos_historico').select('custo_antigo_centavos, custo_novo_centavos, quantidade_compra, base_por_unidade, aproveitamento_pct, motivo, usuario_nome, criado_em')
    .eq('insumo_id', id).eq('restaurante_id', loja).order('criado_em', { ascending: false }).limit(200)
  return { insumo: i, historico: data ?? [] }
}

// ── Fichas ──────────────────────────────────────────────────────────────────────────────────
/** Confere que o alvo é da loja e devolve o item dono dele (para agrupar). */
async function itemDoAlvo(admin: SupabaseClient, loja: string, tipo: AlvoTipo, id: string, tam: string | null): Promise<string | null | false> {
  const um = async (q: PromiseLike<{ data: unknown }>) => (await q).data as Record<string, unknown> | null
  switch (tipo) {
    case 'item': { const r = await um(admin.from('itens_cardapio').select('id').eq('id', id).eq('restaurante_id', loja).maybeSingle()); return r ? id : false }
    case 'tamanho': { const r = await um(admin.from('tamanhos_item').select('item_id, itens_cardapio!inner(restaurante_id)').eq('id', id).eq('itens_cardapio.restaurante_id', loja).maybeSingle()); return r ? (r.item_id as string) : false }
    case 'complemento': { const r = await um(admin.from('item_complementos').select('item_id, itens_cardapio!inner(restaurante_id)').eq('id', id).eq('itens_cardapio.restaurante_id', loja).maybeSingle()); return r ? (r.item_id as string) : false }
    case 'sabor': {
      if (!tam) return false
      const [s, t] = await Promise.all([
        um(admin.from('pizza_sabores').select('item_id, itens_cardapio!inner(restaurante_id)').eq('id', id).eq('itens_cardapio.restaurante_id', loja).maybeSingle()),
        um(admin.from('tamanhos_padrao_pizza').select('id').eq('id', tam).eq('restaurante_id', loja).maybeSingle()),
      ])
      return s && t ? (s.item_id as string) : false
    }
    case 'borda': { const r = await um(admin.from('bordas_pizza').select('id').eq('id', id).eq('restaurante_id', loja).maybeSingle()); return r ? null : false }
    case 'massa': { const r = await um(admin.from('massas_pizza').select('id').eq('id', id).eq('restaurante_id', loja).maybeSingle()); return r ? null : false }
  }
}

export async function lerFicha(admin: SupabaseClient, loja: string, tipo: AlvoTipo, id: string, tam: string | null) {
  const item = await itemDoAlvo(admin, loja, tipo, id, tam)
  if (item === false) return null
  let q = admin.from('cmv_fichas').select('id, atualizado_em, atualizado_por_nome').eq('restaurante_id', loja).eq('alvo_tipo', tipo).eq('alvo_id', id)
  q = tam ? q.eq('tamanho_padrao_id', tam) : q.is('tamanho_padrao_id', null)
  const { data: f } = await q.maybeSingle()
  const comps = f ? (await admin.from('cmv_ficha_componentes').select('insumo_id, quantidade_base').eq('ficha_id', f.id)).data ?? [] : []
  // Adicionais do produto e (pizza) bordas/massas da loja, cada um com a própria ficha simples.
  const extras: { tipo: AlvoTipo; id: string; nome: string; precoCentavos: number; custoCentavos: number | null }[] = []
  if (item && (tipo === 'item' || tipo === 'tamanho' || tipo === 'sabor')) {
    const [compsItem, insumos, fichas] = await Promise.all([
      admin.from('item_complementos').select('id, nome, preco').eq('item_id', item).order('posicao').then((r) => r.data ?? []),
      listarInsumos(admin, loja),
      admin.from('cmv_fichas').select('id, alvo_tipo, alvo_id').eq('restaurante_id', loja).in('alvo_tipo', ['complemento', 'borda', 'massa']).then((r) => r.data ?? []),
    ])
    const custoIns = new Map(insumos.map((i) => [i.id, i.custoPorBase]))
    const custoDaFicha = async (alvoTipo: string, alvoId: string) => {
      const fx = fichas.find((x) => x.alvo_tipo === alvoTipo && x.alvo_id === alvoId)
      if (!fx) return null
      const cs = (await admin.from('cmv_ficha_componentes').select('insumo_id, quantidade_base').eq('ficha_id', fx.id)).data ?? []
      return centavos(custoFicha(cs.map((x) => ({ quantidadeBase: Number(x.quantidade_base), custoPorBase: custoIns.get(x.insumo_id as string) ?? 0 }))))
    }
    for (const x of compsItem) extras.push({ tipo: 'complemento', id: x.id as string, nome: x.nome as string, precoCentavos: reais(x.preco), custoCentavos: await custoDaFicha('complemento', x.id as string) })
    if (tipo === 'sabor') {
      const [bs, ms] = await Promise.all([
        admin.from('bordas_pizza').select('id, nome, preco').eq('restaurante_id', loja).order('posicao').then((r) => r.data ?? []),
        admin.from('massas_pizza').select('id, nome, preco').eq('restaurante_id', loja).order('posicao').then((r) => r.data ?? []),
      ])
      for (const x of bs) extras.push({ tipo: 'borda', id: x.id as string, nome: 'Borda: ' + (x.nome as string), precoCentavos: reais(x.preco), custoCentavos: await custoDaFicha('borda', x.id as string) })
      for (const x of ms) extras.push({ tipo: 'massa', id: x.id as string, nome: 'Massa: ' + (x.nome as string), precoCentavos: reais(x.preco), custoCentavos: await custoDaFicha('massa', x.id as string) })
    }
  }
  const temFichaPreparo = item ? !!(await admin.from('fichas_preparo').select('item_id').eq('item_id', item).eq('restaurante_id', loja).maybeSingle()).data : false
  return { ficha: f, itemId: item, temFichaPreparo, extras, componentes: comps.map((x) => ({ insumoId: x.insumo_id as string, quantidadeBase: Number(x.quantidade_base) })) }
}

export async function salvarFicha(c: Ctx, tipo: AlvoTipo, id: string, tam: string | null, componentes: { insumoId: string; quantidadeBase: number }[]): Promise<Res<{ fichaId: string }>> {
  const loja = c.sessao.restauranteId
  const item = await itemDoAlvo(c.admin, loja, tipo, id, tam)
  if (item === false) return falha('Produto não encontrado.', 404)
  const comps = componentes.filter((x) => Number.isFinite(x.quantidadeBase) && x.quantidadeBase > 0 && x.quantidadeBase < 1_000_000)
  if (new Set(comps.map((x) => x.insumoId)).size !== comps.length) return falha('Insumo repetido na ficha.')
  if (comps.length) {
    const { data: ok } = await c.admin.from('cmv_insumos').select('id').eq('restaurante_id', loja).in('id', comps.map((x) => x.insumoId))
    if ((ok ?? []).length !== comps.length) return falha('Insumo não encontrado.', 404)
  }
  // Tudo numa transação (cmv_ficha_salvar, 0142): ficha + componentes + auditoria.
  const { data: fichaId, error } = await c.admin.rpc('cmv_ficha_salvar', {
    p_restaurante: loja, p_tipo: tipo, p_alvo: id, p_tamanho: tam, p_item: item, p_componentes: comps,
    p_auditoria: { usuario_id: c.sessao.userId, usuario_nome: c.sessao.nome, dados: { alvo: tipo, alvoId: id, tamanho: tam, componentes: comps.length, dispositivo: c.dispositivo } },
  })
  if (error) return falha('Não foi possível salvar a ficha.', 500)
  return { ok: true, valor: { fichaId: fichaId as string } }
}

/** "Importar ingredientes da ficha de preparo": sugestão (nada é gravado). Casa pelo nome do insumo. */
export async function sugestaoDaFichaDePreparo(admin: SupabaseClient, loja: string, itemId: string) {
  const { data: f } = await admin.from('fichas_preparo').select('ingredientes').eq('item_id', itemId).eq('restaurante_id', loja).maybeSingle()
  if (!f) return null
  const insumos = await listarInsumos(admin, loja)
  const chave = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase()
  return ((f.ingredientes ?? []) as { nome?: string; quantidade?: string }[]).filter((i) => i.nome?.trim()).map((i) => {
    const ins = insumos.find((x) => chave(x.nome) === chave(i.nome!))
    return { nome: i.nome!.trim(), quantidadeTexto: i.quantidade ?? '', insumoId: ins?.id ?? null, quantidadeBase: ins ? lerQuantidadeTexto(i.quantidade ?? '', ins.unidadeBase) : null }
  })
}

// ── Aplicar novo preço (nunca automático) ───────────────────────────────────────────────────
export async function aplicarPreco(c: Ctx, alvo: { tipo: AlvoTipo; id: string; tamanhoId: string | null }, precoAtualCentavos: number, novoCentavos: number): Promise<Res<{ antigo: number; novo: number; slug: string | null }>> {
  const loja = c.sessao.restauranteId
  if (!Number.isSafeInteger(novoCentavos) || novoCentavos <= 0 || novoCentavos > 10_000_000) return falha('Preço inválido.')
  let atual: number | null = null
  let atualizar: () => PromiseLike<{ error: unknown }>
  let itemId: string | null = null
  const novo = novoCentavos / 100
  if (alvo.tipo === 'item') {
    const { data } = await c.admin.from('itens_cardapio').select('id, preco').eq('id', alvo.id).eq('restaurante_id', loja).maybeSingle()
    if (!data) return falha('Produto não encontrado.', 404)
    atual = reais(data.preco); itemId = alvo.id
    atualizar = () => c.admin.from('itens_cardapio').update({ preco: novo }).eq('id', alvo.id).eq('restaurante_id', loja)
  } else if (alvo.tipo === 'tamanho') {
    const { data } = await c.admin.from('tamanhos_item').select('id, preco, item_id, itens_cardapio!inner(restaurante_id)').eq('id', alvo.id).eq('itens_cardapio.restaurante_id', loja).maybeSingle()
    if (!data) return falha('Produto não encontrado.', 404)
    atual = reais(data.preco); itemId = data.item_id as string
    atualizar = () => c.admin.from('tamanhos_item').update({ preco: novo }).eq('id', alvo.id)
  } else if (alvo.tipo === 'sabor' && alvo.tamanhoId) {
    const { data } = await c.admin.from('pizza_sabor_precos').select('id, preco, pizza_sabores!inner(item_id, itens_cardapio!inner(restaurante_id))')
      .eq('sabor_id', alvo.id).eq('tamanho_padrao_id', alvo.tamanhoId).eq('pizza_sabores.itens_cardapio.restaurante_id', loja).maybeSingle()
    if (!data) return falha('Produto não encontrado.', 404)
    atual = reais(data.preco); itemId = (data.pizza_sabores as unknown as { item_id: string }).item_id
    atualizar = () => c.admin.from('pizza_sabor_precos').update({ preco: novo }).eq('id', data.id)
  } else return falha('Este preço não se aplica por aqui.')
  // Concorrência e corpo manipulado: o preço "antigo" tem de ser o do banco agora.
  if (atual !== precoAtualCentavos) return falha('O preço mudou desde que a tela abriu. Atualize e confira de novo.', 409)
  if (novoCentavos === atual) return falha('O preço novo é igual ao atual.')
  const { error } = await atualizar()
  if (error) return falha('Não foi possível aplicar o preço.', 500)
  await registrarAuditoria(c.admin, {
    restauranteId: loja, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'cmv.preco_aplicado', entidade: 'item', entidadeId: itemId,
    dados: { alvo: alvo.tipo, alvoId: alvo.id, tamanho: alvo.tamanhoId, antigoCentavos: atual, novoCentavos, dispositivo: c.dispositivo },
  })
  const { data: r } = await c.admin.from('restaurantes').select('slug').eq('id', loja).maybeSingle()
  return { ok: true, valor: { antigo: atual, novo: novoCentavos, slug: (r?.slug as string) ?? null } }
}

export async function salvarConfig(c: Ctx, cfg: Omit<Config, 'porCategoria'> & { porCategoria?: Record<string, number | null> }): Promise<Res<null>> {
  const loja = c.sessao.restauranteId
  const ok = (v: number, max: number) => Number.isFinite(v) && v >= 0 && v < max
  if (!ok(cfg.margemAlvoPct, 95) || !ok(cfg.margemBaixaPct, 100) || !ok(cfg.custosVariaveisPct, 50) || cfg.margemAlvoPct + cfg.custosVariaveisPct >= 100) return falha('Margens inválidas.')
  if (!['nenhum', '90', '99', '00', '50'].includes(cfg.arredondamento)) return falha('Arredondamento inválido.')
  const { error } = await c.admin.from('cmv_config').upsert({ restaurante_id: loja, margem_alvo_pct: cfg.margemAlvoPct, margem_baixa_pct: cfg.margemBaixaPct, custos_variaveis_pct: cfg.custosVariaveisPct, arredondamento: cfg.arredondamento, atualizado_em: new Date().toISOString() })
  if (error) return falha('Não foi possível salvar.', 500)
  for (const [grupo, pct] of Object.entries(cfg.porCategoria ?? {})) {
    if (!/^[0-9a-f-]{36}$/i.test(grupo)) continue
    const { data: g } = await c.admin.from('grupos_cardapio').select('id').eq('id', grupo).eq('restaurante_id', loja).maybeSingle()
    if (!g) continue
    if (pct === null) await c.admin.from('cmv_config_categoria').delete().eq('restaurante_id', loja).eq('grupo_id', grupo)
    else if (ok(pct, 95)) await c.admin.from('cmv_config_categoria').upsert({ restaurante_id: loja, grupo_id: grupo, margem_alvo_pct: pct })
  }
  await registrarAuditoria(c.admin, { restauranteId: loja, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao: 'cmv.config_alterada', entidade: 'restaurante', entidadeId: loja, dados: { ...cfg } })
  return { ok: true, valor: null }
}

/**
 * CMV REAL de um período: usa o custo GUARDADO em cada linha vendida (pedido_itens_custo), nunca o custo atual.
 * Venda sem custo guardado (antes da Fase 5, ou sem ficha) aparece como "sem custo registrado".
 */
export async function cmvDoPeriodo(admin: SupabaseClient, loja: string, de: string, ate: string) {
  const ini = new Date(`${de}T00:00:00-03:00`).toISOString()
  const fim = new Date(new Date(`${ate}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
  const linhas = await todas<Record<string, unknown>>((a, b) => admin.from('pedido_itens')
    .select('id, quantidade, preco_unitario, cancelado_em, pedidos!inner(restaurante_id, status, criado_em), pedido_itens_custo(situacao, custo_unitario)')
    .eq('pedidos.restaurante_id', loja).neq('pedidos.status', 'cancelado').gte('pedidos.criado_em', ini).lt('pedidos.criado_em', fim).is('cancelado_em', null).range(a, b))
  let vendido = 0, cmv = 0, vendidoComCusto = 0, semCusto = 0, comErro = 0
  for (const l of linhas) {
    const qtd = Number(l.quantidade)
    const venda = Number(l.preco_unitario) * 100 * qtd
    vendido += venda
    const cc = (Array.isArray(l.pedido_itens_custo) ? l.pedido_itens_custo[0] : l.pedido_itens_custo) as { situacao: string; custo_unitario: number | null } | null
    if (!cc || cc.custo_unitario === null || cc.situacao === 'sem_ficha') { semCusto++; if (cc?.situacao === 'erro') comErro++; continue }
    cmv += Number(cc.custo_unitario) * qtd
    vendidoComCusto += venda
  }
  return {
    linhas: linhas.length, vendidoCentavos: Math.round(vendido), cmvCentavos: Math.round(cmv), vendidoComCustoCentavos: Math.round(vendidoComCusto),
    cmvPct: vendidoComCusto > 0 ? (cmv / vendidoComCusto) * 100 : null, semCustoRegistrado: semCusto, comErro,
  }
}
