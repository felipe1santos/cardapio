import type { SupabaseClient } from '@supabase/supabase-js'
import { lancar } from '@/lib/financeiro/ledger'
import { turnoAberto } from '@/lib/financeiro/caixa'
import { coordenadasDosPedidos } from '@/lib/mapa/coordenadas-pedidos'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'
import { buscarPedidoParaNotificacao, type Pedido, type StatusPedido } from '@/lib/queries/pedidos'
import { enviarWhatsapp, formatarTelefoneWhatsapp } from '@/lib/whatsapp'
import { registrarAuditoria } from '@/lib/auditoria'
import { buscarConfigCanal, type ConfigCanal } from '@/lib/canais/config'
import { cancelarEntregaIfood, cotarIfoodEntrega, criarEntregaIfood } from '@/lib/custo/ifood-entrega'
import { buscarEntregaFoody, cancelarEntregaFoody, cotarFoody, criarEntregaFoody, type ContaFoody } from '@/lib/custo/foody-logistica'
import { buscarEntregaUber, cancelarEntregaUber, cotarUber, criarEntregaUber, statusDeUber, type ContaUber, type EnderecoUber } from '@/lib/custo/uber-direct'
import { STATUS_FIM_SEM_ENTREGA, corridaAtiva, type RespostaCotacao } from './lalamove-regras'
import { ENTREGA_PROVEDOR_SELECT, mapEntregaProvedor, type EntregaProvedorLinha } from './lalamove-status'
import { EntregaError, pedidoDaLoja, sincronizarCorrida } from './lalamove-servidor'
import { apagarCorrida, atualizarCorrida, buscarConfig, corridaAtivaDoPedido, criarCorrida, marcosDaCorrida, PROVEDOR_DISPONIVEL, registrarEventoCorrida, type ConfigProvedor, type ProvedorEntrega } from './queries'

/**
 * Provedores de entrega além da Lalamove (Etapa 3, 19/10): entregador do iFood (Sob Demanda) e Foody (Open Delivery
 * Logistics). Mesmo fluxo do Kanban: cotação → o dono confirma → corrida em entregas_provedor → eventos (webhook/
 * polling) → PICKED_UP move o pedido para em rota, COMPLETED conclui pelos mesmos efeitos do Kanban e lança o custo da
 * corrida no Financeiro; CANCELED/REJECTED devolvem o pedido para "pronto". Status NORMALIZADO para o vocabulário da
 * Lalamove (lib/entregas/lalamove-status.ts), então card, painel e financeiro não mudam.
 */
// 'machine' (20/10): Machine/Gaudium pela MESMA logística Open Delivery da Foody (lib/custo/foody-logistica.ts), com guarda e nome próprios.
// 'uber' (21/10): Uber Direct, API própria da Uber (lib/custo/uber-direct.ts).
export type ProvedorNovo = 'ifood' | 'foody' | 'machine' | 'uber'
export const ehProvedorNovo = (v: unknown): v is ProvedorNovo => v === 'ifood' || v === 'foody' || v === 'machine' || v === 'uber'
export const NOME_PROVEDOR: Record<ProvedorEntrega, string> = { lalamove: 'Lalamove', ifood: 'Entregador iFood', foody: 'Foody', machine: 'Machine', uber: 'Uber Direct' }

/** Evento do Open Delivery Logistics → status da corrida. Puro. */
export function statusDeEventoOd(tipo: string): string | null {
  switch ((tipo || '').toUpperCase()) {
    case 'PENDING': case 'ACCEPTED': return 'ASSIGNING_DRIVER'
    case 'PICKUP_ONGOING': case 'ARRIVED_AT_MERCHANT': return 'ON_GOING'
    case 'ORDER_PICKED': case 'DELIVERY_ONGOING': case 'ARRIVED_AT_CUSTOMER': return 'PICKED_UP'
    case 'ORDER_DELIVERED': case 'DELIVERY_FINISHED': return 'COMPLETED'
    case 'RETURNING_TO_MERCHANT': case 'RETURNED_TO_MERCHANT': case 'CANCELLED': return 'CANCELED'
    case 'REJECTED': return 'REJECTED'
    default: return null
  }
}

/** Evento de entrega do iFood (código/fullCode do polling) → status da corrida. Puro. */
export function statusDeEventoIfood(codigo: string): string | null {
  const c = (codigo || '').toUpperCase()
  if (/CONCLUDED|DELIVERED/.test(c)) return 'COMPLETED'
  if (/CANCEL/.test(c)) return 'CANCELED'
  if (/FAIL|REJECT|DENIED/.test(c)) return 'REJECTED'
  if (/DISPATCH|PICKED|GOING_TO_DESTINATION|ARRIVED_AT_DESTINATION|ARRIVED_AT_CUSTOMER/.test(c)) return 'PICKED_UP'
  if (/ASSIGN|GOING_TO_ORIGIN|ARRIVED_AT_ORIGIN|ARRIVED_AT_MERCHANT|DRIVER/.test(c)) return 'ON_GOING'
  if (/REQUEST|PLACED|PENDING|CREATED/.test(c)) return 'ASSIGNING_DRIVER'
  return null
}

interface Loja { id: string; nome: string; telefone: string; endereco: string; rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string; lat: number | null; lng: number | null; financeiroAtivo: boolean }
async function lojaDe(admin: SupabaseClient, restauranteId: string): Promise<Loja> {
  const { data, error } = await admin.from('restaurantes').select('id, nome, telefone, endereco, endereco_rua, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_estado, cep, latitude, longitude, financeiro_ativo').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  if (!data) throw new EntregaError('Loja não encontrada.', 404)
  const r = data as Record<string, unknown>
  const s = (v: unknown) => String(v ?? '')
  return {
    id: s(r.id), nome: s(r.nome), telefone: s(r.telefone), endereco: s(r.endereco), rua: s(r.endereco_rua), numero: s(r.endereco_numero), complemento: s(r.endereco_complemento), bairro: s(r.endereco_bairro),
    cidade: s(r.endereco_cidade), estado: s(r.endereco_estado) || 'ES', cep: s(r.cep).replace(/\D/g, ''),
    lat: r.latitude === null || r.latitude === undefined ? null : Number(r.latitude), lng: r.longitude === null || r.longitude === undefined ? null : Number(r.longitude), financeiroAtivo: r.financeiro_ativo === true,
  }
}

/** Config do provedor pronta para uso (ligada e com o que precisa). iFood usa as credenciais do canal iFood. */
export async function configProvedorPronta(admin: SupabaseClient, restauranteId: string, provedor: ProvedorNovo): Promise<{ cfg: ConfigProvedor; canalIfood: ConfigCanal | null; contaFoody: ContaFoody | null; contaUber?: ContaUber | null }> {
  if (!PROVEDOR_DISPONIVEL[provedor]) throw new EntregaError(`${NOME_PROVEDOR[provedor]}: em breve. A Menuzia ainda está homologando esta integração.`, 409)
  const cfg = await buscarConfig(admin, restauranteId, provedor)
  if (!cfg) throw new EntregaError(`${NOME_PROVEDOR[provedor]} ainda não configurado. Veja Integrações.`, 400)
  if (!cfg.ativo) throw new EntregaError(`${NOME_PROVEDOR[provedor]} está desligado nesta loja (Integrações).`, 400)
  if (provedor === 'ifood') {
    const canal = await buscarConfigCanal(admin, restauranteId, 'ifood')
    if (!canal?.credenciais || !canal.merchantIdExterno) throw new EntregaError('Conecte a loja ao iFood em Integrações › iFood (credenciais e id da loja) antes de chamar o entregador.', 400)
    return { cfg, canalIfood: canal, contaFoody: null }
  }
  if (provedor === 'uber') {
    if (!cfg.chaves || !cfg.contaId) throw new EntregaError('Cole o Customer ID, o Client ID e o Client Secret em Integrações › Uber Direct.', 400)
    return { cfg, canalIfood: null, contaFoody: null, contaUber: { customerId: cfg.contaId, clientId: cfg.chaves.apiKey, clientSecret: cfg.chaves.apiSecret, teste: cfg.ambiente !== 'producao' } }
  }
  if (!cfg.chaves || !cfg.baseUrl) throw new EntregaError(`Cole a URL base, o Client ID e o Client Secret em Integrações › ${NOME_PROVEDOR[provedor]}.`, 400)
  return { cfg, canalIfood: null, contaFoody: { baseUrl: cfg.baseUrl, clientId: cfg.chaves.apiKey, clientSecret: cfg.chaves.apiSecret, api: provedor === 'machine' ? 'machine' : 'foody', nome: NOME_PROVEDOR[provedor] } }
}

/** Quais provedores o Kanban deve oferecer nesta loja (20/10: disponível + ligado + credenciais; sem módulo pago). */
export async function provedoresAtivos(admin: SupabaseClient, restauranteId: string): Promise<ProvedorEntrega[]> {
  const out: ProvedorEntrega[] = []
  if (PROVEDOR_DISPONIVEL.lalamove) { const c = await buscarConfig(admin, restauranteId, 'lalamove').catch(() => null); if (c?.ativo && c.chaves) out.push('lalamove') }
  if (PROVEDOR_DISPONIVEL.ifood) { const c = await buscarConfig(admin, restauranteId, 'ifood').catch(() => null); if (c?.ativo) out.push('ifood') }
  if (PROVEDOR_DISPONIVEL.foody) { const c = await buscarConfig(admin, restauranteId, 'foody').catch(() => null); if (c?.ativo && c.chaves && c.baseUrl) out.push('foody') }
  if (PROVEDOR_DISPONIVEL.machine) { const c = await buscarConfig(admin, restauranteId, 'machine').catch(() => null); if (c?.ativo && c.chaves && c.baseUrl) out.push('machine') }
  if (PROVEDOR_DISPONIVEL.uber) { const c = await buscarConfig(admin, restauranteId, 'uber').catch(() => null); if (c?.ativo && c.chaves && c.contaId) out.push('uber') }
  return out
}

export type CotacaoProvedor = RespostaCotacao & { pedidoNumero: number; pagamentoNaEntrega: boolean; trocoPara: number | null; ambiente: string; prazoMin: number | null; provedor: ProvedorNovo }

async function destinoDoPedido(admin: SupabaseClient, restauranteId: string, pedido: Pedido, loja: Loja) {
  if (pedido.status !== 'pronto') throw new EntregaError(`O pedido #${pedido.numero} não está pronto para despacho.`, 409)
  if (await corridaAtivaDoPedido(admin, pedido.id)) throw new EntregaError('Este pedido já tem uma corrida de entregador em andamento.', 409)
  if (loja.lat === null || loja.lng === null) throw new EntregaError('A loja está sem localização no mapa. Confira o endereço em Ajustes › Perfil da loja.', 400)
  const coords = await coordenadasDosPedidos(admin, restauranteId, [pedido.id])
  const c = coords[pedido.id]
  if (!c) throw new EntregaError('Não foi possível localizar o endereço do cliente no mapa. Confira o endereço do pedido.', 400)
  return c
}

/** Endereços no formato da Uber Direct (coordenadas da loja e do pedido geocodificado — nunca do navegador). */
const enderecoDaLoja = (l: Loja): EnderecoUber => ({ rua: l.rua, numero: l.numero, complemento: l.complemento, bairro: l.bairro, cidade: l.cidade, estado: l.estado, cep: l.cep, lat: l.lat as number, lng: l.lng as number })
const enderecoDoCliente = (p: Pedido, l: Loja, c: { lat: number; lng: number }): EnderecoUber => ({ rua: p.enderecoRua, numero: p.enderecoNumero, complemento: p.enderecoComplemento ?? '', bairro: p.enderecoBairro, cidade: p.enderecoCidade || l.cidade, estado: l.estado, cep: p.enderecoCep ?? '', lat: c.lat, lng: c.lng })

const enderecoOd = (p: { rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string; referencia: string; lat: number; lng: number }) =>
  ({ street: p.rua, number: p.numero, complement: p.complemento, district: p.bairro, city: p.cidade, state: p.estado, postalCode: p.cep, reference: p.referencia, latitude: p.lat, longitude: p.lng })

export async function cotarProvedor(admin: SupabaseClient, restauranteId: string, provedor: ProvedorNovo, pedidoId: string): Promise<CotacaoProvedor> {
  const { cfg, canalIfood, contaFoody, contaUber } = await configProvedorPronta(admin, restauranteId, provedor)
  const [loja, pedido] = await Promise.all([lojaDe(admin, restauranteId), pedidoDaLoja(admin, restauranteId, pedidoId)])
  // Uber Direct não cobra o cliente na entrega: só pedido já pago (Pix/cartão online).
  if (provedor === 'uber' && !pedido.pago) throw new EntregaError('A Uber Direct não cobra na entrega: use para pedido já pago. Para pagamento na entrega, use outro entregador.', 409)
  const c = await destinoDoPedido(admin, restauranteId, pedido, loja)
  const enderecoCliente = [pedido.enderecoRua, pedido.enderecoNumero, pedido.enderecoBairro, pedido.enderecoCidade || loja.cidade].filter(Boolean).join(', ')
  const base = { pedidoNumero: pedido.numero, pagamentoNaEntrega: !pedido.pago, trocoPara: pedido.formaPagamento === 'dinheiro' ? pedido.trocoPara : null, ambiente: cfg.ambiente, moeda: 'BRL', paradas: [loja.endereco || loja.nome, enderecoCliente], provedor }
  if (provedor === 'ifood') {
    const q = await cotarIfoodEntrega(admin, restauranteId, canalIfood as ConfigCanal, (canalIfood as ConfigCanal).merchantIdExterno, { lat: c.lat, lng: c.lng }, pedidoId)
    return { ...base, quotationId: q.quoteId, preco: q.preco, distanciaM: q.distanciaM, expiraEm: q.expiraEm ?? new Date(Date.now() + 5 * 60_000).toISOString(), prazoMin: q.prazoMin }
  }
  if (provedor === 'uber') {
    const q = await cotarUber(admin, restauranteId, contaUber as ContaUber, { origem: enderecoDaLoja(loja), destino: enderecoDoCliente(pedido, loja, c), telefoneLoja: loja.telefone, telefoneCliente: pedido.clienteTelefone, valorPedido: pedido.total, lojaId: restauranteId }, pedidoId)
    return { ...base, quotationId: q.quoteId, preco: q.preco, distanciaM: null, expiraEm: q.expiraEm ?? new Date(Date.now() + 10 * 60_000).toISOString(), prazoMin: q.prazoMin }
  }
  const q = await cotarFoody(admin, restauranteId, contaFoody as ContaFoody, {
    merchant: { id: restauranteId, name: loja.nome },
    pickup: enderecoOd({ rua: loja.rua, numero: loja.numero, complemento: loja.complemento, bairro: loja.bairro, cidade: loja.cidade, estado: loja.estado, cep: loja.cep, referencia: '', lat: loja.lat as number, lng: loja.lng as number }),
    delivery: enderecoOd({ rua: pedido.enderecoRua, numero: pedido.enderecoNumero, complemento: pedido.enderecoComplemento ?? '', bairro: pedido.enderecoBairro, cidade: pedido.enderecoCidade || loja.cidade, estado: loja.estado, cep: pedido.enderecoCep ?? '', referencia: pedido.enderecoReferencia ?? '', lat: c.lat, lng: c.lng }),
    totalOrderPrice: pedido.total, orderDeliveryFee: Number((pedido as { taxaEntrega?: number }).taxaEntrega ?? 0), specialInstructions: pedido.observacao ?? '',
  }, pedidoId)
  if (!q.disponivel) throw new EntregaError(`${NOME_PROVEDOR[provedor]} não atende este endereço agora.`, 409)
  // Open Delivery não tem id de cotação: o preço vale 5 min e a entrega é pedida com os mesmos dados.
  return { ...base, quotationId: `od:${pedidoId}:${Date.now()}`, preco: q.preco, distanciaM: null, expiraEm: new Date(Date.now() + 5 * 60_000).toISOString(), prazoMin: q.deliveryEtaMin }
}

export async function chamarProvedor(admin: SupabaseClient, restauranteId: string, provedor: ProvedorNovo, pedidoId: string, cotacao: RespostaCotacao, por: { id: string | null; nome: string }): Promise<EntregaProvedorLinha> {
  const { cfg, canalIfood, contaFoody, contaUber } = await configProvedorPronta(admin, restauranteId, provedor)
  const [loja, pedido] = await Promise.all([lojaDe(admin, restauranteId), pedidoDaLoja(admin, restauranteId, pedidoId)])
  if (pedido.status !== 'pronto') throw new EntregaError(`O pedido #${pedido.numero} não está mais pronto para despacho.`, 409)
  if (cotacao.paradas.length < 2) throw new EntregaError('Cotação incompleta. Cote de novo.', 400)
  // Coordenadas do cliente vêm do pedido (geocodificado uma vez), nunca do navegador.
  const destino = (await coordenadasDosPedidos(admin, restauranteId, [pedidoId]))[pedidoId]
  if (!destino) throw new EntregaError('Não foi possível localizar o endereço do cliente no mapa.', 400)
  const linha = await criarCorrida(admin, { restauranteId, pedidoId, ambiente: cfg.ambiente, cotacaoId: cotacao.quotationId, preco: cotacao.preco, distanciaM: cotacao.distanciaM, porNome: por.nome, provedor })
  let externoId: string
  let status = 'ASSIGNING_DRIVER'
  let shareLink: string | null = null
  try {
    if (provedor === 'ifood') {
      const r = await criarEntregaIfood(admin, restauranteId, canalIfood as ConfigCanal, (canalIfood as ConfigCanal).merchantIdExterno, {
        quoteId: cotacao.quotationId, numero: pedido.numero, cliente: { nome: pedido.clienteNome, telefone: pedido.clienteTelefone },
        endereco: { rua: pedido.enderecoRua, numero: pedido.enderecoNumero, complemento: pedido.enderecoComplemento ?? '', bairro: pedido.enderecoBairro, cidade: pedido.enderecoCidade || loja.cidade, estado: loja.estado, cep: pedido.enderecoCep ?? '', referencia: pedido.enderecoReferencia ?? '', lat: destino.lat, lng: destino.lng },
        itens: pedido.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, precoUnitario: i.precoUnitario })), total: pedido.total,
        pagamento: { forma: pedido.formaPagamento as 'pix' | 'cartao' | 'dinheiro', prepago: pedido.pago === true, trocoPara: pedido.trocoPara ?? null }, observacao: pedido.observacao ?? '',
      })
      externoId = r.id
      if (r.status) status = statusDeEventoIfood(r.status) ?? 'ASSIGNING_DRIVER'
    } else if (provedor === 'uber') {
      const r = await criarEntregaUber(admin, restauranteId, contaUber as ContaUber, {
        quoteId: cotacao.quotationId, pedidoId, numero: pedido.numero,
        loja: { nome: loja.nome, telefone: loja.telefone, endereco: enderecoDaLoja(loja) },
        cliente: { nome: pedido.clienteNome, telefone: pedido.clienteTelefone, endereco: enderecoDoCliente(pedido, loja, destino), referencia: pedido.enderecoReferencia ?? '' },
        itens: pedido.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade })), total: pedido.total, observacao: pedido.observacao ?? '',
      })
      externoId = r.id
      status = statusDeUber(r.status) ?? 'ASSIGNING_DRIVER'
      shareLink = r.trackingUrl
    } else {
      const r = await criarEntregaFoody(admin, restauranteId, contaFoody as ContaFoody, {
        orderId: pedidoId, orderDisplayId: String(pedido.numero), merchant: { id: restauranteId, name: loja.nome },
        pickup: enderecoOd({ rua: loja.rua, numero: loja.numero, complemento: loja.complemento, bairro: loja.bairro, cidade: loja.cidade, estado: loja.estado, cep: loja.cep, referencia: '', lat: loja.lat as number, lng: loja.lng as number }),
        delivery: enderecoOd({ rua: pedido.enderecoRua, numero: pedido.enderecoNumero, complemento: pedido.enderecoComplemento ?? '', bairro: pedido.enderecoBairro, cidade: pedido.enderecoCidade || loja.cidade, estado: loja.estado, cep: pedido.enderecoCep ?? '', referencia: pedido.enderecoReferencia ?? '', lat: destino.lat, lng: destino.lng }),
        customerName: pedido.clienteNome, customerPhone: pedido.clienteTelefone.replace(/\D/g, ''), totalOrderPrice: pedido.total, orderDeliveryFee: Number((pedido as { taxaEntrega?: number }).taxaEntrega ?? 0),
        items: pedido.itens.map((i) => ({ name: i.nome, quantity: i.quantidade })), pagamento: { prepago: pedido.pago === true, forma: pedido.formaPagamento as 'pix' | 'cartao' | 'dinheiro', valor: pedido.total }, specialInstructions: pedido.observacao ?? '',
      })
      externoId = r.deliveryId
      status = (r.event && statusDeEventoOd(r.event)) || 'ASSIGNING_DRIVER'
      shareLink = r.trackingUrl
    }
  } catch (e) {
    await apagarCorrida(admin, linha.id).catch(() => {})
    throw e
  }
  await atualizarCorrida(admin, linha.id, { externoId, status, shareLink })
  await registrarEventoCorrida(admin, linha.id, { tipo: 'criada', status, por: por.nome, provedor })
  await registrarAuditoria(admin, { restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: `entregas.${provedor}_chamada`, entidade: 'pedido', entidadeId: pedidoId, dados: { numero: pedido.numero, preco: cotacao.preco, externoId } }).catch(() => null)
  return { ...linha, externoId, status, shareLink }
}

export async function cancelarProvedor(admin: SupabaseClient, restauranteId: string, corrida: EntregaProvedorLinha, por: { id: string | null; nome: string }): Promise<void> {
  if (corrida.restauranteId !== restauranteId) throw new EntregaError('Corrida não encontrada nesta loja.', 404)
  if (!corridaAtiva(corrida.status)) throw new EntregaError('Esta corrida já terminou.', 409)
  if (!corrida.externoId) throw new EntregaError('Corrida sem número no provedor.', 409)
  const provedor = corrida.provedor as ProvedorNovo
  const { canalIfood, contaFoody, contaUber } = await configProvedorPronta(admin, restauranteId, provedor)
  if (provedor === 'ifood') await cancelarEntregaIfood(admin, restauranteId, canalIfood as ConfigCanal, corrida.externoId)
  else if (provedor === 'uber') await cancelarEntregaUber(admin, restauranteId, contaUber as ContaUber, corrida.externoId)
  else await cancelarEntregaFoody(admin, restauranteId, contaFoody as ContaFoody, corrida.externoId, 'Cancelado pela loja')
  await atualizarCorrida(admin, corrida.id, { status: 'CANCELED', canceladoPorNome: por.nome })
  await registrarEventoCorrida(admin, corrida.id, { tipo: 'cancelada_pelo_menuzia', por: por.nome })
  await encerrarNoPedido(admin, corrida, 'CANCELED')
  await registrarAuditoria(admin, { restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: `entregas.${provedor}_cancelada`, entidade: 'pedido', entidadeId: corrida.pedidoId, dados: { corrida: corrida.externoId } }).catch(() => null)
}

/** Uber: consulta a entrega na própria Uber e aplica o status (botão "Atualizar"; plano B do webhook). */
export async function atualizarCorridaUber(admin: SupabaseClient, restauranteId: string, corrida: EntregaProvedorLinha): Promise<{ status: string; mudou: boolean }> {
  if (!corrida.externoId) throw new EntregaError('Corrida sem número na Uber.', 409)
  const { contaUber } = await configProvedorPronta(admin, restauranteId, 'uber')
  const r = await buscarEntregaUber(admin, restauranteId, contaUber as ContaUber, corrida.externoId)
  const novo = statusDeUber(r.status)
  if (!novo) return { status: corrida.status, mudou: false }
  return aplicarEventoCorrida(admin, corrida, novo, { motorista: r.motorista, shareLink: r.trackingUrl, preco: r.preco, evento: { tipo: 'consulta', status: r.status, liveMode: r.liveMode }, origem: 'consulta' })
}

/**
 * Cron de 1 min (/api/cron/canais), 21/10: corridas EM ANDAMENTO (Uber, Lalamove, Foody, Machine) sem novidade há 50 s
 * são consultadas no próprio parceiro. Sem webhook configurado (ou com webhook falhando) o pedido anda do mesmo jeito;
 * terminada/cancelada a corrida, ela sai da consulta. Webhook funcionando = corrida sempre "fresca" = não consulta.
 */
export async function sincronizarCorridasAtivas(admin: SupabaseClient): Promise<{ consultadas: number; mudaram: number; erros: string[] }> {
  const out = { consultadas: 0, mudaram: 0, erros: [] as string[] }
  const { data, error } = await admin.from('entregas_provedor').select(ENTREGA_PROVEDOR_SELECT).in('provedor', ['uber', 'lalamove', 'foody', 'machine']).in('status', ['ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP']).lt('atualizado_em', new Date(Date.now() - 50_000).toISOString()).limit(40)
  if (error) { out.erros.push(error.message); return out }
  for (const linha of data ?? []) {
    const corrida = mapEntregaProvedor(linha as Record<string, unknown>)
    try {
      let r: { status: string; mudou: boolean }
      if (corrida.provedor === 'uber') r = await atualizarCorridaUber(admin, corrida.restauranteId, corrida)
      else if (corrida.provedor === 'lalamove') {
        const cfg = await buscarConfig(admin, corrida.restauranteId, 'lalamove')
        if (!cfg) continue
        r = await sincronizarCorrida(admin, cfg, corrida, 'painel')
      } else {
        const { contaFoody } = await configProvedorPronta(admin, corrida.restauranteId, corrida.provedor as ProvedorNovo)
        if (!corrida.externoId || !contaFoody) continue
        const e = await buscarEntregaFoody(admin, corrida.restauranteId, contaFoody, corrida.pedidoId)
        const novo = statusDeEventoOd(e.tipo)
        if (!novo) { await atualizarCorrida(admin, corrida.id, {}); continue }
        r = await aplicarEventoCorrida(admin, corrida, novo, { motorista: e.motorista, shareLink: e.trackingUrl, evento: { tipo: 'consulta', status: e.tipo }, origem: 'consulta' })
      }
      out.consultadas++
      if (r.mudou) out.mudaram++
    } catch (e) { out.erros.push(`${corrida.provedor} ${corrida.externoId?.slice(0, 12)}: ${(e as Error).message?.slice(0, 80)}`) }
  }
  return out
}

async function moverPedido(admin: SupabaseClient, pedidoId: string, de: StatusPedido[], para: StatusPedido): Promise<boolean> {
  const { data, error } = await admin.from('pedidos').update({ status: para }).eq('id', pedidoId).in('status', de).select('id')
  if (error) throw error
  return !!data?.length
}
async function encerrarNoPedido(admin: SupabaseClient, corrida: EntregaProvedorLinha, status: string): Promise<void> {
  if (!STATUS_FIM_SEM_ENTREGA.includes(status)) return
  const voltou = await moverPedido(admin, corrida.pedidoId, ['em_rota'], 'pronto')
  if (voltou) console.warn(`[${corrida.provedor}] corrida ${corrida.externoId} ${status}: pedido ${corrida.pedidoId} voltou para pronto.`)
}

async function lancarCustoCorrida(admin: SupabaseClient, corrida: EntregaProvedorLinha, preco: number, numero: number, financeiroAtivo: boolean): Promise<void> {
  if (!financeiroAtivo || !(preco > 0)) return
  const marcos = await marcosDaCorrida(admin, corrida.id)
  if (marcos.custoLancadoEm) return
  const centavos = Math.round(preco * 100)
  const turno = await turnoAberto(admin, corrida.restauranteId).catch(() => null)
  const nome = NOME_PROVEDOR[corrida.provedor as ProvedorEntrega] ?? corrida.provedor
  const dados = { provedor: corrida.provedor, corrida: corrida.externoId, entrega_id: corrida.id }
  const r = await lancar(admin, {
    restauranteId: corrida.restauranteId, turnoId: turno?.id ?? null, chave: `${corrida.provedor}:${corrida.id}`, origem: 'delivery', usuario: { id: null, nome }, motivo: `Corrida ${nome} do pedido #${numero}`,
    linhas: [
      { carteira: 'empresa', tipo: 'despesa', valorCentavos: -centavos, forma: 'outro', pedidoId: corrida.pedidoId, dados },
      { carteira: 'resultado', tipo: 'despesa', valorCentavos: -centavos, forma: 'outro', pedidoId: corrida.pedidoId, dados },
    ],
  })
  if (r.ok) await atualizarCorrida(admin, corrida.id, { custoLancadoEm: new Date().toISOString() })
  else console.error(`[${corrida.provedor}] custo não lançado:`, r.erro)
}

async function avisarClienteRastreio(admin: SupabaseClient, corrida: EntregaProvedorLinha, shareLink: string | null, motorista: { nome: string; placa: string } | null): Promise<void> {
  const marcos = await marcosDaCorrida(admin, corrida.id)
  if (marcos.clienteAvisadoEm) return
  const dados = await buscarPedidoParaNotificacao(admin, corrida.pedidoId)
  if (!dados?.evolutionInstance) return
  const numero = formatarTelefoneWhatsapp(dados.pedido.clienteTelefone)
  if (!numero) return
  const nome = (dados.pedido.clienteNome ?? '').trim().split(/\s+/)[0]
  const linhas = ['*🛵 Entregador a caminho!*', '', `${nome ? `${nome}, ` : ''}o pedido *#${dados.pedido.numero}* da *${dados.restauranteNome}* já tem entregador${motorista?.nome ? `: *${motorista.nome}*` : ''}${motorista?.placa ? ` (placa ${motorista.placa})` : ''}.`, ...(shareLink ? ['', 'Acompanhe a entrega em tempo real:', shareLink] : [])]
  const ok = await enviarWhatsapp(numero, linhas.join('\n'), dados.evolutionInstance, { admin, origem: 'automatico', restauranteId: corrida.restauranteId })
  if (ok) await atualizarCorrida(admin, corrida.id, { clienteAvisadoEm: new Date().toISOString() })
}

/**
 * Aplica um evento do provedor (webhook da Foody, polling do iFood) à corrida e ao pedido — a MESMA máquina da Lalamove:
 * ON_GOING/PICKED_UP com entregador → aviso de rastreio; PICKED_UP → pedido em rota; COMPLETED → entregue + custo;
 * CANCELED/REJECTED → pedido volta para pronto. Idempotente; corrida encerrada não reabre por evento atrasado.
 */
export async function aplicarEventoCorrida(admin: SupabaseClient, corrida: EntregaProvedorLinha, novo: string, extra: { motorista?: { nome: string; telefone?: string | null; placa?: string | null; id?: string | null } | null; shareLink?: string | null; preco?: number | null; evento?: unknown; origem?: string } = {}): Promise<{ status: string; mudou: boolean }> {
  const anterior = corrida.status
  const patch: Parameters<typeof atualizarCorrida>[2] = {}
  if (extra.shareLink) patch.shareLink = extra.shareLink
  if (extra.preco !== undefined && extra.preco !== null) patch.preco = extra.preco
  if (extra.motorista?.nome) { patch.motoristaNome = extra.motorista.nome; patch.motoristaTelefone = extra.motorista.telefone ?? null; patch.motoristaPlaca = extra.motorista.placa ?? null; if (extra.motorista.id) patch.motoristaId = extra.motorista.id }
  const reabriria = !corridaAtiva(anterior) && corridaAtiva(novo)
  if (novo !== anterior && !reabriria) patch.status = novo
  await atualizarCorrida(admin, corrida.id, patch)
  await registrarEventoCorrida(admin, corrida.id, { tipo: extra.origem ?? 'evento', status: novo, anterior, evento: extra.evento ?? null })
  if (reabriria) return { status: anterior, mudou: false }
  const atual: EntregaProvedorLinha = { ...corrida, status: novo, shareLink: patch.shareLink ?? corrida.shareLink, motoristaNome: patch.motoristaNome ?? corrida.motoristaNome, preco: patch.preco ?? corrida.preco }
  if ((novo === 'ON_GOING' || novo === 'PICKED_UP') && (atual.motoristaNome || atual.shareLink)) {
    await avisarClienteRastreio(admin, atual, atual.shareLink ?? null, atual.motoristaNome ? { nome: atual.motoristaNome, placa: patch.motoristaPlaca ?? corrida.motoristaPlaca ?? '' } : null).catch((e) => console.error(`[${corrida.provedor}] aviso de rastreio:`, (e as Error).message))
  }
  if (novo === 'PICKED_UP') {
    if (await moverPedido(admin, corrida.pedidoId, ['pronto'], 'em_rota')) aplicarEfeitosStatusPedidoComTrava(admin, corrida.pedidoId, 'em_rota').catch((e) => console.error(`[${corrida.provedor}] efeitos em_rota:`, (e as Error).message))
  }
  if (novo === 'COMPLETED') {
    if (await moverPedido(admin, corrida.pedidoId, ['pronto', 'em_rota'], 'entregue')) await aplicarEfeitosStatusPedidoComTrava(admin, corrida.pedidoId, 'entregue').catch((e) => console.error(`[${corrida.provedor}] efeitos entregue:`, (e as Error).message))
    const { data: ped } = await admin.from('pedidos').select('numero').eq('id', corrida.pedidoId).maybeSingle()
    const { data: lj } = await admin.from('restaurantes').select('financeiro_ativo').eq('id', corrida.restauranteId).maybeSingle()
    await lancarCustoCorrida(admin, atual, atual.preco ?? 0, Number(ped?.numero ?? 0), lj?.financeiro_ativo === true).catch((e) => console.error(`[${corrida.provedor}] custo:`, (e as Error).message))
  }
  if (STATUS_FIM_SEM_ENTREGA.includes(novo) && novo !== anterior) await encerrarNoPedido(admin, atual, novo)
  return { status: novo, mudou: novo !== anterior }
}
