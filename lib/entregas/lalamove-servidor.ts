import type { SupabaseClient } from '@supabase/supabase-js'
import {
  cancelarCorridaLalamove, cidadesLalamove, consultarCorridaLalamove, cotarLalamove, criarCorridaLalamove, LalamoveError, motoristaLalamove,
  registrarWebhookLalamove, type ContaLalamove,
} from '@/lib/custo/lalamove'
import { lancar } from '@/lib/financeiro/ledger'
import { turnoAberto } from '@/lib/financeiro/caixa'
import { coordenadasDosPedidos } from '@/lib/mapa/coordenadas-pedidos'
import { aplicarEfeitosStatusPedidoComTrava } from '@/lib/pedido-eventos'
import { buscarPedidoParaNotificacao, PEDIDO_SELECT, mapPedido, type Pedido, type StatusPedido } from '@/lib/queries/pedidos'
import { enviarWhatsapp, formatarTelefoneWhatsapp } from '@/lib/whatsapp'
import { registrarAuditoria } from '@/lib/auditoria'
import { corridaAtiva, MSG_FORA_DA_AREA, servicoDeMoto, STATUS_FIM_SEM_ENTREGA, type CidadeLalamove, type PedidoLalamove, type RespostaCotacao } from './lalamove-regras'
import { coberturaLalamove, cidadeDaLoja } from './lalamove-cidades'
import { textoStatusLalamove, type EntregaProvedorLinha } from './lalamove-status'
import {
  apagarCorrida, atualizarCorrida, buscarConfig, buscarCorridaPorExterno, corridaAtivaDoPedido, criarCorrida, marcosDaCorrida, registrarEventoCorrida,
  salvarConfig, type ConfigProvedor,
} from './queries'

/**
 * Cola entre o Menuzia e a Lalamove (SERVER-ONLY): resolve a conta da loja, cota, chama, cancela e aplica os eventos do
 * webhook ao pedido. O status do pedido só muda DEPOIS de consultar a corrida na API (ordem do dono, 18/10):
 *   PICKED_UP  → pedido pronto → em_rota (+ WhatsApp "saiu para entrega", como no despacho)
 *   COMPLETED  → pedido em_rota|pronto → entregue, pelos MESMOS efeitos do Kanban/menu Pedidos (WhatsApp, Fidelidade,
 *                Financeiro recebe pelo fluxo normal) + custo da corrida lançado como despesa da empresa
 *   CANCELED / REJECTED / EXPIRED → corrida encerra; pedido em_rota volta a pronto (aviso amarelo no card)
 */
export class EntregaError extends Error { readonly status: number; constructor(m: string, status = 400) { super(m); this.name = 'EntregaError'; this.status = status } }

const URL_PUBLICA = () => (process.env.MENUZIA_URL_PUBLICA ?? process.env.APP_URL ?? 'https://app.menuzia.com.br').replace(/\/$/, '')
export const urlWebhook = (token: string) => `${URL_PUBLICA()}/api/entregas/lalamove/webhook/${token}`

export function contaDe(cfg: ConfigProvedor): ContaLalamove {
  if (!cfg.chaves) throw new EntregaError('Cole a API key e o secret da Lalamove em Integrações › Lalamove.', 400)
  return { chaves: cfg.chaves, ambiente: cfg.ambiente }
}

export async function configPronta(admin: SupabaseClient, restauranteId: string): Promise<ConfigProvedor> {
  const cfg = await buscarConfig(admin, restauranteId)
  if (!cfg || !cfg.chaves) throw new EntregaError('Lalamove ainda não conectada. Cole as chaves em Integrações › Lalamove.', 400)
  if (!cfg.ativo) throw new EntregaError('A Lalamove está desligada nesta loja (Integrações › Lalamove).', 400)
  return cfg
}

interface Loja { id: string; nome: string; telefone: string; endereco: string; cidade: string; lat: number | null; lng: number | null; financeiroAtivo: boolean }

async function lojaDe(admin: SupabaseClient, restauranteId: string): Promise<Loja> {
  const { data, error } = await admin.from('restaurantes').select('id, nome, telefone, endereco, endereco_cidade, latitude, longitude, financeiro_ativo').eq('id', restauranteId).maybeSingle()
  if (error) throw error
  if (!data) throw new EntregaError('Loja não encontrada.', 404)
  const r = data as Record<string, unknown>
  return {
    id: String(r.id), nome: String(r.nome ?? ''), telefone: String(r.telefone ?? ''), endereco: String(r.endereco ?? ''),
    cidade: cidadeDaLoja({ enderecoCidade: r.endereco_cidade as string | null, endereco: r.endereco as string | null }),
    lat: r.latitude === null || r.latitude === undefined ? null : Number(r.latitude), lng: r.longitude === null || r.longitude === undefined ? null : Number(r.longitude),
    financeiroAtivo: r.financeiro_ativo === true,
  }
}

/** Pedido do tenant (erro se não for de entrega). */
export async function pedidoDaLoja(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<Pedido> {
  const { data, error } = await admin.from('pedidos').select(PEDIDO_SELECT).eq('id', pedidoId).eq('restaurante_id', restauranteId).maybeSingle()
  if (error) throw error
  if (!data) throw new EntregaError('Pedido não encontrado nesta loja.', 404)
  const p = mapPedido(data as unknown as Parameters<typeof mapPedido>[0])
  if (p.tipo !== 'entrega') throw new EntregaError('Só pedido de entrega vai para a Lalamove.', 400)
  return p
}

/**
 * "Testar conexão": GET /v3/cities com as chaves da loja. Guarda a cidade (pelo nome do cadastro) e o serviço de moto,
 * registra o webhook e devolve a lista para a tela. Não cria corrida.
 */
export async function testarConexao(admin: SupabaseClient, cfg: ConfigProvedor, porNome: string): Promise<{ cidades: CidadeLalamove[]; cidadeLoja: string; cidadeEscolhida: CidadeLalamove | null; webhookOk: boolean; aviso: string | null }> {
  const conta = contaDe(cfg)
  const loja = await lojaDe(admin, cfg.restauranteId)
  const cidades = await cidadesLalamove(admin, cfg.restauranteId, conta)
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  const cob = coberturaLalamove(loja.cidade)
  const alvo = cob.atende === true ? (cob.vizinha ?? cob.cidade) : loja.cidade
  const escolhida = cidades.find((c) => norm(c.nome) === norm(alvo)) ?? cidades.find((c) => norm(c.nome) === norm(cfg.cidadeNome)) ?? null
  let webhookOk = false
  try { await registrarWebhookLalamove(admin, cfg.restauranteId, conta, urlWebhook(cfg.webhookToken)); webhookOk = true } catch (e) { console.error('[lalamove] webhook não registrado:', (e as Error).message) }
  await salvarConfig(admin, cfg.restauranteId, {
    cidadeLocode: escolhida?.locode ?? cfg.cidadeLocode, cidadeNome: escolhida?.nome ?? cfg.cidadeNome,
    servico: escolhida ? servicoDeMoto(escolhida.servicos) : cfg.servico, webhookRegistradoEm: webhookOk ? new Date().toISOString() : cfg.webhookRegistradoEm, porNome,
  })
  const aviso = !loja.cidade ? 'Cadastre a cidade da loja em Ajustes para conferir a cobertura.' : escolhida ? null : `${MSG_FORA_DA_AREA} (${loja.cidade}). As chaves funcionam; a cotação vai recusar.`
  return { cidades, cidadeLoja: loja.cidade, cidadeEscolhida: escolhida, webhookOk, aviso }
}

export interface CotacaoPronta extends RespostaCotacao { pedidoNumero: number; pagamentoNaEntrega: boolean; trocoPara: number | null; ambiente: string }

/** Cotação para um pedido: loja (lat/lng do cadastro) → cliente (coordenadas gravadas no pedido; geocodifica 1x se faltar). */
export async function cotarPedido(admin: SupabaseClient, restauranteId: string, pedidoId: string): Promise<CotacaoPronta> {
  const cfg = await configPronta(admin, restauranteId)
  const [loja, pedido] = await Promise.all([lojaDe(admin, restauranteId), pedidoDaLoja(admin, restauranteId, pedidoId)])
  if (pedido.status !== 'pronto') throw new EntregaError(`O pedido #${pedido.numero} não está pronto para despacho.`, 409)
  if (await corridaAtivaDoPedido(admin, pedidoId)) throw new EntregaError('Este pedido já tem uma corrida da Lalamove em andamento.', 409)
  if (loja.lat === null || loja.lng === null) throw new EntregaError('A loja está sem localização no mapa. Confira o endereço em Ajustes › Loja.', 400)
  const coords = await coordenadasDosPedidos(admin, restauranteId, [pedidoId])
  const c = coords[pedidoId]
  if (!c) throw new EntregaError('Não foi possível localizar o endereço do cliente no mapa. Confira o endereço do pedido.', 400)
  const enderecoCliente = [pedido.enderecoRua, pedido.enderecoNumero, pedido.enderecoBairro, pedido.enderecoCidade || loja.cidade].filter(Boolean).join(', ')
  const cot = await cotarLalamove(admin, restauranteId, contaDe(cfg), cfg.servico, { lat: loja.lat, lng: loja.lng, endereco: loja.endereco || loja.nome }, { lat: c.lat, lng: c.lng, endereco: enderecoCliente }, pedidoId)
  return { ...cot, pedidoNumero: pedido.numero, pagamentoNaEntrega: !pedido.pago, trocoPara: pedido.formaPagamento === 'dinheiro' ? pedido.trocoPara : null, ambiente: cfg.ambiente }
}

/** Confirma a cotação e cria a corrida. O pedido continua `pronto` até o entregador coletar. */
export async function chamarLalamove(admin: SupabaseClient, restauranteId: string, pedidoId: string, cotacao: RespostaCotacao, por: { id: string | null; nome: string }): Promise<EntregaProvedorLinha> {
  const cfg = await configPronta(admin, restauranteId)
  const [loja, pedido] = await Promise.all([lojaDe(admin, restauranteId), pedidoDaLoja(admin, restauranteId, pedidoId)])
  if (pedido.status !== 'pronto') throw new EntregaError(`O pedido #${pedido.numero} não está mais pronto para despacho.`, 409)
  if (cotacao.paradas.length < 2) throw new EntregaError('Cotação incompleta. Cote de novo.', 400)
  const linha = await criarCorrida(admin, { restauranteId, pedidoId, ambiente: cfg.ambiente, cotacaoId: cotacao.quotationId, preco: cotacao.preco, distanciaM: cotacao.distanciaM, porNome: por.nome })
  let corrida: PedidoLalamove
  try {
    corrida = await criarCorridaLalamove(admin, restauranteId, contaDe(cfg), cotacao, { nome: loja.nome, telefone: loja.telefone }, {
      numero: pedido.numero, clienteNome: pedido.clienteNome, clienteTelefone: pedido.clienteTelefone, observacao: pedido.observacao, complemento: pedido.enderecoComplemento, referencia: pedido.enderecoReferencia,
    }, pedidoId)
  } catch (e) {
    // A corrida não nasceu: a linha reservada não pode segurar o índice e travar a próxima tentativa.
    await apagarCorrida(admin, linha.id).catch(() => {})
    throw e
  }
  await atualizarCorrida(admin, linha.id, { externoId: corrida.orderId, status: corrida.status || 'ASSIGNING_DRIVER', shareLink: corrida.shareLink, preco: corrida.preco ?? cotacao.preco })
  await registrarEventoCorrida(admin, linha.id, { tipo: 'criada', status: corrida.status, por: por.nome })
  await registrarAuditoria(admin, { restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: 'entregas.lalamove_chamada', entidade: 'pedido', entidadeId: pedidoId, dados: { numero: pedido.numero, preco: cotacao.preco, ambiente: cfg.ambiente, corrida: corrida.orderId } }).catch(() => {})
  return { ...linha, externoId: corrida.orderId, status: corrida.status || 'ASSIGNING_DRIVER', shareLink: corrida.shareLink }
}

/** Cancela pelo Menuzia. A Lalamove só deixa em ASSIGNING_DRIVER ou até 5 min após o aceite (senão 409 → mensagem). */
export async function cancelarPeloMenuzia(admin: SupabaseClient, restauranteId: string, corrida: EntregaProvedorLinha, por: { id: string | null; nome: string }): Promise<void> {
  if (corrida.restauranteId !== restauranteId) throw new EntregaError('Corrida não encontrada nesta loja.', 404)
  if (!corridaAtiva(corrida.status)) throw new EntregaError('Esta corrida já terminou.', 409)
  if (!corrida.externoId) throw new EntregaError('Corrida sem número na Lalamove.', 409)
  const cfg = await configPronta(admin, restauranteId)
  await cancelarCorridaLalamove(admin, restauranteId, contaDe(cfg), corrida.externoId)
  await atualizarCorrida(admin, corrida.id, { status: 'CANCELED', canceladoPorNome: por.nome })
  await registrarEventoCorrida(admin, corrida.id, { tipo: 'cancelada_pelo_menuzia', por: por.nome })
  await encerrarNoPedido(admin, corrida, 'CANCELED')
  await registrarAuditoria(admin, { restauranteId, usuarioId: por.id, usuarioNome: por.nome, acao: 'entregas.lalamove_cancelada', entidade: 'pedido', entidadeId: corrida.pedidoId, dados: { corrida: corrida.externoId } }).catch(() => {})
}

/** Transição do pedido por UPDATE condicional (atômico): 0 linhas = já estava noutro estado, não mexe nem avisa. */
async function moverPedido(admin: SupabaseClient, pedidoId: string, de: StatusPedido[], para: StatusPedido): Promise<boolean> {
  const { data, error } = await admin.from('pedidos').update({ status: para }).eq('id', pedidoId).in('status', de).select('id')
  if (error) throw error
  return !!data?.length
}

/** Corrida acabou sem entregar: pedido em rota volta para a fila (a comida existe e ainda precisa sair). */
async function encerrarNoPedido(admin: SupabaseClient, corrida: EntregaProvedorLinha, status: string): Promise<void> {
  if (!STATUS_FIM_SEM_ENTREGA.includes(status)) return
  const voltou = await moverPedido(admin, corrida.pedidoId, ['em_rota'], 'pronto')
  if (voltou) console.warn(`[lalamove] corrida ${corrida.externoId} ${status}: pedido ${corrida.pedidoId} voltou para pronto.`)
}

/** Custo da corrida no Financeiro (despesa da empresa, separada da taxa cobrada do cliente). Uma vez por corrida. */
async function lancarCustoCorrida(admin: SupabaseClient, corrida: EntregaProvedorLinha, preco: number, numero: number, financeiroAtivo: boolean): Promise<void> {
  if (!financeiroAtivo || !(preco > 0)) return
  const marcos = await marcosDaCorrida(admin, corrida.id)
  if (marcos.custoLancadoEm) return
  const centavos = Math.round(preco * 100)
  const turno = await turnoAberto(admin, corrida.restauranteId).catch(() => null)
  const r = await lancar(admin, {
    restauranteId: corrida.restauranteId, turnoId: turno?.id ?? null, chave: `lalamove:${corrida.id}`, origem: 'delivery', usuario: { id: null, nome: 'Lalamove' },
    motivo: `Corrida Lalamove do pedido #${numero}`,
    linhas: [
      // forma 'outro': sai da carteira Lalamove da loja (pré-pago no portal deles), não da gaveta.
      { carteira: 'empresa', tipo: 'despesa', valorCentavos: -centavos, forma: 'outro', pedidoId: corrida.pedidoId, dados: { provedor: 'lalamove', corrida: corrida.externoId, entrega_id: corrida.id } },
      { carteira: 'resultado', tipo: 'despesa', valorCentavos: -centavos, forma: 'outro', pedidoId: corrida.pedidoId, dados: { provedor: 'lalamove', corrida: corrida.externoId, entrega_id: corrida.id } },
    ],
  })
  if (r.ok) await atualizarCorrida(admin, corrida.id, { custoLancadoEm: new Date().toISOString() })
  else console.error('[lalamove] custo não lançado:', r.erro)
}

/** WhatsApp ao cliente com o link de rastreio quando o entregador é designado. Uma vez por corrida. */
async function avisarClienteRastreio(admin: SupabaseClient, corrida: EntregaProvedorLinha, shareLink: string | null, motorista: { nome: string; placa: string } | null): Promise<void> {
  const marcos = await marcosDaCorrida(admin, corrida.id)
  if (marcos.clienteAvisadoEm) return
  const dados = await buscarPedidoParaNotificacao(admin, corrida.pedidoId)
  if (!dados?.evolutionInstance) return
  const numero = formatarTelefoneWhatsapp(dados.pedido.clienteTelefone)
  if (!numero) return
  const nome = (dados.pedido.clienteNome ?? '').trim().split(/\s+/)[0]
  const linhas = [
    `*🛵 Entregador a caminho!*`,
    '',
    `${nome ? `${nome}, ` : ''}o pedido *#${dados.pedido.numero}* da *${dados.restauranteNome}* já tem entregador${motorista?.nome ? `: *${motorista.nome}*` : ''}${motorista?.placa ? ` (placa ${motorista.placa})` : ''}.`,
    ...(shareLink ? ['', `Acompanhe a entrega em tempo real:`, shareLink] : []),
  ]
  const ok = await enviarWhatsapp(numero, linhas.join('\n'), dados.evolutionInstance, { admin, origem: 'automatico', restauranteId: corrida.restauranteId })
  if (ok) await atualizarCorrida(admin, corrida.id, { clienteAvisadoEm: new Date().toISOString() })
}

/**
 * Sincroniza UMA corrida com a Lalamove (GET /v3/orders/{id}) e aplica ao pedido. Chamado pelo webhook (depois de
 * conferir o token da URL) e pelo botão "Atualizar" do painel. Idempotente: repetir não re-executa transição nem aviso.
 */
export async function sincronizarCorrida(admin: SupabaseClient, cfg: ConfigProvedor, corrida: EntregaProvedorLinha, origem: 'webhook' | 'painel', evento?: unknown): Promise<{ status: string; mudou: boolean }> {
  if (!corrida.externoId) return { status: corrida.status, mudou: false }
  const conta = contaDe(cfg)
  const remota = await consultarCorridaLalamove(admin, cfg.restauranteId, conta, corrida.externoId)
  const anterior = corrida.status
  const novo = remota.status
  const patch: Parameters<typeof atualizarCorrida>[2] = { shareLink: remota.shareLink ?? corrida.shareLink, preco: remota.preco ?? corrida.preco }
  const marcos = await marcosDaCorrida(admin, corrida.id)
  let motorista: { nome: string; placa: string } | null = null
  if (remota.driverId && (remota.driverId !== marcos.motoristaId || !corrida.motoristaNome) && corridaAtiva(novo)) {
    const m = await motoristaLalamove(admin, cfg.restauranteId, conta, corrida.externoId, remota.driverId).catch(() => null)
    patch.motoristaId = remota.driverId
    if (m) { patch.motoristaNome = m.nome; patch.motoristaTelefone = m.telefone; patch.motoristaPlaca = m.placa; motorista = { nome: m.nome, placa: m.placa } }
  }
  // Corrida já encerrada não volta a ficar ativa por evento atrasado/reenviado.
  const reabriria = !corridaAtiva(anterior) && corridaAtiva(novo)
  if (novo !== anterior && !reabriria) patch.status = novo
  await atualizarCorrida(admin, corrida.id, patch)
  await registrarEventoCorrida(admin, corrida.id, { tipo: origem, status: novo, anterior, evento: evento ?? null })
  if (reabriria) { console.warn(`[lalamove] ${novo} depois de ${anterior} na corrida ${corrida.externoId} — ignorado.`); return { status: anterior, mudou: false } }

  const loja = await lojaDe(admin, cfg.restauranteId)
  const pedido = await pedidoDaLoja(admin, cfg.restauranteId, corrida.pedidoId).catch(() => null)
  const atual: EntregaProvedorLinha = { ...corrida, status: novo, shareLink: patch.shareLink ?? null, motoristaNome: patch.motoristaNome ?? corrida.motoristaNome }

  // Entregador designado: link de rastreio para o cliente (uma vez).
  if ((novo === 'ON_GOING' || novo === 'PICKED_UP') && remota.driverId) {
    await avisarClienteRastreio(admin, atual, atual.shareLink, motorista ?? (corrida.motoristaNome ? { nome: corrida.motoristaNome, placa: corrida.motoristaPlaca ?? '' } : null)).catch((e) => console.error('[lalamove] aviso de rastreio:', (e as Error).message))
  }
  if (novo === 'PICKED_UP' && pedido) {
    if (await moverPedido(admin, corrida.pedidoId, ['pronto'], 'em_rota')) {
      aplicarEfeitosStatusPedidoComTrava(admin, corrida.pedidoId, 'em_rota').catch((e) => console.error('[lalamove] efeitos em_rota:', (e as Error).message))
    }
  }
  if (novo === 'COMPLETED' && pedido) {
    // A MESMA conclusão do Kanban/menu Pedidos: status entregue + WhatsApp + Fidelidade (lib/pedido-eventos).
    if (await moverPedido(admin, corrida.pedidoId, ['pronto', 'em_rota'], 'entregue')) {
      await aplicarEfeitosStatusPedidoComTrava(admin, corrida.pedidoId, 'entregue').catch((e) => console.error('[lalamove] efeitos entregue:', (e as Error).message))
    }
    await lancarCustoCorrida(admin, atual, remota.preco ?? corrida.preco ?? 0, pedido.numero, loja.financeiroAtivo).catch((e) => console.error('[lalamove] custo:', (e as Error).message))
  }
  if (STATUS_FIM_SEM_ENTREGA.includes(novo) && novo !== anterior) await encerrarNoPedido(admin, atual, novo)
  return { status: novo, mudou: novo !== anterior }
}

/** Webhook: localiza a corrida pelo orderId do evento e sincroniza. Corrida desconhecida → ignora (200). */
export async function processarWebhook(admin: SupabaseClient, cfg: ConfigProvedor, orderId: string, evento: unknown): Promise<void> {
  const corrida = await buscarCorridaPorExterno(admin, orderId)
  if (!corrida || corrida.restauranteId !== cfg.restauranteId) { console.warn(`[lalamove] webhook para corrida desconhecida ${orderId}`); return }
  await sincronizarCorrida(admin, cfg, corrida, 'webhook', evento)
}

/** Erro → { mensagem, status } para as rotas. */
export function erroEntrega(err: unknown): { mensagem: string; status: number } {
  if (err instanceof EntregaError) return { mensagem: err.message, status: err.status }
  if (err instanceof LalamoveError) return { mensagem: err.message, status: err.status >= 400 && err.status < 600 ? err.status : 400 }
  if (err instanceof Error && /já tem uma corrida/.test(err.message)) return { mensagem: err.message, status: 409 }
  // Uber/Foody/Machine/iFood (21/10): os erros deles já vêm com a mensagem para o dono.
  if (err instanceof Error && /^(UberError|FoodyError|IfoodEntregaError)$/.test(err.name)) {
    const st = Number((err as { status?: number }).status)
    return { mensagem: err.message, status: st >= 400 && st < 600 ? st : 502 }
  }
  console.error('[entregas] erro inesperado:', err)
  return { mensagem: 'Erro inesperado ao falar com o entregador.', status: 500 }
}

export { textoStatusLalamove }
