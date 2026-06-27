import type { SupabaseClient } from '@supabase/supabase-js'

export type TipoPedido = 'entrega' | 'retirada'
export type FormaPagamento = 'pix' | 'cartao' | 'dinheiro'
export type StatusPedido = 'recebido' | 'preparando' | 'pronto' | 'em_rota' | 'entregue' | 'cancelado'
export type StatusEntregador = 'online' | 'ocupado' | 'offline'

export interface PedidoComplementoSnapshot {
  nome: string
  preco: number
}

export interface PedidoItem {
  id: string
  nome: string
  descricao: string
  precoUnitario: number
  quantidade: number
  observacao: string
  complementos: PedidoComplementoSnapshot[]
  tamanhoNome: string
  saborNome: string
  bordaNome: string
  massaNome: string
}

export interface Pedido {
  id: string
  numero: number
  tipo: TipoPedido
  status: StatusPedido
  clienteNome: string
  clienteTelefone: string
  enderecoRua: string
  enderecoNumero: string
  enderecoComplemento: string
  enderecoBairro: string
  enderecoCep: string
  formaPagamento: FormaPagamento
  trocoPara: number | null
  pago: boolean
  subtotal: number
  taxaEntrega: number
  total: number
  observacao: string
  entregadorId: string | null
  preparandoPor: string | null
  preparadoPor: string | null
  preparandoNotificado: boolean
  telefoneVerificado: boolean
  criadoEm: string
  atualizadoEm: string
  itens: PedidoItem[]
}

export interface Entregador {
  id: string
  nome: string
  telefone: string
  status: StatusEntregador
  token: string
  emRota: number
  online: boolean
  localizacao: { lat: number; lng: number; atualizadaEm: string } | null
  fotoUrl: string | null
  veiculo: string
  placa: string
}

interface PedidoRow {
  id: string
  numero: number
  tipo: TipoPedido
  status: StatusPedido
  cliente_nome: string
  cliente_telefone: string
  endereco_rua: string
  endereco_numero: string
  endereco_complemento: string
  endereco_bairro: string
  endereco_cep: string
  forma_pagamento: FormaPagamento
  troco_para: number | null
  pago: boolean
  subtotal: number
  taxa_entrega: number
  total: number
  observacao: string
  entregador_id: string | null
  preparando_por: string | null
  preparado_por: string | null
  preparando_notificado: boolean
  telefone_verificado: boolean
  criado_em: string
  atualizado_em: string
  pedido_itens: {
    id: string
    nome: string
    preco_unitario: number
    quantidade: number
    observacao: string
    complementos: PedidoComplementoSnapshot[]
    tamanho_nome: string
    sabor_nome: string
    borda_nome: string
    massa_nome: string
    item: { descricao: string } | null
  }[]
}

const PEDIDO_SELECT = `
  id, numero, tipo, status, cliente_nome, cliente_telefone,
  endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cep,
  forma_pagamento, troco_para, pago, subtotal, taxa_entrega, total, observacao,
  entregador_id, preparando_por, preparado_por, preparando_notificado, telefone_verificado, criado_em, atualizado_em,
  pedido_itens ( id, nome, preco_unitario, quantidade, observacao, complementos, tamanho_nome, sabor_nome, borda_nome, massa_nome, item:itens_cardapio ( descricao ) )
`

function mapPedido(row: PedidoRow): Pedido {
  return {
    id: row.id,
    numero: row.numero,
    tipo: row.tipo,
    status: row.status,
    clienteNome: row.cliente_nome,
    clienteTelefone: row.cliente_telefone,
    enderecoRua: row.endereco_rua,
    enderecoNumero: row.endereco_numero,
    enderecoComplemento: row.endereco_complemento,
    enderecoBairro: row.endereco_bairro,
    enderecoCep: row.endereco_cep,
    formaPagamento: row.forma_pagamento,
    trocoPara: row.troco_para === null ? null : Number(row.troco_para),
    pago: row.pago,
    subtotal: Number(row.subtotal),
    taxaEntrega: Number(row.taxa_entrega),
    total: Number(row.total),
    observacao: row.observacao,
    entregadorId: row.entregador_id,
    preparandoPor: row.preparando_por ?? null,
    preparadoPor: row.preparado_por ?? null,
    preparandoNotificado: row.preparando_notificado ?? false,
    telefoneVerificado: row.telefone_verificado ?? true,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
    itens: (row.pedido_itens ?? []).map((i) => ({
      id: i.id,
      nome: i.nome,
      descricao: i.item?.descricao ?? '',
      precoUnitario: Number(i.preco_unitario),
      quantidade: i.quantidade,
      observacao: i.observacao,
      complementos: (i.complementos ?? []).map((c) => ({ nome: c.nome, preco: Number(c.preco) })),
      tamanhoNome: i.tamanho_nome ?? '',
      saborNome: i.sabor_nome ?? '',
      bordaNome: i.borda_nome ?? '',
      massaNome: i.massa_nome ?? '',
    })),
  }
}

/** Endereço completo do pedido, no formato usado pela Directions API do Google Maps. */
export function enderecoCompletoPedido(p: Pedido): string {
  const linha1 = [p.enderecoRua, p.enderecoNumero].filter(Boolean).join(', ')
  const linha2 = [p.enderecoComplemento, p.enderecoBairro].filter(Boolean).join(' - ')
  return [linha1, linha2, p.enderecoCep].filter(Boolean).join(', ')
}

// --- Painel (Kanban / Logística) — lê com a sessão do usuário (RLS por loja) ---

/**
 * Pedidos ativos do Kanban: recebido, preparando e todos os prontos.
 * Pedidos de entrega prontos continuam visíveis aqui (etapa "Pronto p/ Despacho")
 * mesmo já aparecendo na Logística — só saem do Kanban quando entram em rota.
 */
export async function listarPedidosKanban(supabase: SupabaseClient, restauranteId: string): Promise<Pedido[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .or('status.eq.recebido,status.eq.preparando,status.eq.pronto')
    .order('criado_em', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}

/** Pedidos de uma loja num conjunto de status — usado pelo portal da cozinha (admin client). */
export async function listarPedidosPorStatus(
  supabase: SupabaseClient,
  restauranteId: string,
  status: StatusPedido[]
): Promise<Pedido[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .in('status', status)
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}

/** Pedidos de entrega para a Logística: prontos aguardando despacho + em rota. */
export async function listarPedidosLogistica(supabase: SupabaseClient, restauranteId: string): Promise<Pedido[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('tipo', 'entrega')
    .in('status', ['pronto', 'em_rota'])
    .order('criado_em', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}

/**
 * Pedidos de entrega para o Painel de Rotas (visão panorâmica do dia):
 * todos os status relevantes (aguardando, em rota, entregue, cancelado)
 * criados a partir de `desdeISO` (normalmente as últimas 12h). Depois dessa
 * janela os pedidos saem da tela automaticamente — o mapa "se limpa".
 */
export async function listarPedidosRotas(supabase: SupabaseClient, restauranteId: string, desdeISO: string): Promise<Pedido[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('tipo', 'entrega')
    // Pedidos AGUARDANDO DESPACHO (status 'pronto') aparecem SEMPRE, sem limite de
    // tempo — senão um pedido pronto há mais de 12h sumiria da coluna de despacho.
    // A janela de 12h serve só pra limitar o HISTÓRICO no mapa (em rota/entregue/
    // cancelado), não pra esconder pedidos que ainda precisam ser despachados.
    .or(`status.eq.pronto,and(status.in.(em_rota,entregue,cancelado),criado_em.gte.${desdeISO})`)
    .order('criado_em', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}

export async function avancarStatusPedido(supabase: SupabaseClient, pedidoId: string, status: StatusPedido) {
  const { error } = await supabase.from('pedidos').update({ status }).eq('id', pedidoId)
  if (error) throw error
}

/** Claim atômico de um pedido pela cozinha: só pega se ainda estiver 'recebido'. Retorna se conseguiu. */
export async function pegarPedidoCozinha(admin: SupabaseClient, pedidoId: string, cozinheiro: string): Promise<boolean> {
  const { data, error } = await admin
    .from('pedidos')
    .update({ status: 'preparando', preparando_por: cozinheiro })
    .eq('id', pedidoId)
    .eq('status', 'recebido')
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/**
 * Devolve o pedido pego para o pool (volta a 'recebido', limpa quem preparava).
 * A trava de dono (só quem pegou devolve) é feita na rota; aqui o guard de status
 * resolve a corrida. Retorna false se o pedido já mudou de etapa.
 */
export async function devolverPedidoCozinha(admin: SupabaseClient, pedidoId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('pedidos')
    .update({ status: 'recebido', preparando_por: null })
    .eq('id', pedidoId)
    .eq('status', 'preparando')
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/** Conclui o preparo: 'preparando' → 'pronto', registra quem preparou. Retorna false se já mudou de etapa. */
export async function concluirPedidoCozinha(admin: SupabaseClient, pedidoId: string, cozinheiro: string): Promise<boolean> {
  const { data, error } = await admin
    .from('pedidos')
    .update({ status: 'pronto', preparado_por: cozinheiro })
    .eq('id', pedidoId)
    .eq('status', 'preparando')
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/**
 * Marca que a notificação "pedido em preparo" já saiu no WhatsApp.
 * Update atômico (só flipa false→true). Retorna true apenas na primeira vez —
 * use o retorno para decidir se envia a mensagem (idempotente em pegar/devolver/pegar).
 */
export async function marcarPreparandoNotificado(admin: SupabaseClient, pedidoId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('pedidos')
    .update({ preparando_notificado: true })
    .eq('id', pedidoId)
    .eq('preparando_notificado', false)
    .select('id')
  if (error) throw error
  return (data?.length ?? 0) > 0
}

/** App do motoboy considerado "online" se enviou um heartbeat nos últimos 2 minutos. */
const ENTREGADOR_ONLINE_MS = 2 * 60 * 1000

export async function listarEntregadores(supabase: SupabaseClient, restauranteId: string): Promise<Entregador[]> {
  const { data, error } = await supabase
    .from('entregadores')
    .select(
      'id, nome, telefone, status, token, ultimo_acesso_em, localizacao_lat, localizacao_lng, localizacao_atualizada_em, foto_url, veiculo, placa'
    )
    .eq('restaurante_id', restauranteId)
    .order('nome', { ascending: true })
  if (error) throw error

  // Quantas entregas em rota cada um tem
  const { data: rotas } = await supabase
    .from('pedidos')
    .select('entregador_id')
    .eq('restaurante_id', restauranteId)
    .eq('status', 'em_rota')

  const counts = new Map<string, number>()
  for (const r of rotas ?? []) {
    if (r.entregador_id) counts.set(r.entregador_id, (counts.get(r.entregador_id) ?? 0) + 1)
  }

  const agora = Date.now()
  return (data ?? []).map((d) => ({
    id: d.id,
    nome: d.nome,
    telefone: d.telefone,
    status: d.status as StatusEntregador,
    token: d.token,
    emRota: counts.get(d.id) ?? 0,
    online: !!d.ultimo_acesso_em && agora - new Date(d.ultimo_acesso_em).getTime() < ENTREGADOR_ONLINE_MS,
    localizacao:
      d.localizacao_lat === null || d.localizacao_lng === null
        ? null
        : { lat: Number(d.localizacao_lat), lng: Number(d.localizacao_lng), atualizadaEm: d.localizacao_atualizada_em as string },
    fotoUrl: d.foto_url ?? null,
    veiculo: d.veiculo ?? '',
    placa: d.placa ?? '',
  }))
}

export interface PerfilEntregadorInput {
  nome: string
  telefone: string
  veiculo: string
  placa: string
  fotoUrl: string | null
}

/** Atualiza os dados de perfil do entregador (nome, telefone, veículo, placa, foto). */
export async function atualizarPerfilEntregador(supabase: SupabaseClient, entregadorId: string, input: PerfilEntregadorInput) {
  const { error } = await supabase
    .from('entregadores')
    .update({
      nome: input.nome,
      telefone: input.telefone,
      veiculo: input.veiculo,
      placa: input.placa,
      foto_url: input.fotoUrl,
    })
    .eq('id', entregadorId)
  if (error) throw error
}

/** Envia a foto de perfil do entregador para o bucket público `cardapio` e retorna a URL pública. */
export async function enviarFotoEntregador(supabase: SupabaseClient, restauranteId: string, entregadorId: string, file: File): Promise<string> {
  const extensao = file.name.split('.').pop() ?? 'jpg'
  const caminho = `${restauranteId}/entregadores/${entregadorId}-${crypto.randomUUID()}.${extensao}`

  const { error } = await supabase.storage.from('cardapio').upload(caminho, file, {
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error

  const { data } = supabase.storage.from('cardapio').getPublicUrl(caminho)
  return data.publicUrl
}

export async function criarEntregador(supabase: SupabaseClient, restauranteId: string, nome: string, telefone: string) {
  const { error } = await supabase.from('entregadores').insert({ restaurante_id: restauranteId, nome, telefone, status: 'online' })
  if (error) throw error
}

export async function definirStatusEntregador(supabase: SupabaseClient, entregadorId: string, status: StatusEntregador) {
  const { error } = await supabase.from('entregadores').update({ status }).eq('id', entregadorId)
  if (error) throw error
}

/** Atribui um entregador e coloca o pedido em rota. */
export async function atribuirEntregador(supabase: SupabaseClient, pedidoId: string, entregadorId: string) {
  const { error } = await supabase.from('pedidos').update({ entregador_id: entregadorId, status: 'em_rota' }).eq('id', pedidoId)
  if (error) throw error
}

/** Atribui o mesmo entregador a vários pedidos de uma vez (despacho em lote). */
export async function atribuirEntregadorEmLote(supabase: SupabaseClient, pedidoIds: string[], entregadorId: string) {
  const { error } = await supabase.from('pedidos').update({ entregador_id: entregadorId, status: 'em_rota' }).in('id', pedidoIds)
  if (error) throw error
}

/**
 * Versão tenant-safe pra ser chamada por rotas autenticadas por TOKEN (service_role,
 * sem RLS): garante que o entregador e os pedidos são da loja da estação, e só
 * despacha pedidos que ainda estão 'pronto'. Usada pelo despacho da cozinha completa.
 */
export async function atribuirEntregadorEmLoteSeguro(admin: SupabaseClient, restauranteId: string, pedidoIds: string[], entregadorId: string) {
  const { data: drv } = await admin.from('entregadores').select('id').eq('id', entregadorId).eq('restaurante_id', restauranteId).maybeSingle()
  if (!drv) throw new Error('Entregador inválido para esta loja')
  const { error } = await admin
    .from('pedidos')
    .update({ entregador_id: entregadorId, status: 'em_rota' })
    .in('id', pedidoIds)
    .eq('restaurante_id', restauranteId)
    .eq('status', 'pronto')
  if (error) throw error
}

export async function marcarPedidoEntregue(supabase: SupabaseClient, pedidoId: string) {
  const { error } = await supabase.from('pedidos').update({ status: 'entregue' }).eq('id', pedidoId)
  if (error) throw error
}

/** Recusa/cancela um pedido (não entregue) — vai para o histórico em vermelho. */
export async function recusarPedido(supabase: SupabaseClient, pedidoId: string) {
  const { error } = await supabase.from('pedidos').update({ status: 'cancelado' }).eq('id', pedidoId)
  if (error) throw error
}

/** Pedidos concluídos (entregues + recusados) desde uma data — para o histórico. */
export async function listarPedidosConcluidos(supabase: SupabaseClient, restauranteId: string, desdeISO: string): Promise<Pedido[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .in('status', ['entregue', 'cancelado'])
    .gte('atualizado_em', desdeISO)
    .order('atualizado_em', { ascending: false })

  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}

// --- Portal do entregador (acesso público por token, sem login) -----------

export interface EntregadorPortal {
  id: string
  nome: string
  restauranteId: string
  restauranteNome: string
}

/** Localiza o entregador pelo token público (link/QR do portal do motoboy). */
export async function buscarEntregadorPorToken(admin: SupabaseClient, token: string): Promise<EntregadorPortal | null> {
  const { data, error } = await admin
    .from('entregadores')
    .select('id, nome, restaurante_id, restaurantes ( nome )')
    .eq('token', token)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const restaurantes = data.restaurantes as unknown as { nome: string } | { nome: string }[] | null
  const restauranteNome = Array.isArray(restaurantes) ? restaurantes[0]?.nome : restaurantes?.nome

  return {
    id: data.id,
    nome: data.nome,
    restauranteId: data.restaurante_id,
    restauranteNome: restauranteNome ?? '',
  }
}

/** Pedidos em rota atribuídos a um entregador — a "rota" do portal do motoboy. */
export async function listarPedidosEmRotaDoEntregador(admin: SupabaseClient, entregadorId: string): Promise<Pedido[]> {
  const { data, error } = await admin
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('entregador_id', entregadorId)
    .eq('status', 'em_rota')
    .order('criado_em', { ascending: true })

  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}

/** Quantas entregas esse entregador já concluiu hoje — estatística do portal. */
export async function contarEntregasConcluidasHoje(admin: SupabaseClient, entregadorId: string, desdeISO: string): Promise<number> {
  const { count, error } = await admin
    .from('pedidos')
    .select('id', { count: 'exact', head: true })
    .eq('entregador_id', entregadorId)
    .eq('status', 'entregue')
    .gte('atualizado_em', desdeISO)

  if (error) throw error
  return count ?? 0
}

/** Marca como entregue, mas só se o pedido pertencer mesmo a esse entregador e ainda estiver em rota. */
export async function marcarEntregaConcluida(admin: SupabaseClient, pedidoId: string, entregadorId: string) {
  const { data, error } = await admin
    .from('pedidos')
    .update({ status: 'entregue' })
    .eq('id', pedidoId)
    .eq('entregador_id', entregadorId)
    .eq('status', 'em_rota')
    .select('id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Pedido não encontrado para esse entregador.')
}

/** Marca um pedido da rota como não entregue/cancelado, só se pertencer a esse entregador. */
export async function marcarEntregaComProblema(admin: SupabaseClient, pedidoId: string, entregadorId: string) {
  const { data, error } = await admin
    .from('pedidos')
    .update({ status: 'cancelado' })
    .eq('id', pedidoId)
    .eq('entregador_id', entregadorId)
    .eq('status', 'em_rota')
    .select('id')
    .maybeSingle()

  if (error) throw error
  if (!data) throw new Error('Pedido não encontrado para esse entregador.')
}

/** Heartbeat do portal do motoboy: marca presença (online) e, se disponível, atualiza a localização. */
export async function registrarPresencaEntregador(admin: SupabaseClient, entregadorId: string, lat: number | null, lng: number | null) {
  const agora = new Date().toISOString()
  const update: Record<string, unknown> = { ultimo_acesso_em: agora }
  if (lat !== null && lng !== null) {
    update.localizacao_lat = lat
    update.localizacao_lng = lng
    update.localizacao_atualizada_em = agora
  }
  const { error } = await admin.from('entregadores').update(update).eq('id', entregadorId)
  if (error) throw error
}

export interface CaixaEntregador {
  recebido: number // total em dinheiro que passou pela mão do motoboy (inclui o valor usado p/ troco)
  trocoDado: number // quanto ele devolveu de troco aos clientes
  aDevolver: number // quanto ele deve devolver ao estabelecimento (recebido - trocoDado)
}

/** Caixa em dinheiro do entregador hoje — para o portal do motoboy saber quanto deve devolver à loja. */
export async function calcularCaixaEntregadorHoje(admin: SupabaseClient, entregadorId: string, desdeISO: string): Promise<CaixaEntregador> {
  const { data, error } = await admin
    .from('pedidos')
    .select('total, troco_para')
    .eq('entregador_id', entregadorId)
    .eq('forma_pagamento', 'dinheiro')
    .eq('status', 'entregue')
    .gte('atualizado_em', desdeISO)
  if (error) throw error

  let recebido = 0
  let aDevolver = 0
  for (const row of (data ?? []) as { total: number; troco_para: number | null }[]) {
    const total = Number(row.total)
    const troco = row.troco_para === null ? null : Number(row.troco_para)
    recebido += troco ?? total
    aDevolver += total
  }
  return { recebido, trocoDado: recebido - aDevolver, aDevolver }
}

// --- Despacho aberto (self-service do entregador) -------------------------

/** Lê a flag de despacho aberto da loja (operador libera os pedidos prontos pro app do motoboy). */
export async function buscarDespachoAberto(supabase: SupabaseClient, restauranteId: string): Promise<boolean> {
  const { data, error } = await supabase.from('restaurantes').select('despacho_aberto').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  return !!data?.despacho_aberto
}

/** Liga/desliga o despacho aberto da loja. */
export async function definirDespachoAberto(supabase: SupabaseClient, restauranteId: string, aberto: boolean) {
  const { error } = await supabase.from('restaurantes').update({ despacho_aberto: aberto }).eq('id', restauranteId)
  if (error) throw error
}

/** Pedidos prontos pra entrega e ainda sem entregador — o "balcão" que o motoboy pode pegar. */
export async function listarPedidosDisponiveisDespacho(admin: SupabaseClient, restauranteId: string): Promise<Pedido[]> {
  const { data, error } = await admin
    .from('pedidos')
    .select(PEDIDO_SELECT)
    .eq('restaurante_id', restauranteId)
    .eq('tipo', 'entrega')
    .eq('status', 'pronto')
    .is('entregador_id', null)
    .order('criado_em', { ascending: true })
  if (error) throw error
  return ((data ?? []) as unknown as PedidoRow[]).map(mapPedido)
}

/**
 * Motoboy pega um pedido do balcão (self-service). Guarda atômica: só funciona se
 * o pedido ainda estiver pronto e sem dono — evita dois entregadores pegando o mesmo.
 */
export async function pegarPedidoDisponivel(admin: SupabaseClient, pedidoId: string, entregadorId: string, restauranteId: string) {
  const { data, error } = await admin
    .from('pedidos')
    .update({ entregador_id: entregadorId, status: 'em_rota' })
    .eq('id', pedidoId)
    .eq('restaurante_id', restauranteId)
    .eq('tipo', 'entrega')
    .eq('status', 'pronto')
    .is('entregador_id', null)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Esse pedido já foi pego por outro entregador.')
}

export interface BadgesNav {
  novosPedidos: number // pedidos recebidos aguardando aceite
  logisticaPendente: number // prontos para entrega ainda não despachados
}

/** Contadores ao vivo para os badges do menu lateral. */
export async function contarBadgesNav(supabase: SupabaseClient, restauranteId: string): Promise<BadgesNav> {
  const [novos, logistica] = await Promise.all([
    supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId).eq('status', 'recebido'),
    supabase.from('pedidos').select('id', { count: 'exact', head: true }).eq('restaurante_id', restauranteId).eq('status', 'pronto').eq('tipo', 'entrega'),
  ])
  return { novosPedidos: novos.count ?? 0, logisticaPendente: logistica.count ?? 0 }
}

// --- Dashboard (agregados reais a partir dos pedidos) ---

export interface PedidoDashboard {
  total: number
  tipo: TipoPedido
  status: StatusPedido
  formaPagamento: FormaPagamento
  criadoEm: string
  enderecoRua: string
  enderecoNumero: string
  enderecoBairro: string
  enderecoCep: string
  itens: { itemId: string | null; nome: string; quantidade: number; receita: number }[]
}

export interface DadosDashboard {
  pedidos: PedidoDashboard[]
  grupoPorItem: Record<string, string>
}

export async function carregarDashboard(supabase: SupabaseClient, restauranteId: string): Promise<DadosDashboard> {
  const { data: pedidos, error } = await supabase
    .from('pedidos')
    .select('total, tipo, status, forma_pagamento, criado_em, endereco_rua, endereco_numero, endereco_bairro, endereco_cep, pedido_itens ( item_id, nome, quantidade, preco_unitario )')
    .eq('restaurante_id', restauranteId)
    .neq('status', 'cancelado')
  if (error) throw error

  const { data: itens } = await supabase
    .from('itens_cardapio')
    .select('id, grupos_cardapio ( nome )')
    .eq('restaurante_id', restauranteId)

  const grupoPorItem: Record<string, string> = {}
  for (const i of (itens ?? []) as unknown as { id: string; grupos_cardapio: { nome: string } | null }[]) {
    grupoPorItem[i.id] = i.grupos_cardapio?.nome ?? 'Sem grupo'
  }

  const mapped: PedidoDashboard[] = ((pedidos ?? []) as unknown as {
    total: number
    tipo: TipoPedido
    status: StatusPedido
    forma_pagamento: FormaPagamento
    criado_em: string
    endereco_rua: string | null
    endereco_numero: string | null
    endereco_bairro: string | null
    endereco_cep: string | null
    pedido_itens: { item_id: string | null; nome: string; quantidade: number; preco_unitario: number }[]
  }[]).map((p) => ({
    total: Number(p.total),
    tipo: p.tipo,
    status: p.status,
    formaPagamento: p.forma_pagamento,
    criadoEm: p.criado_em,
    enderecoRua: p.endereco_rua ?? '',
    enderecoNumero: p.endereco_numero ?? '',
    enderecoBairro: p.endereco_bairro ?? '',
    enderecoCep: p.endereco_cep ?? '',
    itens: (p.pedido_itens ?? []).map((i) => ({
      itemId: i.item_id,
      nome: i.nome,
      quantidade: i.quantidade,
      receita: Number(i.preco_unitario) * i.quantidade,
    })),
  }))

  return { pedidos: mapped, grupoPorItem }
}

// --- Fechamento de caixa por entregador ---

export interface ResumoCaixa {
  entregadorId: string
  nome: string
  valorEsperado: number // soma dos pedidos pagos em dinheiro (em rota + entregues)
  trocoLevado: number // soma dos trocos solicitados
  pedidos: number
}

/** Soma, por entregador, o dinheiro físico esperado das entregas pagas em espécie. */
export async function listarResumoCaixa(supabase: SupabaseClient, restauranteId: string): Promise<ResumoCaixa[]> {
  const { data, error } = await supabase
    .from('pedidos')
    .select('entregador_id, total, troco_para, entregadores ( nome )')
    .eq('restaurante_id', restauranteId)
    .eq('forma_pagamento', 'dinheiro')
    .not('entregador_id', 'is', null)
    .in('status', ['em_rota', 'entregue'])
  if (error) throw error

  const mapa = new Map<string, ResumoCaixa>()
  for (const row of (data ?? []) as unknown as {
    entregador_id: string
    total: number
    troco_para: number | null
    entregadores: { nome: string } | null
  }[]) {
    const atual = mapa.get(row.entregador_id) ?? {
      entregadorId: row.entregador_id,
      nome: row.entregadores?.nome ?? 'Entregador',
      valorEsperado: 0,
      trocoLevado: 0,
      pedidos: 0,
    }
    atual.valorEsperado += Number(row.total)
    atual.trocoLevado += row.troco_para === null ? 0 : Number(row.troco_para)
    atual.pedidos += 1
    mapa.set(row.entregador_id, atual)
  }
  return [...mapa.values()]
}

export async function registrarFechamentoCaixa(
  supabase: SupabaseClient,
  restauranteId: string,
  entregadorId: string,
  valorEsperado: number,
  trocoLevado: number,
  valorDeclarado: number
) {
  const { error } = await supabase.from('fechamentos_caixa').insert({
    restaurante_id: restauranteId,
    entregador_id: entregadorId,
    valor_esperado: valorEsperado,
    troco_levado: trocoLevado,
    valor_declarado: valorDeclarado,
    diferenca: valorDeclarado - valorEsperado,
    fechado_em: new Date().toISOString(),
  })
  if (error) throw error
}

// --- Criação do pedido pela vitrine (executa no servidor com service_role) ---

/** Resolve a taxa de entrega: exceção do bairro, senão a taxa padrão da loja. */
export async function calcularTaxaEntrega(admin: SupabaseClient, restauranteId: string, bairro: string): Promise<number> {
  const limpo = bairro.trim()
  if (limpo) {
    const { data } = await admin
      .from('taxas_entrega_bairro')
      .select('taxa')
      .eq('restaurante_id', restauranteId)
      .ilike('bairro', limpo)
      .maybeSingle()
    if (data) return Number(data.taxa)
  }
  const { data: loja } = await admin.from('restaurantes').select('taxa_entrega_padrao').eq('id', restauranteId).maybeSingle()
  return loja ? Number(loja.taxa_entrega_padrao) : 0
}

export interface NovoPedidoItemInput {
  itemId: string
  quantidade: number
  observacao: string
  complementos: string[] // nomes dos complementos escolhidos
  tamanhoNome?: string // nome do tamanho escolhido (substitui o preço base, não soma) — pra pizza, é o tamanho padrão da loja
  saborNome?: string // pizza: nome do sabor escolhido
  bordaNome?: string // pizza: nome da borda escolhida (opcional)
  massaNome?: string // pizza: nome da massa escolhida (opcional)
}

export interface NovoPedidoInput {
  tipo: TipoPedido
  cliente: { nome: string; telefone: string }
  endereco: { rua: string; numero: string; complemento: string; bairro: string; cep: string }
  pagamento: FormaPagamento
  trocoPara: number | null
  /** Apenas informativo — a taxa real é recalculada no servidor pelo bairro. */
  taxaEntrega?: number
  itens: NovoPedidoItemInput[]
}

/**
 * Cria um pedido a partir do checkout da vitrine. Recalcula todos os preços a
 * partir do banco (nunca confia no total enviado pelo cliente). Roda no
 * servidor com um client service_role. Retorna o número sequencial do pedido.
 */
/** Normaliza o telefone para o mesmo formato gravado em `clientes.telefone` (DDI 55 + dígitos). */
function normalizarTelefoneCliente(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, '')
  if (digitos.length < 10) return null
  return digitos.startsWith('55') ? digitos : `55${digitos}`
}

/** True se o telefone do cliente foi confirmado por OTP (clientes.verificado_em preenchido). */
async function telefoneClienteVerificado(admin: SupabaseClient, restauranteId: string, telefone: string): Promise<boolean> {
  const tel = normalizarTelefoneCliente(telefone)
  if (!tel) return false
  const { data } = await admin
    .from('clientes')
    .select('verificado_em')
    .eq('restaurante_id', restauranteId)
    .eq('telefone', tel)
    .maybeSingle()
  return !!data?.verificado_em
}

export async function criarPedido(admin: SupabaseClient, restauranteId: string, input: NovoPedidoInput): Promise<{ id: string; numero: number }> {
  if (input.itens.length === 0) throw new Error('Pedido sem itens')

  const itemIds = [...new Set(input.itens.map((i) => i.itemId))]
  const { data: itensDb, error: itensError } = await admin
    .from('itens_cardapio')
    .select(`
      id, nome, preco, promocao_preco, status, tipo_item,
      item_complementos ( nome, preco ),
      tamanhos_item ( nome, preco ),
      pizza_sabores ( nome, status, pizza_sabor_precos ( tamanho_padrao_id, preco ) )
    `)
    .eq('restaurante_id', restauranteId)
    .in('id', itemIds)
  if (itensError) throw itensError

  const byId = new Map((itensDb ?? []).map((i) => [i.id, i]))

  const precisaCatalogoPizza = (itensDb ?? []).some((i) => i.tipo_item === 'pizza')
  let tamanhosPizza: { id: string; nome: string }[] = []
  let bordasPizza: { nome: string; preco: number }[] = []
  let massasPizza: { nome: string; preco: number }[] = []
  if (precisaCatalogoPizza) {
    const [tamanhosRes, bordasRes, massasRes] = await Promise.all([
      admin.from('tamanhos_padrao_pizza').select('id, nome').eq('restaurante_id', restauranteId),
      admin.from('bordas_pizza').select('nome, preco').eq('restaurante_id', restauranteId),
      admin.from('massas_pizza').select('nome, preco').eq('restaurante_id', restauranteId),
    ])
    tamanhosPizza = tamanhosRes.data ?? []
    bordasPizza = (bordasRes.data ?? []).map((b) => ({ nome: b.nome, preco: Number(b.preco) }))
    massasPizza = (massasRes.data ?? []).map((m) => ({ nome: m.nome, preco: Number(m.preco) }))
  }

  const linhas = input.itens.map((linha) => {
    const item = byId.get(linha.itemId)
    if (!item) throw new Error(`Item ${linha.itemId} não encontrado nesta loja`)
    if (item.status !== 'disponivel') throw new Error(`Item "${item.nome}" não está disponível`)

    let base = item.promocao_preco === null || item.promocao_preco === undefined ? Number(item.preco) : Number(item.promocao_preco)
    let tamanhoNome = ''
    let saborNome = ''
    let bordaNome = ''
    let massaNome = ''

    if (item.tipo_item === 'pizza') {
      if (!linha.tamanhoNome || !linha.saborNome) throw new Error(`Selecione tamanho e sabor pra "${item.nome}"`)
      const tamanho = tamanhosPizza.find((t) => t.nome === linha.tamanhoNome)
      if (!tamanho) throw new Error(`Tamanho "${linha.tamanhoNome}" não encontrado`)
      const sabor = (item.pizza_sabores ?? []).find((s: { nome: string; status: string }) => s.nome === linha.saborNome)
      if (!sabor || sabor.status !== 'disponivel') throw new Error(`Sabor "${linha.saborNome}" não encontrado para o item "${item.nome}"`)
      const precoSabor = sabor.pizza_sabor_precos.find((p: { tamanho_padrao_id: string; preco: number }) => p.tamanho_padrao_id === tamanho.id)
      base = precoSabor ? Number(precoSabor.preco) : 0
      tamanhoNome = tamanho.nome
      saborNome = sabor.nome
      if (linha.bordaNome) {
        const borda = bordasPizza.find((b) => b.nome === linha.bordaNome)
        if (borda) { base += borda.preco; bordaNome = borda.nome }
      }
      if (linha.massaNome) {
        const massa = massasPizza.find((m) => m.nome === linha.massaNome)
        if (massa) { base += massa.preco; massaNome = massa.nome }
      }
    } else if (linha.tamanhoNome) {
      const tamanho = (item.tamanhos_item ?? []).find((t: { nome: string; preco: number }) => t.nome === linha.tamanhoNome)
      if (!tamanho) throw new Error(`Tamanho "${linha.tamanhoNome}" não encontrado para o item "${item.nome}"`)
      base = Number(tamanho.preco)
      tamanhoNome = tamanho.nome
    }

    const complementos: PedidoComplementoSnapshot[] = []
    for (const nome of linha.complementos) {
      const comp = (item.item_complementos ?? []).find((c: { nome: string; preco: number }) => c.nome === nome)
      if (comp) complementos.push({ nome: comp.nome, preco: Number(comp.preco) })
    }
    const precoUnitario = base + complementos.reduce((s, c) => s + c.preco, 0)
    const quantidade = Math.max(1, Math.floor(linha.quantidade))
    return {
      item_id: linha.itemId,
      nome: item.nome,
      preco_unitario: precoUnitario,
      quantidade,
      observacao: linha.observacao ?? '',
      complementos,
      tamanho_nome: tamanhoNome,
      sabor_nome: saborNome,
      borda_nome: bordaNome,
      massa_nome: massaNome,
    }
  })

  const subtotal = linhas.reduce((s, l) => s + l.preco_unitario * l.quantidade, 0)
  const taxaEntrega = input.tipo === 'entrega' ? await calcularTaxaEntrega(admin, restauranteId, input.endereco.bairro) : 0
  const total = subtotal + taxaEntrega

  // Telefone verificado? (server-authoritative). Pedidos feitos com o WhatsApp da
  // loja offline entram pelo fallback do checkout com o cliente não verificado.
  const telefoneVerificado = await telefoneClienteVerificado(admin, restauranteId, input.cliente.telefone)

  const { data: pedido, error: pedidoError } = await admin
    .from('pedidos')
    .insert({
      restaurante_id: restauranteId,
      tipo: input.tipo,
      status: 'recebido',
      cliente_nome: input.cliente.nome,
      cliente_telefone: input.cliente.telefone,
      telefone_verificado: telefoneVerificado,
      endereco_rua: input.endereco.rua,
      endereco_numero: input.endereco.numero,
      endereco_complemento: input.endereco.complemento,
      endereco_bairro: input.endereco.bairro,
      endereco_cep: input.endereco.cep,
      forma_pagamento: input.pagamento,
      troco_para: input.pagamento === 'dinheiro' ? input.trocoPara : null,
      pago: input.pagamento === 'pix',
      subtotal,
      taxa_entrega: taxaEntrega,
      total,
      observacao: '',
    })
    .select('id, numero')
    .single()
  if (pedidoError) throw pedidoError

  const { error: itensInsertError } = await admin.from('pedido_itens').insert(
    linhas.map((l) => ({ ...l, pedido_id: pedido.id }))
  )
  if (itensInsertError) throw itensInsertError

  return { id: pedido.id, numero: pedido.numero }
}

export interface PedidoClienteItem {
  nome: string
  quantidade: number
  tamanhoNome: string
  saborNome: string
}

export interface PedidoCliente {
  id: string
  numero: number
  status: StatusPedido
  tipo: TipoPedido
  total: number
  taxaEntrega: number
  formaPagamento: FormaPagamento
  criadoEm: string
  itens: PedidoClienteItem[]
}

/** Histórico + acompanhamento dos pedidos de um cliente da vitrine (identificado pelo telefone da sessão). */
export async function listarPedidosDoCliente(admin: SupabaseClient, restauranteId: string, telefone: string): Promise<PedidoCliente[]> {
  const { data, error } = await admin
    .from('pedidos')
    .select('id, numero, status, tipo, total, taxa_entrega, forma_pagamento, criado_em, pedido_itens ( nome, quantidade, tamanho_nome, sabor_nome )')
    .eq('restaurante_id', restauranteId)
    .eq('cliente_telefone', telefone)
    .order('criado_em', { ascending: false })
    .limit(50)
  if (error) throw error
  return ((data ?? []) as unknown as {
    id: string
    numero: number
    status: StatusPedido
    tipo: TipoPedido
    total: number
    taxa_entrega: number
    forma_pagamento: FormaPagamento
    criado_em: string
    pedido_itens: { nome: string; quantidade: number; tamanho_nome: string | null; sabor_nome: string | null }[]
  }[]).map((p) => ({
    id: p.id,
    numero: p.numero,
    status: p.status,
    tipo: p.tipo,
    total: Number(p.total),
    taxaEntrega: Number(p.taxa_entrega),
    formaPagamento: p.forma_pagamento,
    criadoEm: p.criado_em,
    itens: (p.pedido_itens ?? []).map((i) => ({
      nome: i.nome,
      quantidade: i.quantidade,
      tamanhoNome: i.tamanho_nome ?? '',
      saborNome: i.sabor_nome ?? '',
    })),
  }))
}

/** Status do pedido para a tela de acompanhamento da vitrine (sem expor dados de outros). */
export async function buscarStatusPedido(admin: SupabaseClient, pedidoId: string): Promise<{ numero: number; status: StatusPedido } | null> {
  const { data, error } = await admin.from('pedidos').select('numero, status').eq('id', pedidoId).maybeSingle()
  if (error) throw error
  return data ? { numero: data.numero, status: data.status as StatusPedido } : null
}

/** Pedido completo + dados da loja, para montar e enviar a mensagem de WhatsApp. */
export async function buscarPedidoParaNotificacao(
  admin: SupabaseClient,
  pedidoId: string
): Promise<{ pedido: Pedido; restauranteNome: string; evolutionInstance: string | null } | null> {
  const { data, error } = await admin
    .from('pedidos')
    .select(`${PEDIDO_SELECT}, restaurantes ( nome, evolution_instance )`)
    .eq('id', pedidoId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  const { restaurantes, ...row } = data as unknown as PedidoRow & {
    restaurantes: { nome: string; evolution_instance: string | null } | null
  }
  return {
    pedido: mapPedido(row as PedidoRow),
    restauranteNome: restaurantes?.nome ?? '',
    evolutionInstance: restaurantes?.evolution_instance ?? null,
  }
}
