import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTelefone } from './clientes'
import {
  podeResgatarHoje,
  resumoProgresso,
  type CampanhaFidelidade,
  type HistoricoCliente,
  type ProgressoCliente,
} from '@/lib/fidelidade-regras'

// ─── Campanhas de fidelidade (admin) ───────────────────────────────────────

export interface CampanhaFidelidadeInput {
  nome: string
  descricao?: string
  ativa?: boolean
  tipoMeta: 'valor_gasto' | 'qtd_pedidos' | 'qtd_itens'
  metaValor?: number | null
  metaQuantidade?: number | null
  diasSemanaContam?: number[]
  diasSemanaResgate?: number[]
  premioTipo: 'item_gratis' | 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis'
  premioItemId?: string | null
  premioValor?: number | null
  repetivel?: boolean
}

export interface CampanhaFidelidadeComStats extends CampanhaFidelidade {
  premioItemNome?: string
  premioItemImagemUrl?: string | null
  clientesProgredindo: number
  recompensasGanhas: number
  recompensasResgatadas: number
}

// ─── Cupons (admin) ─────────────────────────────────────────────────────────

export interface CupomInput {
  codigo: string
  descricao?: string
  ativo?: boolean
  tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis'
  valor?: number | null
  itemId?: string | null
  publico?: 'todos' | 'primeira_compra' | 'recompra'
  diasInatividade?: number | null
  diasSemana?: number[]
  validadeInicio?: string | null
  validadeFim?: string | null
  valorMinimoPedido?: number | null
  usoUnicoPorCliente?: boolean
  maxUsos?: number | null
}

export interface Cupom {
  id: string
  codigo: string
  descricao: string
  ativo: boolean
  tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis'
  valor: number | null
  itemId: string | null
  publico: 'todos' | 'primeira_compra' | 'recompra'
  diasInatividade: number | null
  diasSemana: number[]
  validadeInicio: string | null
  validadeFim: string | null
  valorMinimoPedido: number | null
  usoUnicoPorCliente: boolean
  maxUsos: number | null
  usos: number
  criadoEm: string
}

export interface CupomComStats extends Cupom {
  itemNome?: string
  itemImagemUrl?: string | null
  usosRestantes: number | null
}

// ─── Vitrine ────────────────────────────────────────────────────────────────

export interface RecompensaDisponivel {
  id: string
  campanhaId: string
  campanhaNome: string
  premioTipo: CampanhaFidelidade['premioTipo']
  premioValor: number | null
  premioItemNome?: string
  premioItemImagemUrl?: string | null
  diasSemanaResgate: number[]
  podeResgatarHoje: boolean
  ganhoEm: string
}

export interface CupomVitrine {
  id: string
  codigo: string
  descricao: string
  tipo: Cupom['tipo']
  valor: number | null
  itemNome?: string
  itemImagemUrl?: string | null
  valorMinimoPedido: number | null
  validadeFim: string | null
}

export interface FidelidadeCliente {
  campanhas: {
    campanha: CampanhaFidelidade & { premioItemNome?: string; premioItemImagemUrl?: string | null }
    progresso: ProgressoCliente
    resumo: { faltaTexto: string; percentual: number }
  }[]
  recompensas: RecompensaDisponivel[]
  cuponsPublicos: CupomVitrine[]
}

// ─── Motor (helpers de apoio — a orquestração fica em lib/fidelidade.ts) ───

export interface PedidoFidelidadeInfo {
  id: string
  restauranteId: string
  clienteTelefone: string | null
  origem: 'cardapio' | 'pdv'
  subtotal: number
  qtdItens: number
  criadoEm: string
}

// ─── Mapeamento (snake_case → camelCase) ────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCampanha(row: any): CampanhaFidelidade {
  return {
    id: row.id,
    nome: row.nome,
    descricao: row.descricao,
    ativa: row.ativa,
    tipoMeta: row.tipo_meta,
    metaValor: row.meta_valor != null ? Number(row.meta_valor) : null,
    metaQuantidade: row.meta_quantidade ?? null,
    diasSemanaContam: row.dias_semana_contam ?? [],
    diasSemanaResgate: row.dias_semana_resgate ?? [],
    premioTipo: row.premio_tipo,
    premioItemId: row.premio_item_id,
    premioValor: row.premio_valor != null ? Number(row.premio_valor) : null,
    repetivel: row.repetivel,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCupom(row: any): Cupom {
  return {
    id: row.id,
    codigo: row.codigo,
    descricao: row.descricao,
    ativo: row.ativo,
    tipo: row.tipo,
    valor: row.valor != null ? Number(row.valor) : null,
    itemId: row.item_id,
    publico: row.publico,
    diasInatividade: row.dias_inatividade ?? null,
    diasSemana: row.dias_semana ?? [],
    validadeInicio: row.validade_inicio,
    validadeFim: row.validade_fim,
    valorMinimoPedido: row.valor_minimo_pedido != null ? Number(row.valor_minimo_pedido) : null,
    usoUnicoPorCliente: row.uso_unico_por_cliente,
    maxUsos: row.max_usos,
    usos: row.usos,
    criadoEm: row.criado_em,
  }
}

// ─── Validação de input (padrão campanhas: throw new Error em pt-BR) ──────

function validarCampanhaInput(input: CampanhaFidelidadeInput): void {
  if (!input.nome?.trim()) throw new Error('Informe o nome da campanha.')

  if (input.tipoMeta === 'valor_gasto') {
    if (!(Number(input.metaValor) > 0)) throw new Error('Informe uma meta de valor gasto maior que zero.')
  } else {
    if (!Number.isInteger(Number(input.metaQuantidade)) || !(Number(input.metaQuantidade) > 0)) {
      throw new Error('Informe uma meta de quantidade maior que zero.')
    }
  }

  if (input.premioTipo === 'desconto_percentual' || input.premioTipo === 'desconto_valor') {
    if (!(Number(input.premioValor) > 0)) throw new Error('Informe o valor do prêmio (desconto) maior que zero.')
    if (input.premioTipo === 'desconto_percentual' && Number(input.premioValor) > 100) {
      throw new Error('O desconto percentual do prêmio não pode passar de 100%.')
    }
  }

  if (input.premioTipo === 'item_gratis' && !input.premioItemId) {
    throw new Error('Selecione o item que será dado de graça.')
  }
}

function normalizarCodigoCupom(codigo: string): string {
  return (codigo ?? '').trim().toUpperCase().replace(/\s+/g, '')
}

function validarCupomInput(input: CupomInput, codigo: string): void {
  if (!codigo) throw new Error('Informe o código do cupom.')

  if (input.tipo === 'desconto_percentual' || input.tipo === 'desconto_valor') {
    if (!(Number(input.valor) > 0)) throw new Error('Informe o valor do cupom maior que zero.')
    if (input.tipo === 'desconto_percentual' && Number(input.valor) > 100) {
      throw new Error('O desconto percentual do cupom não pode passar de 100%.')
    }
  }

  if (input.tipo === 'item_gratis' && !input.itemId) {
    throw new Error('Selecione o item que o cupom vai dar de graça.')
  }
}

// ─── Data/hora em America/Sao_Paulo (sem depender do fuso do servidor) ────

function hojeSaoPaulo(): { hojeISO: string; diaSemana: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date())
  const mapa: Record<string, string> = {}
  for (const parte of partes) mapa[parte.type] = parte.value
  const diaDaSemanaPorNome: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    hojeISO: `${mapa.year}-${mapa.month}-${mapa.day}`,
    diaSemana: diaDaSemanaPorNome[mapa.weekday] ?? new Date().getDay(),
  }
}

// ─── Selects ────────────────────────────────────────────────────────────────

const CAMPANHA_SELECT = `
  id, restaurante_id, nome, descricao, ativa, tipo_meta, meta_valor, meta_quantidade,
  dias_semana_contam, dias_semana_resgate, premio_tipo, premio_item_id, premio_valor,
  repetivel, criado_em, atualizado_em,
  itens_cardapio ( nome, imagem_url )
`

const CUPOM_SELECT = `
  id, restaurante_id, codigo, descricao, ativo, tipo, valor, item_id, publico, dias_inatividade,
  dias_semana, validade_inicio, validade_fim, valor_minimo_pedido, uso_unico_por_cliente,
  max_usos, usos, criado_em, atualizado_em,
  itens_cardapio ( nome, imagem_url )
`

// ─── CRUD: Campanhas de fidelidade ─────────────────────────────────────────

export async function listarCampanhasFidelidade(admin: SupabaseClient, restauranteId: string): Promise<CampanhaFidelidadeComStats[]> {
  const [
    { data: campanhas, error: campanhasError },
    { data: progresso, error: progressoError },
    { data: recompensas, error: recompensasError },
  ] = await Promise.all([
    admin.from('campanhas_fidelidade').select(CAMPANHA_SELECT).eq('restaurante_id', restauranteId).order('criado_em', { ascending: false }),
    admin.from('fidelidade_progresso').select('campanha_id').eq('restaurante_id', restauranteId),
    admin.from('fidelidade_recompensas').select('campanha_id, status').eq('restaurante_id', restauranteId),
  ])
  if (campanhasError) throw campanhasError
  if (progressoError) throw progressoError
  if (recompensasError) throw recompensasError

  const clientesPorCampanha = new Map<string, number>()
  for (const p of progresso ?? []) {
    clientesPorCampanha.set(p.campanha_id, (clientesPorCampanha.get(p.campanha_id) ?? 0) + 1)
  }

  const ganhasPorCampanha = new Map<string, number>()
  const resgatadasPorCampanha = new Map<string, number>()
  for (const r of recompensas ?? []) {
    if (r.status !== 'cancelado') ganhasPorCampanha.set(r.campanha_id, (ganhasPorCampanha.get(r.campanha_id) ?? 0) + 1)
    if (r.status === 'resgatado') resgatadasPorCampanha.set(r.campanha_id, (resgatadasPorCampanha.get(r.campanha_id) ?? 0) + 1)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (campanhas ?? []).map((row: any) => ({
    ...mapCampanha(row),
    premioItemNome: row.itens_cardapio?.nome,
    premioItemImagemUrl: row.itens_cardapio?.imagem_url ?? null,
    clientesProgredindo: clientesPorCampanha.get(row.id) ?? 0,
    recompensasGanhas: ganhasPorCampanha.get(row.id) ?? 0,
    recompensasResgatadas: resgatadasPorCampanha.get(row.id) ?? 0,
  }))
}

export async function criarCampanhaFidelidade(admin: SupabaseClient, restauranteId: string, input: CampanhaFidelidadeInput): Promise<CampanhaFidelidade> {
  validarCampanhaInput(input)
  const { data, error } = await admin
    .from('campanhas_fidelidade')
    .insert({
      restaurante_id: restauranteId,
      nome: input.nome.trim(),
      descricao: input.descricao?.trim() ?? '',
      ativa: input.ativa ?? true,
      tipo_meta: input.tipoMeta,
      meta_valor: input.tipoMeta === 'valor_gasto' ? input.metaValor : null,
      meta_quantidade: input.tipoMeta === 'valor_gasto' ? null : input.metaQuantidade,
      dias_semana_contam: input.diasSemanaContam ?? [],
      dias_semana_resgate: input.diasSemanaResgate ?? [],
      premio_tipo: input.premioTipo,
      premio_item_id: input.premioTipo === 'item_gratis' ? input.premioItemId : null,
      premio_valor: input.premioTipo === 'desconto_percentual' || input.premioTipo === 'desconto_valor' ? input.premioValor : null,
      repetivel: input.repetivel ?? true,
    })
    .select(CAMPANHA_SELECT)
    .single()
  if (error) throw error
  return mapCampanha(data)
}

export async function atualizarCampanhaFidelidade(admin: SupabaseClient, restauranteId: string, id: string, input: CampanhaFidelidadeInput): Promise<CampanhaFidelidade> {
  validarCampanhaInput(input)
  const { data, error } = await admin
    .from('campanhas_fidelidade')
    .update({
      nome: input.nome.trim(),
      descricao: input.descricao?.trim() ?? '',
      ativa: input.ativa ?? true,
      tipo_meta: input.tipoMeta,
      meta_valor: input.tipoMeta === 'valor_gasto' ? input.metaValor : null,
      meta_quantidade: input.tipoMeta === 'valor_gasto' ? null : input.metaQuantidade,
      dias_semana_contam: input.diasSemanaContam ?? [],
      dias_semana_resgate: input.diasSemanaResgate ?? [],
      premio_tipo: input.premioTipo,
      premio_item_id: input.premioTipo === 'item_gratis' ? input.premioItemId : null,
      premio_valor: input.premioTipo === 'desconto_percentual' || input.premioTipo === 'desconto_valor' ? input.premioValor : null,
      repetivel: input.repetivel ?? true,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .select(CAMPANHA_SELECT)
    .single()
  if (error) throw error
  return mapCampanha(data)
}

export async function excluirCampanhaFidelidade(admin: SupabaseClient, restauranteId: string, id: string): Promise<void> {
  const { error } = await admin.from('campanhas_fidelidade').delete().eq('id', id).eq('restaurante_id', restauranteId)
  if (error) throw error
}

// ─── CRUD: Cupons ───────────────────────────────────────────────────────────

export async function listarCupons(admin: SupabaseClient, restauranteId: string): Promise<CupomComStats[]> {
  const { data, error } = await admin
    .from('cupons')
    .select(CUPOM_SELECT)
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: false })
  if (error) throw error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => ({
    ...mapCupom(row),
    itemNome: row.itens_cardapio?.nome,
    itemImagemUrl: row.itens_cardapio?.imagem_url ?? null,
    usosRestantes: row.max_usos != null ? Math.max(0, row.max_usos - row.usos) : null,
  }))
}

export async function criarCupom(admin: SupabaseClient, restauranteId: string, input: CupomInput): Promise<Cupom> {
  const codigo = normalizarCodigoCupom(input.codigo)
  validarCupomInput(input, codigo)
  const { data, error } = await admin
    .from('cupons')
    .insert({
      restaurante_id: restauranteId,
      codigo,
      descricao: input.descricao?.trim() ?? '',
      ativo: input.ativo ?? true,
      tipo: input.tipo,
      valor: input.tipo === 'entrega_gratis' ? null : input.valor,
      item_id: input.tipo === 'item_gratis' ? input.itemId : null,
      publico: input.publico ?? 'todos',
      dias_inatividade: input.publico === 'recompra' ? input.diasInatividade ?? null : null,
      dias_semana: input.diasSemana ?? [],
      validade_inicio: input.validadeInicio ?? null,
      validade_fim: input.validadeFim ?? null,
      valor_minimo_pedido: input.valorMinimoPedido ?? null,
      uso_unico_por_cliente: input.usoUnicoPorCliente ?? true,
      max_usos: input.maxUsos ?? null,
    })
    .select(CUPOM_SELECT)
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Já existe um cupom com este código.')
    throw error
  }
  return mapCupom(data)
}

export async function atualizarCupom(admin: SupabaseClient, restauranteId: string, id: string, input: CupomInput): Promise<Cupom> {
  const codigo = normalizarCodigoCupom(input.codigo)
  validarCupomInput(input, codigo)
  const { data, error } = await admin
    .from('cupons')
    .update({
      codigo,
      descricao: input.descricao?.trim() ?? '',
      ativo: input.ativo ?? true,
      tipo: input.tipo,
      valor: input.tipo === 'entrega_gratis' ? null : input.valor,
      item_id: input.tipo === 'item_gratis' ? input.itemId : null,
      publico: input.publico ?? 'todos',
      dias_inatividade: input.publico === 'recompra' ? input.diasInatividade ?? null : null,
      dias_semana: input.diasSemana ?? [],
      validade_inicio: input.validadeInicio ?? null,
      validade_fim: input.validadeFim ?? null,
      valor_minimo_pedido: input.valorMinimoPedido ?? null,
      uso_unico_por_cliente: input.usoUnicoPorCliente ?? true,
      max_usos: input.maxUsos ?? null,
      atualizado_em: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .select(CUPOM_SELECT)
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Já existe um cupom com este código.')
    throw error
  }
  return mapCupom(data)
}

export async function excluirCupom(admin: SupabaseClient, restauranteId: string, id: string): Promise<void> {
  const { error } = await admin.from('cupons').delete().eq('id', id).eq('restaurante_id', restauranteId)
  if (error) throw error
}

// ─── Vitrine ────────────────────────────────────────────────────────────────

/**
 * Progresso/prêmios/cupons visíveis pro cliente na aba Cupons da vitrine.
 * `telefoneInformado` pode vir em qualquer formatação — é normalizado antes de consultar.
 */
export async function buscarFidelidadeCliente(admin: SupabaseClient, restauranteId: string, telefoneInformado: string): Promise<FidelidadeCliente> {
  const telefone = normalizarTelefone(telefoneInformado)
  const { hojeISO, diaSemana } = hojeSaoPaulo()

  const [
    { data: campanhasRows, error: campanhasError },
    { data: recompensasRows, error: recompensasError },
    { data: cuponsRows, error: cuponsError },
  ] = await Promise.all([
    admin.from('campanhas_fidelidade').select(CAMPANHA_SELECT).eq('restaurante_id', restauranteId).eq('ativa', true).order('criado_em', { ascending: true }),
    admin
      .from('fidelidade_recompensas')
      .select(
        `id, campanha_id, ganho_em,
         campanhas_fidelidade ( nome, premio_tipo, premio_valor, dias_semana_resgate, itens_cardapio ( nome, imagem_url ) )`
      )
      .eq('restaurante_id', restauranteId)
      .eq('cliente_telefone', telefone)
      .eq('status', 'disponivel')
      .order('ganho_em', { ascending: true }),
    admin
      .from('cupons')
      .select(`id, codigo, descricao, tipo, valor, valor_minimo_pedido, validade_inicio, validade_fim, dias_semana, itens_cardapio ( nome, imagem_url )`)
      .eq('restaurante_id', restauranteId)
      .eq('ativo', true),
  ])
  if (campanhasError) throw campanhasError
  if (recompensasError) throw recompensasError
  if (cuponsError) throw cuponsError

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campanhaIds = (campanhasRows ?? []).map((c: any) => c.id)
  let progressoPorCampanha = new Map<string, ProgressoCliente>()
  if (campanhaIds.length > 0) {
    const { data: progressoRows, error: progressoError } = await admin
      .from('fidelidade_progresso')
      .select('campanha_id, progresso_valor, progresso_qtd, ciclos_completados')
      .eq('restaurante_id', restauranteId)
      .eq('cliente_telefone', telefone)
      .in('campanha_id', campanhaIds)
    if (progressoError) throw progressoError
    progressoPorCampanha = new Map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (progressoRows ?? []).map((p: any) => [
        p.campanha_id,
        { progressoValor: Number(p.progresso_valor), progressoQtd: p.progresso_qtd, ciclosCompletados: p.ciclos_completados } as ProgressoCliente,
      ])
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campanhas = (campanhasRows ?? []).map((row: any) => {
    const campanha = mapCampanha(row)
    const progresso = progressoPorCampanha.get(row.id) ?? { progressoValor: 0, progressoQtd: 0, ciclosCompletados: 0 }
    return {
      campanha: { ...campanha, premioItemNome: row.itens_cardapio?.nome, premioItemImagemUrl: row.itens_cardapio?.imagem_url ?? null },
      progresso,
      resumo: resumoProgresso(campanha, progresso),
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recompensas: RecompensaDisponivel[] = (recompensasRows ?? []).map((row: any) => {
    const c = row.campanhas_fidelidade
    const diasSemanaResgate: number[] = c?.dias_semana_resgate ?? []
    return {
      id: row.id,
      campanhaId: row.campanha_id,
      campanhaNome: c?.nome ?? '',
      premioTipo: c?.premio_tipo,
      premioValor: c?.premio_valor != null ? Number(c.premio_valor) : null,
      premioItemNome: c?.itens_cardapio?.nome,
      premioItemImagemUrl: c?.itens_cardapio?.imagem_url ?? null,
      diasSemanaResgate,
      podeResgatarHoje: podeResgatarHoje(diasSemanaResgate, diaSemana),
      ganhoEm: row.ganho_em,
    }
  })

  const cuponsPublicos: CupomVitrine[] = (cuponsRows ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((row: any) => {
      if (row.validade_inicio && hojeISO < row.validade_inicio) return false
      if (row.validade_fim && hojeISO > row.validade_fim) return false
      const diasSemana: number[] = row.dias_semana ?? []
      if (diasSemana.length > 0 && !diasSemana.includes(diaSemana)) return false
      return true
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((row: any) => ({
      id: row.id,
      codigo: row.codigo,
      descricao: row.descricao,
      tipo: row.tipo,
      valor: row.valor != null ? Number(row.valor) : null,
      itemNome: row.itens_cardapio?.nome,
      itemImagemUrl: row.itens_cardapio?.imagem_url ?? null,
      valorMinimoPedido: row.valor_minimo_pedido != null ? Number(row.valor_minimo_pedido) : null,
      validadeFim: row.validade_fim,
    }))

  return { campanhas, recompensas, cuponsPublicos }
}

/**
 * Histórico do cliente usado por `validarCupom` (lib/fidelidade-regras.ts): quantos pedidos
 * entregues ele já teve (pra público primeira_compra/recompra) e se já usou um cupom específico
 * (uso único). Pedidos `origem='pdv'` não contam (mesma regra do motor de progresso — ver
 * Global Constraints do plano). `pedidos.cliente_telefone` pode estar em formatos diferentes
 * (dado histórico, gravado como veio do cliente), por isso a comparação é feita em memória com
 * `normalizarTelefone`, no mesmo padrão de `listarClientesComMetricas` (lib/queries/clientes.ts).
 */
export async function buscarHistoricoCliente(
  admin: SupabaseClient,
  restauranteId: string,
  telefoneInformado: string,
  cupomId?: string
): Promise<HistoricoCliente> {
  const telefone = normalizarTelefone(telefoneInformado)

  const { data: pedidos, error: pedidosError } = await admin
    .from('pedidos')
    .select('cliente_telefone, criado_em')
    .eq('restaurante_id', restauranteId)
    .eq('status', 'entregue')
    .neq('origem', 'pdv')
    .order('criado_em', { ascending: false })
  if (pedidosError) throw pedidosError

  const doCliente = (pedidos ?? []).filter((p: { cliente_telefone: string }) => normalizarTelefone(p.cliente_telefone) === telefone)

  let jaUsouEsteCupom = false
  if (cupomId) {
    const { data: uso, error: usoError } = await admin
      .from('cupom_usos')
      .select('id')
      .eq('cupom_id', cupomId)
      .eq('restaurante_id', restauranteId)
      .eq('cliente_telefone', telefone)
      .limit(1)
      .maybeSingle()
    if (usoError) throw usoError
    jaUsouEsteCupom = Boolean(uso)
  }

  return {
    totalPedidosEntregues: doCliente.length,
    ultimoPedidoEm: doCliente[0]?.criado_em ?? null,
    jaUsouEsteCupom,
  }
}

// ─── Helpers de apoio ao motor (lib/fidelidade.ts, Task 4) ─────────────────
//
// `processarFidelidadePedidoEntregue` (orquestração: iterar campanhas, montar mensagem de
// WhatsApp, etc.) é da Task 4 e mora em `lib/fidelidade.ts`. As funções abaixo são só o
// acesso a dados que esse motor precisa — todas seguem o mesmo padrão de tabela nova com
// `cliente_telefone` sempre normalizado (diferente de `pedidos.cliente_telefone`, que é
// legado e não confiável).

/**
 * Trava a idempotência do motor: só marca `fidelidade_processado=true` (e retorna os dados do
 * pedido) se ele estiver `entregue` e ainda não tiver sido processado. Se não achar nada pra
 * atualizar (já processado, ou não está entregue), retorna `null` — o chamador deve parar aí.
 */
export async function marcarPedidoFidelidadeProcessado(admin: SupabaseClient, pedidoId: string): Promise<PedidoFidelidadeInfo | null> {
  const { data, error } = await admin
    .from('pedidos')
    .update({ fidelidade_processado: true })
    .eq('id', pedidoId)
    .eq('status', 'entregue')
    .eq('fidelidade_processado', false)
    .select('id, restaurante_id, cliente_telefone, origem, subtotal, criado_em, pedido_itens ( quantidade )')
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = data as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const qtdItens = (row.pedido_itens ?? []).reduce((soma: number, item: any) => soma + Number(item.quantidade), 0)

  return {
    id: row.id,
    restauranteId: row.restaurante_id,
    clienteTelefone: row.cliente_telefone,
    origem: row.origem,
    subtotal: Number(row.subtotal),
    qtdItens,
    criadoEm: row.criado_em,
  }
}

export async function listarCampanhasFidelidadeAtivas(admin: SupabaseClient, restauranteId: string): Promise<CampanhaFidelidade[]> {
  const { data, error } = await admin.from('campanhas_fidelidade').select(CAMPANHA_SELECT).eq('restaurante_id', restauranteId).eq('ativa', true)
  if (error) throw error
  return (data ?? []).map(mapCampanha)
}

export async function buscarProgressoCliente(admin: SupabaseClient, restauranteId: string, campanhaId: string, telefoneInformado: string): Promise<ProgressoCliente> {
  const telefone = normalizarTelefone(telefoneInformado)
  const { data, error } = await admin
    .from('fidelidade_progresso')
    .select('progresso_valor, progresso_qtd, ciclos_completados')
    .eq('restaurante_id', restauranteId)
    .eq('campanha_id', campanhaId)
    .eq('cliente_telefone', telefone)
    .maybeSingle()
  if (error) throw error
  if (!data) return { progressoValor: 0, progressoQtd: 0, ciclosCompletados: 0 }
  return { progressoValor: Number(data.progresso_valor), progressoQtd: data.progresso_qtd, ciclosCompletados: data.ciclos_completados }
}

export async function salvarProgressoCliente(
  admin: SupabaseClient,
  restauranteId: string,
  campanhaId: string,
  telefoneInformado: string,
  progresso: ProgressoCliente
): Promise<void> {
  const telefone = normalizarTelefone(telefoneInformado)
  const { error } = await admin.from('fidelidade_progresso').upsert(
    {
      restaurante_id: restauranteId,
      campanha_id: campanhaId,
      cliente_telefone: telefone,
      progresso_valor: progresso.progressoValor,
      progresso_qtd: progresso.progressoQtd,
      ciclos_completados: progresso.ciclosCompletados,
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: 'campanha_id,cliente_telefone' }
  )
  if (error) throw error
}

/** Cria o prêmio pronto pra resgatar (status inicial `disponivel`). Retorna o id da recompensa. */
export async function criarRecompensaDisponivel(admin: SupabaseClient, restauranteId: string, campanhaId: string, telefoneInformado: string): Promise<string> {
  const telefone = normalizarTelefone(telefoneInformado)
  const { data, error } = await admin
    .from('fidelidade_recompensas')
    .insert({ restaurante_id: restauranteId, campanha_id: campanhaId, cliente_telefone: telefone })
    .select('id')
    .single()
  if (error) throw error
  return data.id
}
