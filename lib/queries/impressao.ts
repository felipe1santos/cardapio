import type { SupabaseClient } from '@supabase/supabase-js'

export interface ConfigImpressao {
  mostrarNumeroItem: boolean
  mostrarPrecoComplementos: boolean
  mostrarNomeComplementos: boolean
  fonteMaiorProducao: boolean
  multiplicarOpcoesQtd: boolean
  imprimirLogo: boolean
  imprimirComprovanteCancelamento: boolean
  imprimirQrcodeAvaliacao: boolean
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
  impressao_comprovante_cancelamento: boolean
  impressao_qrcode_avaliacao: boolean
  impressao_ativar_assistente: boolean
  impressao_automatica: boolean
  impressao_aceitar_pedidos_automaticamente: boolean
  impressao_agente_token: string | null
}

const CONFIG_IMPRESSAO_SELECT = `
  impressao_mostrar_numero_item, impressao_mostrar_preco_complementos, impressao_mostrar_nome_complementos,
  impressao_fonte_maior_producao, impressao_multiplicar_opcoes_qtd, impressao_logo,
  impressao_comprovante_cancelamento, impressao_qrcode_avaliacao, impressao_ativar_assistente,
  impressao_automatica, impressao_aceitar_pedidos_automaticamente, impressao_agente_token
`

function mapConfigImpressao(row: ConfigImpressaoRow): ConfigImpressao {
  return {
    mostrarNumeroItem: row.impressao_mostrar_numero_item,
    mostrarPrecoComplementos: row.impressao_mostrar_preco_complementos,
    mostrarNomeComplementos: row.impressao_mostrar_nome_complementos,
    fonteMaiorProducao: row.impressao_fonte_maior_producao,
    multiplicarOpcoesQtd: row.impressao_multiplicar_opcoes_qtd,
    imprimirLogo: row.impressao_logo,
    imprimirComprovanteCancelamento: row.impressao_comprovante_cancelamento,
    imprimirQrcodeAvaliacao: row.impressao_qrcode_avaliacao,
    ativarAssistente: row.impressao_ativar_assistente,
    impressaoAutomatica: row.impressao_automatica,
    aceitarPedidosAutomaticamente: row.impressao_aceitar_pedidos_automaticamente,
    agenteToken: row.impressao_agente_token,
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
  if (patch.imprimirComprovanteCancelamento !== undefined) row.impressao_comprovante_cancelamento = patch.imprimirComprovanteCancelamento
  if (patch.imprimirQrcodeAvaliacao !== undefined) row.impressao_qrcode_avaliacao = patch.imprimirQrcodeAvaliacao
  if (patch.ativarAssistente !== undefined) row.impressao_ativar_assistente = patch.ativarAssistente
  if (patch.impressaoAutomatica !== undefined) row.impressao_automatica = patch.impressaoAutomatica
  if (patch.aceitarPedidosAutomaticamente !== undefined) row.impressao_aceitar_pedidos_automaticamente = patch.aceitarPedidosAutomaticamente

  const { data, error } = await supabase.from('restaurantes').update(row).eq('id', restauranteId).select(CONFIG_IMPRESSAO_SELECT).single()
  if (error) throw error
  return mapConfigImpressao(data as ConfigImpressaoRow)
}

/** Gera (ou regenera) o token de pareamento do Assistente de Impressão — o lojista cola esse token no agente desktop. */
export async function gerarTokenAgente(supabase: SupabaseClient, restauranteId: string): Promise<string> {
  const token = crypto.randomUUID()
  const { error } = await supabase.from('restaurantes').update({ impressao_agente_token: token }).eq('id', restauranteId)
  if (error) throw error
  return token
}

export interface Impressora {
  id: string
  nome: string
  fabricante: string
  impressoraSistema: string
  tamanhoFonte: string
  largura: number
  copias: number
  ativa: boolean
  posicao: number
}

interface ImpressoraRow {
  id: string
  nome: string
  fabricante: string
  impressora_sistema: string
  tamanho_fonte: string
  largura: number
  copias: number
  ativa: boolean
  posicao: number
}

const IMPRESSORA_SELECT = 'id, nome, fabricante, impressora_sistema, tamanho_fonte, largura, copias, ativa, posicao'

function mapImpressora(row: ImpressoraRow): Impressora {
  return {
    id: row.id,
    nome: row.nome,
    fabricante: row.fabricante,
    impressoraSistema: row.impressora_sistema,
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
  fabricante: string
  impressoraSistema: string
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
      fabricante: input.fabricante,
      impressora_sistema: input.impressoraSistema,
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
      fabricante: input.fabricante,
      impressora_sistema: input.impressoraSistema,
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
  enderecoRua: string
  enderecoNumero: string
  enderecoBairro: string
  observacao: string
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

/** Pedidos recém-chegados ainda não impressos, prontos pra virar recibo no agente desktop. */
export async function listarPedidosParaImprimir(admin: SupabaseClient, restauranteId: string): Promise<PedidoParaImprimir[]> {
  const { data, error } = await admin
    .from('pedidos')
    .select(
      `id, numero, tipo, forma_pagamento, troco_para, cliente_nome, endereco_rua, endereco_numero, endereco_bairro,
       observacao, subtotal, taxa_entrega, total, criado_em,
       pedido_itens ( nome, quantidade, preco_unitario, observacao, tamanho_nome, sabor_nome, borda_nome, massa_nome, complementos )`
    )
    .eq('restaurante_id', restauranteId)
    // Pedidos novos não impressos, OU qualquer pedido com reimpressão pedida manualmente.
    .or('and(status.eq.recebido,impresso.eq.false),reimprimir.eq.true')
    .order('criado_em', { ascending: true })
  if (error) throw error

  return (data ?? []).map((p) => ({
    id: p.id,
    numero: p.numero,
    tipo: p.tipo,
    formaPagamento: p.forma_pagamento,
    trocoPara: p.troco_para === null ? null : Number(p.troco_para),
    clienteNome: p.cliente_nome,
    enderecoRua: p.endereco_rua,
    enderecoNumero: p.endereco_numero,
    enderecoBairro: p.endereco_bairro,
    observacao: p.observacao,
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

/** Marca como impresso, escopado ao restaurante do token — impede um token marcar pedido de outra loja. */
export async function marcarPedidoImpresso(admin: SupabaseClient, pedidoId: string, restauranteId: string) {
  const { error } = await admin
    .from('pedidos')
    .update({ impresso: true, reimprimir: false })
    .eq('id', pedidoId)
    .eq('restaurante_id', restauranteId)
  if (error) throw error
}

/** Marca um pedido para ser reimpresso pelo Assistente na próxima varredura (RLS escopa por loja). */
export async function solicitarReimpressao(supabase: SupabaseClient, pedidoId: string) {
  const { error } = await supabase.from('pedidos').update({ reimprimir: true }).eq('id', pedidoId)
  if (error) throw error
}

/** Nome da loja, usado no cabeçalho do recibo quando o logo está ligado. */
export async function buscarNomeRestaurante(admin: SupabaseClient, restauranteId: string): Promise<string> {
  const { data, error } = await admin.from('restaurantes').select('nome').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return (data?.nome as string) ?? ''
}
