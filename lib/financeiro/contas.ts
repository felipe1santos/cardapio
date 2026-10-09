import type { SupabaseClient } from '@supabase/supabase-js'
import { registrarAuditoria } from '@/lib/auditoria'
import type { ContextoFin } from './contexto'
import { criarAlerta } from './alertas'
import { podeFin } from './permissoes'
import { conferirAprovacao, saldosDoTurno, turnoAberto, type Aprovacao } from './caixa'
import { faltaNaGavetaParaPagar } from './caixa-regras'
import { formatarCentavos } from './centavos'
import { diferencasPorTurno, vendasDoPeriodo } from './vendas-base'
import { cmvPercentual } from './cmv-pct'
import { naFilaDaGaveta } from './fila-gaveta'
import {
  FORMAS_CONTA, custoCompraNovo, hojeSP, linhasDaBaixa, montarDre, numerosDePedidoCitados, ocorrenciasAGerar,
  periodoAnterior, precisaAprovacaoBaixa, quantidadeNaBase, statusExibido, variacaoPct,
  type CarteiraConta, type FormaConta, type GrupoCategoria, type Recorrencia, type StatusConta, type TipoConta,
} from './contas-regras'

/**
 * Contas a pagar/receber, fornecedores, plano de contas, compras de insumos e DRE (Fase 5b, 0143) — servidor.
 * Tudo filtrado pela loja da SESSÃO; quem fez vem da sessão; valores recalculados aqui. Nada se apaga: conta e
 * compra se cancelam; baixa se estorna (lançamento oposto no livro-caixa).
 */
type Falha = { ok: false; erro: string; status: number; codigo?: string; dados?: Record<string, unknown> }
type Res<T> = { ok: true; valor: T } | Falha
const falha = (erro: string, status = 400, codigo?: string, dados?: Record<string, unknown>): Falha => ({ ok: false, erro, status, codigo, dados })
const UUID = /^[0-9a-f-]{36}$/i
const DATA = /^\d{4}-\d{2}-\d{2}$/

async function auditar(c: ContextoFin, acao: string, entidade: string, id: string | null, dados: Record<string, unknown>) {
  await registrarAuditoria(c.admin, {
    restauranteId: c.sessao.restauranteId, usuarioId: c.sessao.userId, usuarioNome: c.sessao.nome, acao, entidade, entidadeId: id,
    dados: { ...dados, dispositivo: c.dispositivo },
  })
}

/** Linhas do livro-caixa no formato das funções do banco (0143). */
function linhasParaBanco(linhas: ReturnType<typeof linhasDaBaixa>) {
  return linhas.map((l) => ({ carteira: l.carteira, tipo: l.tipo, valor_centavos: l.valorCentavos, forma: l.forma ?? null, entregador_id: l.entregadorId ?? null, referencia_id: l.referenciaId ?? null, dados: l.dados ?? null }))
}

/** Erro conhecido das funções do banco → resposta. */
function erroDoBanco(e: { message?: string } | null): Falha | null {
  const m = e?.message ?? ''
  if (/conta_nao_encontrada|compra_nao_encontrada/.test(m)) return falha('Não encontrada.', 404)
  if (/caixa_fechado/.test(m)) return falha('O caixa está fechado: abra o caixa primeiro.', 409, 'caixa_fechado')
  if (/conta_paga/.test(m)) return falha('Conta paga: estorne a baixa antes.', 409, 'conta_paga')
  if (/conta_fechada|conta_nao_paga/.test(m)) return falha('A conta mudou: abra de novo.', 409, 'conta_fechada')
  if (/compra_paga/.test(m)) return falha('Compra paga com dinheiro do caixa: registre a devolução como reforço no caixa.', 409, 'compra_paga')
  return null
}

async function limites(admin: SupabaseClient, loja: string) {
  const { data } = await admin.from('fin_config').select('limite_saida_centavos, limite_conta_centavos').eq('restaurante_id', loja).maybeSingle()
  return { limiteSaida: Number(data?.limite_saida_centavos ?? 10000), limiteConta: Number(data?.limite_conta_centavos ?? 30000) }
}

// ── plano de contas ─────────────────────────────────────────────────────────────────────────────
export interface Categoria { id: string; nome: string; tipo: TipoConta; grupo: GrupoCategoria; padrao: boolean; ativo: boolean; ordem: number }

export async function listarCategorias(admin: SupabaseClient, loja: string): Promise<Categoria[]> {
  await admin.rpc('fin_categorias_garantir', { p_restaurante: loja })
  const { data, error } = await admin.from('fin_categorias').select('id, nome, tipo, grupo, padrao, ativo, ordem').eq('restaurante_id', loja).order('tipo').order('ordem').order('nome')
  if (error) throw error
  return (data ?? []) as Categoria[]
}

const GRUPOS_DO_TIPO: Record<TipoConta, GrupoCategoria[]> = { pagar: ['despesa', 'insumo'], receber: ['receita', 'fora'] }

export async function salvarCategoria(c: ContextoFin, id: string | null, e: { nome: string; tipo: TipoConta; grupo: GrupoCategoria; ativo?: boolean }): Promise<Res<{ id: string }>> {
  const loja = c.sessao.restauranteId
  const nome = String(e.nome ?? '').trim()
  if (nome.length < 2 || nome.length > 60) return falha('Informe o nome da categoria.')
  if (!['pagar', 'receber'].includes(e.tipo) || !GRUPOS_DO_TIPO[e.tipo]?.includes(e.grupo)) return falha('Tipo ou grupo inválido.')
  if (id) {
    if (!UUID.test(id)) return falha('Categoria não encontrada.', 404)
    const { data: atual } = await c.admin.from('fin_categorias').select('id, nome, tipo, grupo, ativo').eq('id', id).eq('restaurante_id', loja).maybeSingle()
    if (!atual) return falha('Categoria não encontrada.', 404)
    if (atual.tipo !== e.tipo) return falha('Não dá para trocar uma categoria de "a pagar" para "a receber".')
    const { error } = await c.admin.from('fin_categorias').update({ nome, grupo: e.grupo, ativo: e.ativo ?? atual.ativo }).eq('id', id).eq('restaurante_id', loja)
    if (error) return falha(/duplicate|uidx/.test(error.message) ? 'Já existe uma categoria com esse nome.' : 'Não foi possível salvar.', 409)
    await auditar(c, 'contas.categoria_editada', 'categoria', id, { antes: atual, depois: { nome, grupo: e.grupo, ativo: e.ativo ?? atual.ativo } })
    return { ok: true, valor: { id } }
  }
  const { data, error } = await c.admin.from('fin_categorias').insert({ restaurante_id: loja, nome, tipo: e.tipo, grupo: e.grupo }).select('id').single()
  if (error || !data) return falha(/duplicate|uidx/.test(error?.message ?? '') ? 'Já existe uma categoria com esse nome.' : 'Não foi possível criar.', 409)
  await auditar(c, 'contas.categoria_criada', 'categoria', data.id as string, { nome, tipo: e.tipo, grupo: e.grupo })
  return { ok: true, valor: { id: data.id as string } }
}

// ── fornecedores ────────────────────────────────────────────────────────────────────────────────
export async function listarFornecedores(admin: SupabaseClient, loja: string) {
  const { data, error } = await admin.from('fin_fornecedores').select('id, nome, documento, telefone, observacao, ativo').eq('restaurante_id', loja).order('nome')
  if (error) throw error
  return data ?? []
}

export async function salvarFornecedor(c: ContextoFin, id: string | null, e: { nome?: unknown; documento?: unknown; telefone?: unknown; observacao?: unknown; ativo?: unknown }): Promise<Res<{ id: string }>> {
  const loja = c.sessao.restauranteId
  const txt = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const linha = { nome: txt(e.nome, 100) ?? '', documento: txt(e.documento, 20), telefone: txt(e.telefone, 20), observacao: txt(e.observacao, 300) }
  if (linha.nome.length < 2) return falha('Informe o nome do fornecedor.')
  if (id) {
    if (!UUID.test(id)) return falha('Fornecedor não encontrado.', 404)
    const ativo = typeof e.ativo === 'boolean' ? e.ativo : undefined
    const { data, error } = await c.admin.from('fin_fornecedores').update({ ...linha, ...(ativo === undefined ? {} : { ativo }) }).eq('id', id).eq('restaurante_id', loja).select('id')
    if (error) return falha(/duplicate|uidx/.test(error.message) ? 'Já existe um fornecedor com esse nome.' : 'Não foi possível salvar.', 409)
    if (!data?.length) return falha('Fornecedor não encontrado.', 404)
    await auditar(c, 'contas.fornecedor_editado', 'fornecedor', id, { ...linha, ativo })
    return { ok: true, valor: { id } }
  }
  const { data, error } = await c.admin.from('fin_fornecedores').insert({ ...linha, restaurante_id: loja, criado_por_nome: c.sessao.nome }).select('id').single()
  if (error || !data) return falha(/duplicate|uidx/.test(error?.message ?? '') ? 'Já existe um fornecedor com esse nome.' : 'Não foi possível criar.', 409)
  await auditar(c, 'contas.fornecedor_criado', 'fornecedor', data.id as string, linha)
  return { ok: true, valor: { id: data.id as string } }
}

// ── recorrência e alertas de vencimento ─────────────────────────────────────────────────────────
const COLS_CONTA = 'id, tipo, descricao, fornecedor_id, categoria_id, valor_centavos, vencimento, forma_prevista, observacao, anexo_path, anexo_nome, recorrencia, serie_id, recorrencia_encerrada_em, origem, compra_id, status, pago_em, pago_carteira, pago_forma, pago_por_nome, pago_aprovado_por_nome, cancelado_em, cancelado_por_nome, cancelado_motivo, criado_por_nome, criado_em'

/** Gera as próximas contas das séries recorrentes (idempotente: único por série + vencimento). */
export async function gerarRecorrencias(admin: SupabaseClient, loja: string, hoje = hojeSP()): Promise<number> {
  const { data: todas } = await admin.from('fin_contas').select('id, serie_id, vencimento, recorrencia, recorrencia_encerrada_em, tipo, descricao, fornecedor_id, categoria_id, valor_centavos, forma_prevista, observacao, criado_por, criado_por_nome')
    .eq('restaurante_id', loja).not('serie_id', 'is', null)
  let geradas = 0
  const porSerie = new Map<string, { raiz: Record<string, unknown> | null; ultimo: string }>()
  for (const r of todas ?? []) {
    const s = porSerie.get(r.serie_id as string) ?? { raiz: null, ultimo: '' }
    if (r.id === r.serie_id) s.raiz = r
    if ((r.vencimento as string) > s.ultimo) s.ultimo = r.vencimento as string
    porSerie.set(r.serie_id as string, s)
  }
  for (const [serie, s] of porSerie) {
    const raiz = s.raiz
    if (!raiz || raiz.recorrencia === 'nenhuma' || raiz.recorrencia_encerrada_em) continue
    const datas = ocorrenciasAGerar({ raiz: raiz.vencimento as string, recorrencia: raiz.recorrencia as Recorrencia, ultimo: s.ultimo, hoje })
    for (const v of datas) {
      const { error } = await admin.from('fin_contas').insert({
        restaurante_id: loja, tipo: raiz.tipo, descricao: raiz.descricao, fornecedor_id: raiz.fornecedor_id, categoria_id: raiz.categoria_id,
        valor_centavos: raiz.valor_centavos, vencimento: v, forma_prevista: raiz.forma_prevista, observacao: raiz.observacao,
        recorrencia: raiz.recorrencia, serie_id: serie, origem: 'recorrencia', criado_por: raiz.criado_por, criado_por_nome: raiz.criado_por_nome,
        chave_idempotencia: `serie:${serie}:${v}`,
      })
      if (!error) geradas++
      else if (error.code !== '23505') throw error
    }
  }
  return geradas
}

/** Alerta no painel: conta a pagar vencendo hoje/amanhã ou vencida (uma vez por dia por conta). */
export async function alertasDeVencimento(admin: SupabaseClient, loja: string, hoje = hojeSP()): Promise<number> {
  const amanha = new Date(new Date(`${hoje}T12:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
  const { data } = await admin.from('fin_contas').select('id, descricao, valor_centavos, vencimento').eq('restaurante_id', loja).eq('tipo', 'pagar').eq('status', 'a_pagar').lte('vencimento', amanha).order('vencimento').limit(100)
  let n = 0
  for (const k of data ?? []) {
    const vencida = (k.vencimento as string) < hoje
    const quando = vencida ? `venceu em ${(k.vencimento as string).split('-').reverse().join('/')}` : k.vencimento === hoje ? 'vence hoje' : 'vence amanhã'
    const id = await criarAlerta(admin, {
      restauranteId: loja, tipo: vencida ? 'conta_vencida' : 'conta_vencendo', gravidade: 'atencao',
      mensagem: `Conta a pagar ${quando}: ${k.descricao} — ${formatarCentavos(Number(k.valor_centavos))}.`,
      dados: { conta: k.id }, dedupeMin: 20 * 60, dedupeChave: `${k.id}:${vencida ? 'v' : 'p'}`,
    })
    if (id) n++
  }
  return n
}

// ── contas ──────────────────────────────────────────────────────────────────────────────────────
export interface FiltrosContas { tipo?: TipoConta | null; situacao?: 'abertas' | 'vencidas' | 'pagas' | 'canceladas' | 'todas' | null; de?: string | null; ate?: string | null; busca?: string | null }

export async function listarContas(admin: SupabaseClient, loja: string, f: FiltrosContas) {
  const hoje = hojeSP()
  await gerarRecorrencias(admin, loja, hoje)
  let q = admin.from('fin_contas').select(COLS_CONTA).eq('restaurante_id', loja)
  if (f.tipo) q = q.eq('tipo', f.tipo)
  if (f.situacao === 'abertas') q = q.eq('status', 'a_pagar')
  if (f.situacao === 'vencidas') q = q.eq('status', 'a_pagar').lt('vencimento', hoje)
  if (f.situacao === 'pagas') q = q.eq('status', 'pago')
  if (f.situacao === 'canceladas') q = q.eq('status', 'cancelado')
  if (f.de && DATA.test(f.de)) q = q.gte('vencimento', f.de)
  if (f.ate && DATA.test(f.ate)) q = q.lte('vencimento', f.ate)
  const { data, error } = await q.order('vencimento').order('criado_em').limit(1000)
  if (error) throw error
  const [cats, forns] = await Promise.all([listarCategorias(admin, loja), listarFornecedores(admin, loja)])
  const cat = new Map(cats.map((x) => [x.id, x]))
  const forn = new Map(forns.map((x) => [x.id as string, x.nome as string]))
  const busca = f.busca?.trim().toLowerCase() ?? ''
  const contas = (data ?? []).map((k) => ({
    ...k, statusExibido: statusExibido(k.status as StatusConta, k.vencimento as string, hoje),
    categoria: cat.get(k.categoria_id as string)?.nome ?? '—', grupo: cat.get(k.categoria_id as string)?.grupo ?? 'despesa', fornecedor: k.fornecedor_id ? forn.get(k.fornecedor_id as string) ?? '—' : null,
  })).filter((k) => !busca || `${k.descricao} ${k.categoria} ${k.fornecedor ?? ''}`.toLowerCase().includes(busca))
  // Resumo SEM o filtro de situação (o topo da tela mostra o quadro geral do tipo).
  const { data: abertas } = await admin.from('fin_contas').select('tipo, valor_centavos, vencimento').eq('restaurante_id', loja).eq('status', 'a_pagar')
  const resumo = { aPagarCentavos: 0, vencidoCentavos: 0, vencidas: 0, aReceberCentavos: 0, venceHojeCentavos: 0 }
  for (const k of abertas ?? []) {
    const v = Number(k.valor_centavos)
    if (k.tipo === 'receber') { resumo.aReceberCentavos += v; continue }
    resumo.aPagarCentavos += v
    if ((k.vencimento as string) < hoje) { resumo.vencidoCentavos += v; resumo.vencidas++ }
    if (k.vencimento === hoje) resumo.venceHojeCentavos += v
  }
  return { contas, resumo, hoje, saldos: await saldosDasCarteiras(admin, loja) }
}

/** Gaveta do turno aberto e conta da empresa (soma do livro-caixa). */
export async function saldosDasCarteiras(admin: SupabaseClient, loja: string) {
  const turno = await turnoAberto(admin, loja)
  const somar = async (carteira: string, turnoId?: string) => {
    let t = 0
    for (let de = 0; ; de += 1000) {
      let q = admin.from('fin_lancamentos').select('valor_centavos').eq('restaurante_id', loja).eq('carteira', carteira)
      if (turnoId) q = q.eq('turno_id', turnoId)
      const { data, error } = await q.order('id').range(de, de + 999)
      if (error) throw error
      for (const r of data ?? []) t += Number(r.valor_centavos)
      if (!data || data.length < 1000) return t
    }
  }
  return { caixaAberto: !!turno, gavetaCentavos: turno ? await somar('gaveta', turno.id) : null, empresaCentavos: await somar('empresa') }
}

export interface EntradaConta {
  tipo: TipoConta; descricao: string; fornecedorId: string | null; categoriaId: string; valorCentavos: number; vencimento: string
  formaPrevista: FormaConta | null; observacao: string | null; recorrencia: Recorrencia
}

/** Lê do corpo só os campos da conta (nunca loja, status, quem fez). */
export function lerEntradaConta(b: Record<string, unknown> | null): EntradaConta {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    tipo: (b?.tipo === 'receber' ? 'receber' : 'pagar'),
    descricao: s(b?.descricao).trim(),
    fornecedorId: typeof b?.fornecedorId === 'string' && UUID.test(b.fornecedorId) ? b.fornecedorId : null,
    categoriaId: s(b?.categoriaId),
    valorCentavos: Number(b?.valorCentavos),
    vencimento: s(b?.vencimento),
    formaPrevista: (FORMAS_CONTA as readonly string[]).includes(s(b?.formaPrevista)) ? (s(b?.formaPrevista) as FormaConta) : null,
    observacao: s(b?.observacao).trim().slice(0, 500) || null,
    recorrencia: (['mensal', 'semanal'].includes(s(b?.recorrencia)) ? s(b?.recorrencia) : 'nenhuma') as Recorrencia,
  }
}

async function validarConta(admin: SupabaseClient, loja: string, e: EntradaConta): Promise<{ ok: true; categoria: Categoria } | Falha> {
  if (e.descricao.length < 3 || e.descricao.length > 200) return falha('Descreva a conta (mínimo 3 letras).')
  if (!Number.isSafeInteger(e.valorCentavos) || e.valorCentavos <= 0 || e.valorCentavos > 1_000_000_000) return falha('Informe o valor.')
  if (!DATA.test(e.vencimento) || Number.isNaN(Date.parse(e.vencimento))) return falha('Informe o vencimento.')
  if (!UUID.test(e.categoriaId)) return falha('Escolha a categoria.')
  const { data: cat } = await admin.from('fin_categorias').select('id, nome, tipo, grupo, padrao, ativo, ordem').eq('id', e.categoriaId).eq('restaurante_id', loja).maybeSingle()
  if (!cat) return falha('Categoria não encontrada.', 404)
  if (cat.tipo !== e.tipo) return falha(e.tipo === 'pagar' ? 'Essa categoria é de contas a receber.' : 'Essa categoria é de contas a pagar.')
  if (e.fornecedorId) {
    const { data: fo } = await admin.from('fin_fornecedores').select('id').eq('id', e.fornecedorId).eq('restaurante_id', loja).maybeSingle()
    if (!fo) return falha('Fornecedor não encontrado.', 404)
  }
  return { ok: true, categoria: cat as Categoria }
}

/**
 * Venda do sistema lançada à mão: conta a receber numa categoria de venda que cita um pedido (#N) existente ou
 * que tem o mesmo valor de um pedido não cancelado do mesmo dia. Devolve os pedidos suspeitos.
 */
async function vendaJaNoSistema(admin: SupabaseClient, loja: string, e: EntradaConta, categoria: Categoria) {
  const chave = categoria.nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const vazio = { citados: [] as { numero: number; total: number }[], mesmoValor: [] as { numero: number; total: number }[] }
  if (e.tipo !== 'receber' || !chave.startsWith('venda')) return vazio
  const numeros = numerosDePedidoCitados(`${e.descricao} ${e.observacao ?? ''}`)
  if (numeros.length) {
    const { data } = await admin.from('pedidos').select('numero, total').eq('restaurante_id', loja).in('numero', numeros).neq('status', 'cancelado')
    for (const p of data ?? []) vazio.citados.push({ numero: Number(p.numero), total: Math.round(Number(p.total) * 100) })
  }
  const ini = new Date(`${e.vencimento}T00:00:00-03:00`).toISOString()
  const fim = new Date(new Date(`${e.vencimento}T00:00:00-03:00`).getTime() + 86_400_000).toISOString()
  const { data: mesmos } = await admin.from('pedidos').select('numero, total').eq('restaurante_id', loja).neq('status', 'cancelado')
    .gte('criado_em', ini).lt('criado_em', fim).eq('total', e.valorCentavos / 100).limit(5)
  for (const p of mesmos ?? []) if (!vazio.citados.some((a) => a.numero === Number(p.numero))) vazio.mesmoValor.push({ numero: Number(p.numero), total: Math.round(Number(p.total) * 100) })
  return vazio
}

export async function criarConta(c: ContextoFin, e: EntradaConta, chave: string, extra: { liberarVenda?: { justificativa: string; aprovacao?: Aprovacao | null } } = {}): Promise<Res<{ id: string; repetido: boolean; aviso?: string | null }>> {
  const loja = c.sessao.restauranteId
  if (!/^[\w:.-]{8,120}$/.test(chave)) return falha('Chave inválida.')
  const { data: ja } = await c.admin.from('fin_contas').select('id').eq('restaurante_id', loja).eq('chave_idempotencia', `conta:${chave}`).maybeSingle()
  if (ja) return { ok: true, valor: { id: ja.id as string, repetido: true } }
  const v = await validarConta(c.admin, loja, e)
  if (!v.ok) return v
  // Vendas do sistema já estão no livro-caixa: lançar de novo à mão duplicaria o faturamento.
  // Cita o número de um pedido do sistema → BLOQUEIA (liberar só com justificativa + PIN). Só o mesmo valor de um pedido do
  // dia → APENAS AVISA (a conta entra; o aviso volta na resposta e fica na auditoria).
  const { citados: suspeitos, mesmoValor } = await vendaJaNoSistema(c.admin, loja, e, v.categoria)
  let liberadaPor: string | null = null
  if (suspeitos.length) {
    const lista = suspeitos.map((p) => `#${p.numero} (${formatarCentavos(p.total)})`).join(', ')
    const lib = extra.liberarVenda
    if (!lib || (lib.justificativa ?? '').trim().length < 10) {
      return falha(`Esta venda já foi registrada pelo sistema: pedido ${lista}. Vendas do sistema entram sozinhas no caixa — não lance de novo.`, 409, 'venda_duplicada', { pedidos: suspeitos })
    }
    if (c.sessao.papel !== 'dono') {
      if (!lib.aprovacao) return falha('Para lançar mesmo assim, um gerente precisa aprovar com o PIN.', 409, 'aprovacao_necessaria', { pedidos: suspeitos, pedidoRemoto: { acao: 'venda_avulsa_suspeita', valorCentavos: e.valorCentavos, motivo: lib.justificativa } })
      const a = await conferirAprovacao(c.admin, { restauranteId: loja, solicitante: { id: c.sessao.userId, nome: c.sessao.nome }, aprovacao: lib.aprovacao, acao: 'venda_avulsa_suspeita', valorCentavos: e.valorCentavos, motivo: lib.justificativa, contexto: { pedidos: suspeitos } })
      if (!a.ok) return falha(a.erro, a.status, a.codigo)
      // Aprovação pelo celular: usada aqui (uma vez só; o banco recusa a segunda).
      const { error: eU } = await c.admin.rpc('fin_usar_aprovacao', { p_aprovacao: a.id })
      if (eU) return falha('Esta aprovação já foi usada. Peça de novo.', 409, 'usada')
      liberadaPor = a.aprovadorNome
    }
  }
  const id = crypto.randomUUID()
  const { error } = await c.admin.from('fin_contas').insert({
    id, restaurante_id: loja, tipo: e.tipo, descricao: e.descricao, fornecedor_id: e.fornecedorId, categoria_id: e.categoriaId,
    valor_centavos: e.valorCentavos, vencimento: e.vencimento, forma_prevista: e.formaPrevista, observacao: e.observacao,
    recorrencia: e.recorrencia, serie_id: e.recorrencia === 'nenhuma' ? null : id, origem: 'manual',
    criado_por: c.sessao.userId, criado_por_nome: c.sessao.nome, chave_idempotencia: `conta:${chave}`,
  })
  if (error) {
    if (error.code === '23505') {
      const { data: j2 } = await c.admin.from('fin_contas').select('id').eq('restaurante_id', loja).eq('chave_idempotencia', `conta:${chave}`).maybeSingle()
      if (j2) return { ok: true, valor: { id: j2.id as string, repetido: true } }
    }
    throw error
  }
  await auditar(c, 'contas.criou', 'conta', id, { tipo: e.tipo, descricao: e.descricao, valor_centavos: e.valorCentavos, vencimento: e.vencimento, categoria: v.categoria.nome, recorrencia: e.recorrencia })
  if (mesmoValor.length) {
    await auditar(c, 'contas.venda_parecida', 'conta', id, { pedidos: mesmoValor, descricao: e.descricao, valor_centavos: e.valorCentavos })
  }
  if (suspeitos.length) {
    await auditar(c, 'contas.venda_avulsa_liberada', 'conta', id, { pedidos: suspeitos, justificativa: extra.liberarVenda?.justificativa, aprovado_por: liberadaPor })
    await criarAlerta(c.admin, { restauranteId: loja, tipo: 'venda_manual_suspeita', gravidade: 'atencao', usuario: { id: c.sessao.userId, nome: c.sessao.nome },
      mensagem: `${c.sessao.nome} lançou à mão uma venda parecida com pedido(s) do sistema (${suspeitos.map((p) => `#${p.numero}`).join(', ')}): ${e.descricao} — ${formatarCentavos(e.valorCentavos)}.`, dados: { conta: id } })
  }
  if (e.recorrencia !== 'nenhuma') await gerarRecorrencias(c.admin, loja)
  const aviso = mesmoValor.length
    ? `Atenção: o pedido ${mesmoValor.map((p) => `#${p.numero}`).join(', ')} do mesmo dia tem o mesmo valor. Se for venda do sistema, cancele esta entrada — ela já está no caixa.`
    : null
  return { ok: true, valor: { id, repetido: false, aviso } }
}

async function lerConta(admin: SupabaseClient, loja: string, id: string) {
  if (!UUID.test(id)) return null
  const { data } = await admin.from('fin_contas').select(COLS_CONTA + ', pago_grupo_id').eq('id', id).eq('restaurante_id', loja).maybeSingle()
  return data as unknown as (Record<string, unknown> & { status: StatusConta; tipo: TipoConta; valor_centavos: number; categoria_id: string; descricao: string; pago_grupo_id: string | null; pago_carteira: CarteiraConta | null; serie_id: string | null }) | null
}

export async function editarConta(c: ContextoFin, id: string, e: EntradaConta): Promise<Res<null>> {
  const loja = c.sessao.restauranteId
  const atual = await lerConta(c.admin, loja, id)
  if (!atual) return falha('Conta não encontrada.', 404)
  if (atual.status !== 'a_pagar') return falha('Conta paga ou cancelada não se edita. Estorne a baixa antes.', 409, 'conta_fechada')
  const v = await validarConta(c.admin, loja, { ...e, tipo: atual.tipo })
  if (!v.ok) return v
  const novo = { descricao: e.descricao, fornecedor_id: e.fornecedorId, categoria_id: e.categoriaId, valor_centavos: e.valorCentavos, vencimento: e.vencimento, forma_prevista: e.formaPrevista, observacao: e.observacao }
  const { data, error } = await c.admin.from('fin_contas').update(novo).eq('id', id).eq('restaurante_id', loja).eq('status', 'a_pagar').select('id')
  if (error) throw error
  if (!data?.length) return falha('A conta mudou enquanto você editava. Abra de novo.', 409)
  await auditar(c, 'contas.editou', 'conta', id, {
    antes: { descricao: atual.descricao, valor_centavos: atual.valor_centavos, vencimento: atual.vencimento, categoria_id: atual.categoria_id }, depois: novo,
  })
  return { ok: true, valor: null }
}

/** Baixa: marca como paga (ou recebida) e lança no livro-caixa. Gaveta exige caixa aberto. */
/** Baixa com o dinheiro do caixa passa pela fila da gaveta (fila-gaveta.ts): conferir e gravar em sequência. */
export async function baixarConta(c: ContextoFin, id: string, p: { carteira: CarteiraConta; forma: FormaConta; aprovacao?: Aprovacao | null }): Promise<Res<{ aprovadoPor: string | null; repetido: boolean }>> {
  return p.carteira === 'gaveta' ? naFilaDaGaveta(c.sessao.restauranteId, () => baixarContaAgora(c, id, p)) : baixarContaAgora(c, id, p)
}

async function baixarContaAgora(c: ContextoFin, id: string, p: { carteira: CarteiraConta; forma: FormaConta; aprovacao?: Aprovacao | null }): Promise<Res<{ aprovadoPor: string | null; repetido: boolean }>> {
  const loja = c.sessao.restauranteId
  if (!['gaveta', 'empresa'].includes(p.carteira)) return falha('Escolha de onde sai (ou entra) o dinheiro.')
  if (!(FORMAS_CONTA as readonly string[]).includes(p.forma)) return falha('Escolha a forma.')
  const k = await lerConta(c.admin, loja, id)
  if (!k) return falha('Conta não encontrada.', 404)
  if (k.status === 'pago') return { ok: true, valor: { aprovadoPor: (k.pago_aprovado_por_nome as string | null) ?? null, repetido: true } }
  if (k.status !== 'a_pagar') return falha('Conta cancelada.', 409, 'conta_fechada')
  const { data: cat } = await c.admin.from('fin_categorias').select('id, nome, grupo').eq('id', k.categoria_id).eq('restaurante_id', loja).maybeSingle()
  if (!cat) return falha('Categoria não encontrada.', 404)
  const turno = p.carteira === 'gaveta' ? await turnoAberto(c.admin, loja) : null
  if (p.carteira === 'gaveta' && !turno) return falha('Para pagar com dinheiro do caixa, abra o caixa primeiro.', 409, 'caixa_fechado')
  // Pagar com a gaveta só o que há nela (antes do PIN, para não gastar a aprovação).
  if (turno && k.tipo === 'pagar') {
    const falta = faltaNaGavetaParaPagar(Number(k.valor_centavos), (await saldosDoTurno(c.admin, loja, turno.id)).gaveta)
    if (falta) return falha(falta, 409, 'gaveta_insuficiente')
  }
  const lim = await limites(c.admin, loja)
  let aprovacao: { id: string; nome: string } | null = null
  if (precisaAprovacaoBaixa({ tipo: k.tipo, carteira: p.carteira, valor: k.valor_centavos, ...lim, papel: c.sessao.papel })) {
    const limite = p.carteira === 'gaveta' ? lim.limiteSaida : lim.limiteConta
    if (!p.aprovacao) return falha(`Acima de ${formatarCentavos(limite)} precisa da aprovação de um gerente.`, 409, 'aprovacao_necessaria', { limiteCentavos: limite, pedidoRemoto: { acao: 'conta_paga', valorCentavos: k.valor_centavos, motivo: k.descricao } })
    const a = await conferirAprovacao(c.admin, { restauranteId: loja, solicitante: { id: c.sessao.userId, nome: c.sessao.nome }, aprovacao: p.aprovacao, acao: 'conta_paga', valorCentavos: k.valor_centavos, motivo: k.descricao, contexto: { conta: id, carteira: p.carteira } })
    if (!a.ok) return falha(a.erro, a.status, a.codigo)
    aprovacao = { id: a.id, nome: a.aprovadorNome }
  }
  // Cada baixa tem chave própria (n.º de estornos até aqui): clique duplo repete a mesma; depois de um estorno, a nova baixa é outra.
  const { count: estornos } = await c.admin.from('fin_lancamentos').select('id', { count: 'exact', head: true }).eq('restaurante_id', loja).like('chave_idempotencia', `conta:${id}:estorno:%`).eq('linha', 1)
  // Tudo numa transação (fin_conta_baixar, 0143): livro-caixa + status da conta + auditoria.
  const { data, error } = await c.admin.rpc('fin_conta_baixar', {
    p_restaurante: loja, p_conta: id, p_carteira: p.carteira, p_forma: p.forma, p_turno: turno?.id ?? null, p_chave: `conta:${id}:baixa:${estornos ?? 0}`,
    p_linhas: linhasParaBanco(linhasDaBaixa({ tipo: k.tipo, carteira: p.carteira, valor: k.valor_centavos, forma: p.forma, grupo: cat.grupo as GrupoCategoria, categoriaId: cat.id as string, contaId: id, compraId: (k.compra_id as string | null) ?? null })),
    p_usuario: c.sessao.userId, p_usuario_nome: c.sessao.nome, p_aprovacao: aprovacao?.id ?? null, p_aprovado_por: aprovacao?.nome ?? null, p_dispositivo: c.dispositivo,
    p_motivo: `${k.tipo === 'pagar' ? 'Conta paga' : 'Conta recebida'}: ${k.descricao} [${cat.nome}]`,
    p_auditoria: { acao: k.tipo === 'pagar' ? 'contas.pagou' : 'contas.recebeu', dados: { descricao: k.descricao, valor_centavos: k.valor_centavos, carteira: p.carteira, forma: p.forma, categoria: cat.nome, aprovado_por: aprovacao?.nome ?? null, dispositivo: c.dispositivo } },
  })
  if (error) { const f = erroDoBanco(error); if (f) return f; throw error }
  const r = data as { repetido: boolean; aprovado_por: string | null }
  return { ok: true, valor: { aprovadoPor: r.aprovado_por ?? null, repetido: !!r.repetido } }
}

/** Estorno da baixa: lançamento oposto (gaveta exige caixa aberto) e a conta volta para "a pagar". PIN sempre (menos o dono). */
export async function estornarBaixa(c: ContextoFin, id: string, p: { motivo: string; aprovacao?: Aprovacao | null }): Promise<Res<{ aprovadoPor: string | null }>> {
  const loja = c.sessao.restauranteId
  const motivo = (p.motivo ?? '').trim()
  if (motivo.length < 10) return falha('Explique o estorno (mínimo 10 letras).', 400, 'motivo')
  const k = await lerConta(c.admin, loja, id)
  if (!k) return falha('Conta não encontrada.', 404)
  if (k.status !== 'pago' || !k.pago_grupo_id) return falha('Esta conta não está paga.', 409)
  const turno = k.pago_carteira === 'gaveta' ? await turnoAberto(c.admin, loja) : null
  if (k.pago_carteira === 'gaveta' && !turno) return falha('O dinheiro volta para a gaveta: abra o caixa primeiro.', 409, 'caixa_fechado')
  let aprovacao: { id: string; nome: string } | null = null
  if (c.sessao.papel !== 'dono') {
    if (!p.aprovacao) return falha('Estorno precisa da aprovação de um gerente.', 409, 'aprovacao_necessaria', { pedidoRemoto: { acao: 'conta_estorno', valorCentavos: k.valor_centavos, motivo } })
    const a = await conferirAprovacao(c.admin, { restauranteId: loja, solicitante: { id: c.sessao.userId, nome: c.sessao.nome }, aprovacao: p.aprovacao, acao: 'conta_estorno', valorCentavos: k.valor_centavos, motivo, contexto: { conta: id } })
    if (!a.ok) return falha(a.erro, a.status, a.codigo)
    aprovacao = { id: a.id, nome: a.aprovadorNome }
  }
  // Tudo numa transação (fin_conta_estornar, 0143): linhas opostas + conta volta para "a pagar" + auditoria.
  const { error } = await c.admin.rpc('fin_conta_estornar', {
    p_restaurante: loja, p_conta: id, p_turno: turno?.id ?? null, p_usuario: c.sessao.userId, p_usuario_nome: c.sessao.nome,
    p_aprovacao: aprovacao?.id ?? null, p_aprovado_por: aprovacao?.nome ?? null, p_dispositivo: c.dispositivo, p_motivo: `Estorno da baixa: ${k.descricao} — ${motivo}`,
    p_auditoria: { descricao: k.descricao, valor_centavos: k.valor_centavos, motivo, aprovado_por: aprovacao?.nome ?? null, dispositivo: c.dispositivo },
  })
  if (error) { const f = erroDoBanco(error); if (f) return f; throw error }
  await criarAlerta(c.admin, { restauranteId: loja, tipo: 'conta_estornada', gravidade: 'atencao', usuario: { id: c.sessao.userId, nome: c.sessao.nome },
    mensagem: `${c.sessao.nome} estornou a baixa de "${k.descricao}" (${formatarCentavos(k.valor_centavos)}). Motivo: ${motivo}` + (aprovacao ? ` (aprovado por ${aprovacao.nome})` : ''), dados: { conta: id } })
  return { ok: true, valor: { aprovadoPor: aprovacao?.nome ?? null } }
}

/** Cancela (nunca apaga). `serie`: encerra a recorrência e cancela as próximas ainda abertas. */
export async function cancelarConta(c: ContextoFin, id: string, motivo: string, serie = false): Promise<Res<{ canceladas: number }>> {
  const loja = c.sessao.restauranteId
  const m = (motivo ?? '').trim()
  if (m.length < 5) return falha('Diga o motivo do cancelamento.', 400, 'motivo')
  const k = await lerConta(c.admin, loja, id)
  if (!k) return falha('Conta não encontrada.', 404)
  if (k.status === 'pago') return falha('Conta paga: estorne a baixa antes de cancelar.', 409, 'conta_paga')
  if (k.status === 'cancelado' && !serie) return { ok: true, valor: { canceladas: 0 } }
  // Tudo numa transação (fin_conta_cancelar, 0143): conta (+ as próximas da série) + auditoria.
  const { data: n, error } = await c.admin.rpc('fin_conta_cancelar', {
    p_restaurante: loja, p_conta: id, p_serie: serie, p_usuario: c.sessao.userId, p_usuario_nome: c.sessao.nome, p_motivo: m,
    p_auditoria: { descricao: k.descricao, valor_centavos: k.valor_centavos, motivo: m, serie, dispositivo: c.dispositivo },
  })
  if (error) { const f = erroDoBanco(error); if (f) return f; throw error }
  return { ok: true, valor: { canceladas: Number(n ?? 0) } }
}

// ── anexos (bucket privado) ─────────────────────────────────────────────────────────────────────
const TIPOS_ANEXO: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
export const ANEXO_MAX_BYTES = 5 * 1024 * 1024

export async function anexarConta(c: ContextoFin, id: string, bytes: Uint8Array, tipo: string, nome: string): Promise<Res<null>> {
  const loja = c.sessao.restauranteId
  const ext = TIPOS_ANEXO[tipo]
  if (!ext) return falha('Envie PDF, JPG, PNG ou WEBP.', 415)
  if (!bytes.length || bytes.length > ANEXO_MAX_BYTES) return falha('Arquivo vazio ou maior que 5 MB.', 413)
  const k = await lerConta(c.admin, loja, id)
  if (!k) return falha('Conta não encontrada.', 404)
  // Nunca sobrescreve: cada anexo tem caminho próprio; o anterior continua no armazenamento (histórico).
  const caminho = `${loja}/${id}/${Date.now()}.${ext}`
  const { error } = await c.admin.storage.from('financeiro-anexos').upload(caminho, bytes, { contentType: tipo, upsert: false })
  if (error) return falha('Não foi possível guardar o arquivo.', 500)
  const nomeLimpo = nome.replace(/[^\w .()-]/g, '').slice(0, 120) || `anexo.${ext}`
  const { error: e2 } = await c.admin.from('fin_contas').update({ anexo_path: caminho, anexo_nome: nomeLimpo }).eq('id', id).eq('restaurante_id', loja)
  if (e2) throw e2
  await auditar(c, 'contas.anexou', 'conta', id, { arquivo: nomeLimpo, anterior: k.anexo_path ?? null })
  return { ok: true, valor: null }
}

export async function linkDoAnexo(admin: SupabaseClient, loja: string, id: string): Promise<string | null> {
  const k = await lerConta(admin, loja, id)
  if (!k?.anexo_path || !(k.anexo_path as string).startsWith(`${loja}/`)) return null
  const { data } = await admin.storage.from('financeiro-anexos').createSignedUrl(k.anexo_path as string, 60)
  return data?.signedUrl ?? null
}

// ── compras de insumos ──────────────────────────────────────────────────────────────────────────
export interface EntradaCompra {
  fornecedorId: string | null; numeroNota: string | null; dataCompra: string; pagamento: 'a_prazo' | 'caixa' | 'empresa'
  vencimento: string | null; forma: FormaConta; observacao: string | null
  itens: { insumoId: string; quantidade: number; unidade: string; valorCentavos: number }[]
}

export function lerEntradaCompra(b: Record<string, unknown> | null): EntradaCompra {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const itens = Array.isArray(b?.itens) ? (b!.itens as Record<string, unknown>[]).slice(0, 60).map((i) => ({
    insumoId: s(i?.insumoId), quantidade: Number(i?.quantidade), unidade: s(i?.unidade), valorCentavos: Number(i?.valorCentavos),
  })) : []
  return {
    fornecedorId: typeof b?.fornecedorId === 'string' && UUID.test(b.fornecedorId) ? b.fornecedorId : null,
    numeroNota: s(b?.numeroNota).slice(0, 40) || null,
    dataCompra: s(b?.dataCompra) || hojeSP(),
    pagamento: (['a_prazo', 'caixa', 'empresa'].includes(s(b?.pagamento)) ? s(b?.pagamento) : 'a_prazo') as EntradaCompra['pagamento'],
    vencimento: s(b?.vencimento) || null,
    forma: ((FORMAS_CONTA as readonly string[]).includes(s(b?.forma)) ? s(b?.forma) : 'boleto') as FormaConta,
    observacao: s(b?.observacao).slice(0, 500) || null,
    itens,
  }
}

/**
 * Registra a nota: atualiza o custo de cada insumo (histórico com o motivo "Compra"), o que recalcula o CMV de
 * todo produto que usa o insumo; e gera a conta a pagar (a prazo), a conta já paga pela empresa, ou a saída do
 * caixa do turno. Quantidades ficam guardadas na unidade base (estoque futuro).
 */
/** Compra paga com o dinheiro do caixa passa pela fila da gaveta (fila-gaveta.ts). */
export async function registrarCompra(c: ContextoFin, e: EntradaCompra, chave: string, aprov?: Aprovacao | null): Promise<Res<{ id: string; contaId: string | null; repetido: boolean; insumosAtualizados: number }>> {
  return e.pagamento === 'caixa' ? naFilaDaGaveta(c.sessao.restauranteId, () => registrarCompraAgora(c, e, chave, aprov)) : registrarCompraAgora(c, e, chave, aprov)
}

async function registrarCompraAgora(c: ContextoFin, e: EntradaCompra, chave: string, aprov?: Aprovacao | null): Promise<Res<{ id: string; contaId: string | null; repetido: boolean; insumosAtualizados: number }>> {
  const loja = c.sessao.restauranteId
  if (!/^[\w:.-]{8,120}$/.test(chave)) return falha('Chave inválida.')
  const { data: ja } = await c.admin.from('fin_compras').select('id, conta_id').eq('restaurante_id', loja).eq('chave_idempotencia', `compra:${chave}`).maybeSingle()
  if (ja) return { ok: true, valor: { id: ja.id as string, contaId: (ja.conta_id as string | null) ?? null, repetido: true, insumosAtualizados: 0 } }
  if (e.pagamento !== 'a_prazo' && !podeFin(c.sessao.papel, c.acessos, 'contas_marcar_pago')) return falha('Você pode lançar a compra a prazo, mas não dar baixa no pagamento.', 403, 'sem_permissao_acao')
  if (!DATA.test(e.dataCompra)) return falha('Informe a data da compra.')
  if (e.pagamento === 'a_prazo' && (!e.vencimento || !DATA.test(e.vencimento))) return falha('Informe o vencimento da conta.')
  if (!e.itens.length) return falha('Inclua pelo menos um item na nota.')
  for (const i of e.itens) {
    if (!UUID.test(i.insumoId)) return falha('Escolha o insumo de cada item.')
    if (!(i.quantidade > 0) || i.quantidade > 1_000_000) return falha('Quantidade inválida.')
    if (!Number.isSafeInteger(i.valorCentavos) || i.valorCentavos <= 0 || i.valorCentavos > 100_000_000) return falha('Valor do item inválido.')
  }
  const ids = [...new Set(e.itens.map((i) => i.insumoId))]
  const { data: ins } = await c.admin.from('cmv_insumos').select('id, nome, unidade_compra, quantidade_compra, base_por_unidade, unidade_base, custo_compra_centavos, aproveitamento_pct, preparado, ativo')
    .eq('restaurante_id', loja).in('id', ids)
  if ((ins ?? []).length !== ids.length) return falha('Insumo não encontrado.', 404)
  const mapa = new Map((ins ?? []).map((x) => [x.id as string, x]))
  if (e.fornecedorId) {
    const { data: fo } = await c.admin.from('fin_fornecedores').select('id').eq('id', e.fornecedorId).eq('restaurante_id', loja).maybeSingle()
    if (!fo) return falha('Fornecedor não encontrado.', 404)
  }
  // Recalcula tudo aqui: quantidade na base e total da nota.
  const itens: { insumoId: string; quantidade: number; unidade: string; quantidadeBase: number; valorCentavos: number }[] = []
  for (const i of e.itens) {
    const x = mapa.get(i.insumoId)!
    if (x.preparado) return falha(`"${x.nome}" é preparado na casa (sub-receita): não se compra.`)
    const qb = quantidadeNaBase({ unidadeCompra: x.unidade_compra as string, quantidadeCompra: Number(x.quantidade_compra), basePorUnidade: Number(x.base_por_unidade), unidadeBase: x.unidade_base as string, custoCompraCentavos: Number(x.custo_compra_centavos), preparado: false }, i.quantidade, i.unidade)
    if (qb === null) return falha(`Unidade inválida para "${x.nome}": use ${x.unidade_compra} ou ${x.unidade_base}.`)
    itens.push({ ...i, quantidadeBase: qb })
  }
  const total = itens.reduce((s, i) => s + i.valorCentavos, 0)
  if (total > 1_000_000_000) return falha('Total da nota grande demais.')

  const turno = e.pagamento === 'caixa' ? await turnoAberto(c.admin, loja) : null
  if (e.pagamento === 'caixa' && !turno) return falha('Para pagar com dinheiro do caixa, abra o caixa primeiro.', 409, 'caixa_fechado')
  if (turno) {
    const falta = faltaNaGavetaParaPagar(total, (await saldosDoTurno(c.admin, loja, turno.id)).gaveta)
    if (falta) return falha(falta, 409, 'gaveta_insuficiente')
  }
  const lim = await limites(c.admin, loja)
  let aprovacao: { id: string; nome: string } | null = null
  if (e.pagamento !== 'a_prazo' && precisaAprovacaoBaixa({ tipo: 'pagar', carteira: e.pagamento === 'caixa' ? 'gaveta' : 'empresa', valor: total, ...lim, papel: c.sessao.papel })) {
    const limite = e.pagamento === 'caixa' ? lim.limiteSaida : lim.limiteConta
    if (!aprov) return falha(`Acima de ${formatarCentavos(limite)} precisa da aprovação de um gerente.`, 409, 'aprovacao_necessaria', { limiteCentavos: limite, totalCentavos: total, pedidoRemoto: { acao: 'compra_paga', valorCentavos: total } })
    const a = await conferirAprovacao(c.admin, { restauranteId: loja, solicitante: { id: c.sessao.userId, nome: c.sessao.nome }, aprovacao: aprov, acao: 'compra_paga', valorCentavos: total, motivo: `Compra ${e.numeroNota ?? ''}`.trim(), contexto: { pagamento: e.pagamento } })
    if (!a.ok) return falha(a.erro, a.status, a.codigo)
    aprovacao = { id: a.id, nome: a.aprovadorNome }
  }
  await c.admin.rpc('fin_categorias_garantir', { p_restaurante: loja })
  const { data: catIns } = await c.admin.from('fin_categorias').select('id, nome').eq('restaurante_id', loja).eq('tipo', 'pagar').eq('grupo', 'insumo').eq('ativo', true).order('ordem').limit(1).maybeSingle()
  if (!catIns) return falha('Crie uma categoria de insumos no plano de contas.', 409)

  const compraId = crypto.randomUUID()
  // Custo novo por insumo (itens do mesmo insumo somam).
  const porInsumo = new Map<string, { base: number; valor: number }>()
  for (const i of itens) {
    const t = porInsumo.get(i.insumoId) ?? { base: 0, valor: 0 }
    t.base += i.quantidadeBase; t.valor += i.valorCentavos
    porInsumo.set(i.insumoId, t)
  }
  const custoNovo = new Map<string, number>()
  for (const [id, t] of porInsumo) {
    const x = mapa.get(id)!
    custoNovo.set(id, custoCompraNovo({ unidadeCompra: x.unidade_compra as string, quantidadeCompra: Number(x.quantidade_compra), basePorUnidade: Number(x.base_por_unidade), unidadeBase: x.unidade_base as string, custoCompraCentavos: Number(x.custo_compra_centavos), preparado: false }, t.base, t.valor))
  }
  const fornNome = e.fornecedorId ? ((await c.admin.from('fin_fornecedores').select('nome').eq('id', e.fornecedorId).maybeSingle()).data?.nome as string | undefined) : undefined
  const descricao = `Compra de insumos${e.numeroNota ? ` — nota ${e.numeroNota}` : ''}${fornNome ? ` (${fornNome})` : ''}`.slice(0, 200)
  const contaId = e.pagamento === 'caixa' ? null : crypto.randomUUID()
  const linhas = e.pagamento === 'caixa'
    ? linhasDaBaixa({ tipo: 'pagar', carteira: 'gaveta', valor: total, forma: 'dinheiro', grupo: 'insumo', categoriaId: catIns.id as string, compraId })
    : e.pagamento === 'empresa' ? linhasDaBaixa({ tipo: 'pagar', carteira: 'empresa', valor: total, forma: e.forma, grupo: 'insumo', categoriaId: catIns.id as string, contaId, compraId }) : []
  // Tudo numa transação (fin_compra_registrar, 0143): nota + itens + conta/baixa ou saída do caixa + custo e histórico + auditoria.
  const { data, error } = await c.admin.rpc('fin_compra_registrar', { p_restaurante: loja, p: {
    id: compraId, chave: `compra:${chave}`, fornecedor_id: e.fornecedorId, numero_nota: e.numeroNota, data_compra: e.dataCompra, total_centavos: total, pagamento: e.pagamento,
    observacao: e.observacao, usuario_id: c.sessao.userId, usuario_nome: c.sessao.nome, dispositivo: c.dispositivo,
    aprovacao_id: aprovacao?.id ?? null, aprovado_por: aprovacao?.nome ?? null, turno_id: turno?.id ?? null,
    motivo: e.pagamento === 'empresa' ? `Conta paga: ${descricao} [${catIns.nome}]` : `${descricao} [${catIns.nome}]`,
    linhas: linhasParaBanco(linhas),
    conta: contaId ? { id: contaId, descricao, categoria_id: catIns.id, vencimento: e.pagamento === 'a_prazo' ? e.vencimento : e.dataCompra, forma: e.forma } : null,
    itens: itens.map((i) => ({ insumo_id: i.insumoId, quantidade: i.quantidade, unidade: i.unidade, quantidade_base: i.quantidadeBase, valor_centavos: i.valorCentavos,
      custo_anterior_centavos: Number(mapa.get(i.insumoId)!.custo_compra_centavos), custo_novo_centavos: custoNovo.get(i.insumoId)! })),
    custos: [...custoNovo].filter(([id, novo]) => novo !== Number(mapa.get(id)!.custo_compra_centavos)).map(([id, novo]) => {
      const x = mapa.get(id)!
      return { insumo_id: id, custo_antigo_centavos: Number(x.custo_compra_centavos), custo_novo_centavos: novo, quantidade_compra: x.quantidade_compra, base_por_unidade: x.base_por_unidade, aproveitamento_pct: x.aproveitamento_pct }
    }),
    motivo_historico: `Compra${e.numeroNota ? ` nota ${e.numeroNota}` : ''}${fornNome ? ` — ${fornNome}` : ''}`,
    auditoria: { nota: e.numeroNota, fornecedor: fornNome ?? null, total_centavos: total, pagamento: e.pagamento, itens: itens.length, aprovado_por: aprovacao?.nome ?? null, dispositivo: c.dispositivo },
  } })
  if (error) { const f = erroDoBanco(error); if (f) return f; throw error }
  const r = data as { id: string; conta_id: string | null; repetido: boolean; atualizados: number }
  return { ok: true, valor: { id: r.id, contaId: r.conta_id ?? null, repetido: !!r.repetido, insumosAtualizados: Number(r.atualizados ?? 0) } }
}

export async function listarCompras(admin: SupabaseClient, loja: string) {
  const { data, error } = await admin.from('fin_compras').select('id, numero_nota, data_compra, total_centavos, pagamento, status, conta_id, criado_por_nome, criado_em, fornecedor_id, fin_fornecedores(nome), fin_compra_itens(quantidade, unidade, valor_centavos, custo_anterior_centavos, custo_novo_centavos, cmv_insumos(nome))')
    .eq('restaurante_id', loja).order('criado_em', { ascending: false }).limit(200)
  if (error) throw error
  return data ?? []
}

/** Cancela a compra a prazo ainda não paga (cancela a conta junto). O custo do insumo NÃO volta sozinho. */
export async function cancelarCompra(c: ContextoFin, id: string, motivo: string): Promise<Res<null>> {
  const loja = c.sessao.restauranteId
  const m = (motivo ?? '').trim()
  if (m.length < 5) return falha('Diga o motivo.', 400, 'motivo')
  if (!UUID.test(id)) return falha('Compra não encontrada.', 404)
  // Tudo numa transação (fin_compra_cancelar, 0143): compra + conta + auditoria.
  const { error } = await c.admin.rpc('fin_compra_cancelar', { p_restaurante: loja, p_compra: id, p_usuario: c.sessao.userId, p_usuario_nome: c.sessao.nome, p_motivo: m, p_dispositivo: c.dispositivo })
  if (error) { const f = erroDoBanco(error); if (f) return f; throw error }
  return { ok: true, valor: null }
}

// ── DRE ─────────────────────────────────────────────────────────────────────────────────────────
async function drePeriodo(admin: SupabaseClient, loja: string, de: string, ate: string, cats: Categoria[]) {
  // CMV na mesma base do faturamento: só as vendas que estão no livro-caixa do período (0145).
  const [{ data, error }, cmv] = await Promise.all([admin.rpc('fin_dre_periodo', { p_restaurante: loja, p_de: de, p_ate: ate }), vendasDoPeriodo(admin, loja, de, ate)])
  if (error) throw error
  const linhas = (data ?? []) as { chave: string; tipo: string | null; categoria_id: string | null; valor_centavos: number }[]
  const fat = Number(linhas.find((l) => l.chave === 'faturamento')?.valor_centavos ?? 0)
  const resultado = linhas.filter((l) => l.chave === 'resultado').map((l) => ({ tipo: l.tipo ?? '', categoriaId: l.categoria_id, valorCentavos: Number(l.valor_centavos) }))
  return { dre: montarDre({ faturamento: fat, cmv: cmv.cmvCentavos, resultado, categorias: cats }), cmv, resultadoLedgerCentavos: resultado.reduce((s, l) => s + l.valorCentavos, 0) }
}

export async function dre(admin: SupabaseClient, loja: string, de: string, ate: string) {
  if (!DATA.test(de) || !DATA.test(ate) || de > ate) throw Object.assign(new Error('Período inválido.'), { status: 400 })
  const cats = await listarCategorias(admin, loja)
  const ant = periodoAnterior(de, ate)
  const [atual, anterior, turnos] = await Promise.all([drePeriodo(admin, loja, de, ate, cats), drePeriodo(admin, loja, ant.de, ant.ate, cats), diferencasPorTurno(admin, loja, de, ate)])
  const v = (k: 'faturamentoCentavos' | 'cmvCentavos' | 'lucroBrutoCentavos' | 'despesasCentavos' | 'lucroLiquidoCentavos' | 'outrasReceitasCentavos' | 'diferencasCaixaCentavos') => variacaoPct(atual.dre[k], anterior.dre[k])
  return {
    periodo: { de, ate }, anterior: { ...ant, dre: anterior.dre },
    atual: atual.dre,
    variacao: {
      faturamento: v('faturamentoCentavos'), cmv: v('cmvCentavos'), lucroBruto: v('lucroBrutoCentavos'), despesas: v('despesasCentavos'), lucroLiquido: v('lucroLiquidoCentavos'),
      outrasReceitas: v('outrasReceitasCentavos'), diferencasCaixa: v('diferencasCaixaCentavos'),
    },
    cmv: {
      semCustoRegistrado: atual.cmv.semCustoRegistrado, comErro: atual.cmv.comErro, linhas: atual.cmv.linhas,
      // % do CMV sobre as vendas COM custo gravado (cmv-pct.ts): a coluna "% do fat." do DRE continua sobre o faturamento.
      ...cmvPercentual({
        cmvCentavos: atual.cmv.cmvCentavos,
        vendidoComCustoCentavos: Math.round(atual.cmv.porItem.reduce((t, i) => t + i.receitaComCusto, 0)),
        vendidoCentavos: Math.round(atual.cmv.porItem.reduce((t, i) => t + i.receita, 0)),
      }),
    },
    diferencasPorTurno: turnos,
    conciliacao: atual.cmv.conciliacao,
    conferencia: { resultadoLedgerCentavos: atual.resultadoLedgerCentavos },
  }
}
