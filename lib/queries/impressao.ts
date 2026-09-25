import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConfigImpressao {
  mostrarNumeroItem: boolean
  mostrarPrecoComplementos: boolean
  mostrarNomeComplementos: boolean
  fonteMaiorProducao: boolean
  multiplicarOpcoesQtd: boolean
  imprimirLogo: boolean
  ativarAssistente: boolean
  impressaoAutomatica: boolean
  aceitarPedidosAutomaticamente: boolean
  agenteToken: string | null
}

interface ConfigImpressaoRow {
  impressao_mostrar_numero_item: boolean
  impressao_mostrar_preco_complementos: boolean
  impressao_mostrar_nome_complementos: boolean
  impressao_fonte_maior_producao: boolean
  impressao_multiplicar_opcoes_qtd: boolean
  impressao_logo: boolean
  impressao_ativar_assistente: boolean
  impressao_automatica: boolean
  impressao_aceitar_pedidos_automaticamente: boolean
}

const CONFIG_IMPRESSAO_SELECT = `
  impressao_mostrar_numero_item, impressao_mostrar_preco_complementos, impressao_mostrar_nome_complementos,
  impressao_fonte_maior_producao, impressao_multiplicar_opcoes_qtd, impressao_logo,
  impressao_ativar_assistente,
  impressao_automatica, impressao_aceitar_pedidos_automaticamente
`

function mapConfigImpressao(row: ConfigImpressaoRow): ConfigImpressao {
  return {
    mostrarNumeroItem: row.impressao_mostrar_numero_item,
    mostrarPrecoComplementos: row.impressao_mostrar_preco_complementos,
    mostrarNomeComplementos: row.impressao_mostrar_nome_complementos,
    fonteMaiorProducao: row.impressao_fonte_maior_producao,
    multiplicarOpcoesQtd: row.impressao_multiplicar_opcoes_qtd,
    imprimirLogo: row.impressao_logo,
    ativarAssistente: row.impressao_ativar_assistente,
    impressaoAutomatica: row.impressao_automatica,
    aceitarPedidosAutomaticamente: row.impressao_aceitar_pedidos_automaticamente,
    // O token não viaja mais nesta leitura: desde a 0080 o navegador não tem acesso à
    // coluna. A página Impressão busca pela rota do dono (/api/admin/impressao/token).
    agenteToken: null,
  }
}

export async function buscarConfigImpressao(supabase: SupabaseClient, restauranteId: string): Promise<ConfigImpressao | null> {
  const { data, error } = await supabase.from('restaurantes').select(CONFIG_IMPRESSAO_SELECT).eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return data ? mapConfigImpressao(data as ConfigImpressaoRow) : null
}

export type ConfigImpressaoPatch = Partial<Omit<ConfigImpressao, 'agenteToken'>>

export async function atualizarConfigImpressao(supabase: SupabaseClient, restauranteId: string, patch: ConfigImpressaoPatch): Promise<ConfigImpressao> {
  const row: Record<string, unknown> = {}
  if (patch.mostrarNumeroItem !== undefined) row.impressao_mostrar_numero_item = patch.mostrarNumeroItem
  if (patch.mostrarPrecoComplementos !== undefined) row.impressao_mostrar_preco_complementos = patch.mostrarPrecoComplementos
  if (patch.mostrarNomeComplementos !== undefined) row.impressao_mostrar_nome_complementos = patch.mostrarNomeComplementos
  if (patch.fonteMaiorProducao !== undefined) row.impressao_fonte_maior_producao = patch.fonteMaiorProducao
  if (patch.multiplicarOpcoesQtd !== undefined) row.impressao_multiplicar_opcoes_qtd = patch.multiplicarOpcoesQtd
  if (patch.imprimirLogo !== undefined) row.impressao_logo = patch.imprimirLogo
  if (patch.ativarAssistente !== undefined) row.impressao_ativar_assistente = patch.ativarAssistente
  if (patch.impressaoAutomatica !== undefined) row.impressao_automatica = patch.impressaoAutomatica
  if (patch.aceitarPedidosAutomaticamente !== undefined) row.impressao_aceitar_pedidos_automaticamente = patch.aceitarPedidosAutomaticamente

  const { data, error } = await supabase.from('restaurantes').update(row).eq('id', restauranteId).select(CONFIG_IMPRESSAO_SELECT).single()
  if (error) throw error
  return mapConfigImpressao(data as ConfigImpressaoRow)
}

/**
 * Token de pareamento do Assistente de Impressão. SÓ SERVIDOR (client de serviço):
 * desde a 0080 o navegador não lê nem grava a coluna. Quem chama é a rota
 * /api/admin/impressao/token, que exige o dono. Nunca logar o valor.
 */
export async function buscarTokenAgente(admin: SupabaseClient, restauranteId: string): Promise<string | null> {
  const { data, error } = await admin.from('restaurantes').select('impressao_agente_token').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return (data?.impressao_agente_token as string | null | undefined) ?? null
}

/** Gera (ou regenera) o token — o anterior deixa de funcionar na hora. SÓ SERVIDOR. */
export async function gerarTokenAgente(admin: SupabaseClient, restauranteId: string): Promise<string> {
  const token = crypto.randomUUID()
  const { error } = await admin.from('restaurantes').update({ impressao_agente_token: token }).eq('id', restauranteId)
  if (error) throw error
  return token
}

export interface Impressora {
  id: string
  nome: string
  tamanhoFonte: string
  largura: number
  copias: number
  ativa: boolean
  posicao: number
}

interface ImpressoraRow {
  id: string
  nome: string
  tamanho_fonte: string
  largura: number
  copias: number
  ativa: boolean
  posicao: number
}

const IMPRESSORA_SELECT = 'id, nome, tamanho_fonte, largura, copias, ativa, posicao'

function mapImpressora(row: ImpressoraRow): Impressora {
  return {
    id: row.id,
    nome: row.nome,
    tamanhoFonte: row.tamanho_fonte,
    largura: row.largura,
    copias: row.copias,
    ativa: row.ativa,
    posicao: row.posicao,
  }
}

export async function listarImpressoras(supabase: SupabaseClient, restauranteId: string): Promise<Impressora[]> {
  const { data, error } = await supabase
    .from('impressoras')
    .select(IMPRESSORA_SELECT)
    .eq('restaurante_id', restauranteId)
    .order('posicao', { ascending: true })
  if (error) throw error
  return ((data ?? []) as ImpressoraRow[]).map(mapImpressora)
}

export interface ImpressoraInput {
  nome: string
  tamanhoFonte: string
  largura: number
  copias: number
}

export async function criarImpressora(supabase: SupabaseClient, restauranteId: string, input: ImpressoraInput, posicao: number): Promise<Impressora> {
  const { data, error } = await supabase
    .from('impressoras')
    .insert({
      restaurante_id: restauranteId,
      nome: input.nome,
      tamanho_fonte: input.tamanhoFonte,
      largura: input.largura,
      copias: input.copias,
      posicao,
    })
    .select(IMPRESSORA_SELECT)
    .single()
  if (error) throw error
  return mapImpressora(data as ImpressoraRow)
}

export async function atualizarImpressora(supabase: SupabaseClient, id: string, input: ImpressoraInput): Promise<Impressora> {
  const { data, error } = await supabase
    .from('impressoras')
    .update({
      nome: input.nome,
      tamanho_fonte: input.tamanhoFonte,
      largura: input.largura,
      copias: input.copias,
    })
    .eq('id', id)
    .select(IMPRESSORA_SELECT)
    .single()
  if (error) throw error
  return mapImpressora(data as ImpressoraRow)
}

export async function removerImpressora(supabase: SupabaseClient, id: string) {
  const { error } = await supabase.from('impressoras').delete().eq('id', id)
  if (error) throw error
}

export async function alternarAtivaImpressora(supabase: SupabaseClient, id: string, ativa: boolean) {
  const { error } = await supabase.from('impressoras').update({ ativa }).eq('id', id)
  if (error) throw error
}

// ─── Usado pelo Assistente de Impressão (agente desktop, sem login) ───────────
// O agente não tem sessão de usuário — autentica por token de pareamento.
// Essas funções rodam no servidor com o client service_role (ignora RLS).

/** Resolve o restaurante a partir do token de pareamento, ou null se inválido. */
export async function resolverRestauranteIdPorToken(admin: SupabaseClient, token: string): Promise<string | null> {
  const { data, error } = await admin.rpc('restaurante_id_por_agente_token', { token })
  if (error) throw error
  return data ?? null
}

export interface PedidoParaImprimir {
  id: string
  numero: number
  tipo: string
  formaPagamento: string
  trocoPara: number | null
  clienteNome: string
  clienteTelefone: string
  enderecoRua: string
  enderecoNumero: string
  enderecoComplemento: string
  enderecoBairro: string
  enderecoCep: string
  observacao: string
  pago: boolean
  origem: string
  mesa: string | null
  /**
   * Canal do pedido e senha do balcão (PDV v2). O recibo só usa a senha quando o canal
   * é balcão; delivery e mesa saem exatamente como antes. Assistente antigo ignora os
   * dois campos.
   */
  canal: string
  senha: number | null
  subtotal: number
  taxaEntrega: number
  total: number
  criadoEm: string
  itens: {
    nome: string
    quantidade: number
    precoUnitario: number
    observacao: string
    tamanhoNome: string
    saborNome: string
    bordaNome: string
    massaNome: string
    complementos: { nome: string; preco: number }[]
  }[]
}

/** Por quanto tempo um pedido entregue a um Assistente fica fora da fila dos outros. */
export const RESERVA_IMPRESSAO_SEGUNDOS = 90

/**
 * Pedidos a imprimir, JÁ RESERVADOS para quem pediu (0086, `impressao_reservar`).
 *
 * A regra de quem entra na fila vive na função do banco: novo não impresso; em preparo
 * ou pronto não impresso nas últimas 6h (o pronto ficava de fora e um pedido que pulou
 * etapas nunca saía no papel); reimpressão pedida; nunca cancelado; nunca pedido sem
 * item. A reserva, sob trava por loja, garante que dois Assistentes (ou dois ciclos)
 * não recebem o mesmo pedido. `instancia` identifica o Assistente (cabeçalho
 * `X-Agente-Instancia`); sem ela (versão antiga), a reserva vale para todos.
 */
export async function listarPedidosParaImprimir(
  admin: SupabaseClient,
  restauranteId: string,
  instancia: string | null = null,
): Promise<PedidoParaImprimir[]> {
  // Sem identidade (Assistente antigo, ou botões de diagnóstico): lista sem gravar
  // nada (0087). Reservar sem saber quem pediu escondia pedidos de todos (B1).
  const { data: reservados, error: erroReserva } = instancia
    ? await admin.rpc('impressao_reservar', { p_restaurante: restauranteId, p_instancia: instancia, p_segundos: RESERVA_IMPRESSAO_SEGUNDOS })
    : await admin.rpc('impressao_elegiveis', { p_restaurante: restauranteId })
  if (erroReserva) throw erroReserva
  const ids = ((reservados ?? []) as (string | Record<string, string>)[]).map((r) => (typeof r === 'string' ? r : Object.values(r)[0]))
  if (ids.length === 0) return []

  const { data, error } = await admin
    .from('pedidos')
    .select(
      `id, numero, tipo, forma_pagamento, troco_para, cliente_nome, cliente_telefone, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep,
       observacao, pago, origem, mesa, canal, subtotal, taxa_entrega, total, criado_em,
       comandas ( senha ),
       pedido_itens ( nome, quantidade, preco_unitario, observacao, tamanho_nome, sabor_nome, borda_nome, massa_nome, complementos )`
    )
    .eq('restaurante_id', restauranteId)
    .in('id', ids)
    // Cancelado entre a reserva e a leitura: não sai.
    .neq('status', 'cancelado')
    .order('criado_em', { ascending: true })
  if (error) throw error

  return (data ?? []).map((p) => ({
    id: p.id,
    numero: p.numero,
    tipo: p.tipo,
    formaPagamento: p.forma_pagamento,
    trocoPara: p.troco_para === null ? null : Number(p.troco_para),
    clienteNome: p.cliente_nome,
    clienteTelefone: p.cliente_telefone ?? '',
    enderecoRua: p.endereco_rua,
    enderecoNumero: p.endereco_numero,
    enderecoComplemento: p.endereco_complemento ?? '',
    enderecoBairro: p.endereco_bairro,
    enderecoCep: p.endereco_cep ?? '',
    observacao: p.observacao,
    pago: Boolean(p.pago),
    origem: p.origem ?? 'cardapio',
    mesa: p.mesa ?? null,
    canal: (p.canal as string | null) ?? 'delivery',
    senha: p.canal === 'balcao' ? ((Array.isArray(p.comandas) ? p.comandas[0] : p.comandas) as { senha: number | null } | null)?.senha ?? null : null,
    subtotal: Number(p.subtotal),
    taxaEntrega: Number(p.taxa_entrega),
    total: Number(p.total),
    criadoEm: p.criado_em,
    itens: (p.pedido_itens ?? []).map((i: { nome: string; quantidade: number; preco_unitario: number; observacao: string; tamanho_nome: string; sabor_nome: string; borda_nome: string; massa_nome: string; complementos: { nome: string; preco: number }[] }) => ({
      nome: i.nome,
      quantidade: i.quantidade,
      precoUnitario: Number(i.preco_unitario),
      observacao: i.observacao,
      tamanhoNome: i.tamanho_nome ?? '',
      saborNome: i.sabor_nome ?? '',
      bordaNome: i.borda_nome ?? '',
      massaNome: i.massa_nome ?? '',
      complementos: (i.complementos ?? []).map((c) => ({ nome: c.nome, preco: Number(c.preco) })),
    })),
  }))
}

/**
 * Marca como impresso e libera a reserva, escopado ao restaurante do token — impede um
 * token marcar pedido de outra loja (0086, `impressao_confirmar`).
 */
export async function marcarPedidoImpresso(admin: SupabaseClient, pedidoId: string, restauranteId: string) {
  const { error } = await admin.rpc('impressao_confirmar', { p_restaurante: restauranteId, p_pedido: pedidoId })
  if (error) throw error
}

/** Marca um pedido para ser reimpresso pelo Assistente na próxima varredura (RLS escopa por loja). */
export async function solicitarReimpressao(supabase: SupabaseClient, pedidoId: string) {
  const { error } = await supabase.from('pedidos').update({ reimprimir: true }).eq('id', pedidoId)
  if (error) throw error
}

/** Registra que o agente está vivo e qual impressora (config do painel) está usando. */
export async function registrarHeartbeatAgente(admin: SupabaseClient, restauranteId: string, impressoraId: string | null) {
  const ehUuid = !!impressoraId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(impressoraId)
  const { error } = await admin
    .from('restaurantes')
    .update({
      impressao_agente_visto_em: new Date().toISOString(),
      impressao_agente_impressora_id: ehUuid ? impressoraId : null,
    })
    .eq('id', restauranteId)
  if (error) throw error
}

export interface StatusAgente {
  impressoraId: string | null
  vistoEm: string | null
}

/** Status do agente pra UI do painel: qual impressora está conectada e quando foi visto. */
export async function buscarStatusAgente(supabase: SupabaseClient, restauranteId: string): Promise<StatusAgente> {
  const { data, error } = await supabase
    .from('restaurantes')
    .select('impressao_agente_impressora_id, impressao_agente_visto_em')
    .eq('id', restauranteId)
    .maybeSingle()
  if (error) throw error
  return {
    impressoraId: (data?.impressao_agente_impressora_id as string) ?? null,
    vistoEm: (data?.impressao_agente_visto_em as string) ?? null,
  }
}

/** Nome da loja, usado no cabeçalho do recibo quando o logo está ligado. */
export async function buscarNomeRestaurante(admin: SupabaseClient, restauranteId: string): Promise<string> {
  const { data, error } = await admin.from('restaurantes').select('nome').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return (data?.nome as string) ?? ''
}

/** Nome + logo da loja, para o cabeçalho do recibo impresso pelo agente. */
export async function buscarLojaImpressao(admin: SupabaseClient, restauranteId: string): Promise<{ nome: string; logoUrl: string | null }> {
  const { data, error } = await admin.from('restaurantes').select('nome, logo_url').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return { nome: (data?.nome as string) ?? '', logoUrl: (data?.logo_url as string | null) ?? null }
}
