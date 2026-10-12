/**
 * Agente de IA — atender UMA mensagem com a IA (servidor). Chamado pelo motor do robô (lib/robo-auto/motor.ts) só
 * quando a rota é 'ia' e a loja tem o Agente (módulo + interruptor). Falhou → { ok: false, motivo } e o motor responde
 * com o robô padrão, como se a IA não existisse. Decisões D25–D34 em docs/robo-whatsapp/autoatendimento-decisoes.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarClaude } from '@/lib/custo/anthropic'
import { moduloLiberado } from '@/lib/modulos'
import { provedorAtual } from '@/lib/mensageria/provedor'
import { pixOnlineDaLoja, criarCobrancaPix } from '@/lib/pagamentos/pix-online'
import { notificarPedido } from '@/lib/whatsapp'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { brl, type DadosLojaAuto } from '@/lib/robo-auto/respostas'
import { carregarCardapioIa, resumoDoCardapio } from './cardapio'
import { blocosDoSistema, mensagensDoHistorico, MAX_HISTORICO, type MensagemHistorico } from './prompt'
import { conversarComIa } from './agente'
import { executarFerramenta, FERRAMENTAS, type EfeitosFerramentas } from './ferramentas'
import { confirmouPedido, criarPedidoDaConversa } from './pedido'
import { MAX_RESPOSTAS_IA, MODO_IA_SEM_MENSAGEM_MS, pedidoFinalizado } from './gatilho'
import { limparTom } from './tom'

export interface ConfigIa { ia_ativo?: boolean | null; ia_teto_usd_dia?: number | string | null }
export const COLUNAS_CONFIG_IA = 'ia_ativo, ia_teto_usd_dia'

/** Interruptor do Agente ligado E módulo pago liberado. (Chave e teto são conferidos na chamada: faltando, o motivo fica registrado.) */
export async function agenteLigadoNaLoja(admin: SupabaseClient, restauranteId: string, cfg: ConfigIa): Promise<boolean> {
  if (cfg.ia_ativo !== true) return false
  return moduloLiberado(admin, restauranteId, 'agente_ia').catch(() => false)
}

export interface EstadoConversaIa { iaDesde: string | null; iaRespostas: number; iaPedidoEm?: string | null; iaPedidoFinalizado?: boolean }
export interface LinhaHistorico extends MensagemHistorico { id: string; criadoEm: string }

/** Últimas mensagens da conversa (mais antiga primeiro), a atual incluída. */
export async function historicoDaConversa(admin: SupabaseClient, restauranteId: string, conversaId: string): Promise<LinhaHistorico[]> {
  const { data } = await admin
    .from('whatsapp_mensagens')
    .select('id, direcao, origem, tipo, texto, criado_em')
    .eq('restaurante_id', restauranteId)
    .eq('conversa_id', conversaId)
    .order('criado_em', { ascending: false })
    .limit(MAX_HISTORICO + 1)
  return ((data ?? []) as { id: string; direcao: 'entrada' | 'loja'; origem: string; tipo: string; texto: string | null; criado_em: string }[])
    .reverse()
    .map((m) => ({ id: m.id, direcao: m.direcao, origem: m.origem, tipo: m.tipo, texto: m.texto, criadoEm: m.criado_em }))
}

export async function estadoIaDaConversa(admin: SupabaseClient, conversaId: string): Promise<EstadoConversaIa> {
  const { data } = await admin.from('whatsapp_conversas').select('ia_desde, ia_respostas, ia_pedido_em, ia_pedido_id').eq('id', conversaId).maybeSingle()
  const d = (data ?? {}) as { ia_desde?: string | null; ia_respostas?: number | null; ia_pedido_em?: string | null; ia_pedido_id?: string | null }
  // Pedido da IA entregue/cancelado: os 30 min pós-pedido acabam antes (12/10).
  let iaPedidoFinalizado = false
  if (d.ia_pedido_id && d.ia_pedido_em) {
    const { data: p } = await admin.from('pedidos').select('status, cancelado_motivo').eq('id', d.ia_pedido_id).maybeSingle()
    iaPedidoFinalizado = !!p && pedidoFinalizado(p as { status: string; cancelado_motivo: string | null })
  }
  return { iaDesde: d.ia_desde ?? null, iaRespostas: Number(d.ia_respostas) || 0, iaPedidoEm: d.ia_pedido_em ?? null, iaPedidoFinalizado }
}

/** Mensagem do cliente anterior à atual (para os 30 min do modo IA). */
export function ultimaDoClienteAntes(hist: LinhaHistorico[], mensagemId: string): string | null {
  for (let i = hist.length - 1; i >= 0; i--) if (hist[i].direcao === 'entrada' && hist[i].id !== mensagemId) return hist[i].criadoEm
  return null
}

/** A conversa estourou as 25 respostas e o cliente continua falando (menos de 30 min): a IA não volta agora. */
export function iaEsgotadaNaConversa(e: EstadoConversaIa, ultimaAntes: string | null, agora: Date): boolean {
  return e.iaRespostas >= MAX_RESPOSTAS_IA && !!ultimaAntes && agora.getTime() - Date.parse(ultimaAntes) < MODO_IA_SEM_MENSAGEM_MS
}

/** Foto do cliente reduzida para no máximo 1024 px (JPEG) antes de ir para a IA. null = indisponível. */
async function imagemDoCliente(instancia: string | null, waId: string): Promise<{ mediaType: string; base64: string } | null> {
  if (!instancia) return null
  const bruta = await provedorAtual().baixarImagem(instancia, waId).catch(() => null)
  if (!bruta) return null
  try {
    const sharp = (await import('sharp')).default
    const saida = await sharp(Buffer.from(bruta.base64, 'base64')).rotate().resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
    return { mediaType: 'image/jpeg', base64: saida.toString('base64') }
  } catch {
    return null
  }
}

function formasDePagamento(l: DadosLojaAuto): string {
  return ['Pix', 'Dinheiro (com troco)', 'Cartão na entrega'].filter((f) => f !== 'Pix' || l.pixChave || l.pixOnline).join(', ')
}

const TIPOS_CHAVE: Record<string, string> = { cpf: 'CPF', cnpj: 'CNPJ', telefone: 'telefone', email: 'e-mail', aleatoria: 'chave aleatória' }

export interface EntradaAtender {
  restauranteId: string
  conversaId: string
  mensagemId: string
  telefone: string
  nomeWhatsapp: string | null
  tipo: string
  waId: string
  texto: string
  instancia: string | null
  cfg: ConfigIa
  loja: DadosLojaAuto
  semEntregador: boolean
  historico: LinhaHistorico[]
  agora?: Date
}

export type ResultadoAtender =
  | { ok: true; mensagens: string[]; efeitos: EfeitosFerramentas; custoMicroUsd: number; chamadas: number; ferramentas: string[] }
  | { ok: false; motivo: string; custoMicroUsd: number }

/**
 * "sim" claro DEPOIS do resumo, com carrinho guardado: o servidor cria o pedido sem chamar a IA (teste real 12/10: o
 * Haiku respondeu "Pedido confirmado" sem chamar criar_pedido — o cliente achou que pediu e nada foi criado). Puro.
 */
export function confirmacaoDireta(p: { texto: string; em: string; resumoEm: string | null; temCarrinho: boolean }): boolean {
  return p.temCarrinho && !!p.resumoEm && Date.parse(p.em) > Date.parse(p.resumoEm) && confirmouPedido(p.texto)
}

export async function atenderComIa(admin: SupabaseClient, e: EntradaAtender): Promise<ResultadoAtender> {
  const agora = e.agora ?? new Date()
  const [cardapio, pix, imagem] = await Promise.all([
    carregarCardapioIa(admin, e.restauranteId, agora),
    pixOnlineDaLoja(admin, e.restauranteId).catch(() => ({ ativo: false })),
    e.tipo === 'imagem' ? imagemDoCliente(e.instancia, e.waId) : Promise.resolve(null),
  ])
  const hora = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', hour: '2-digit', minute: '2-digit' })
  const system = blocosDoSistema(
    {
      nome: e.loja.nome, link: e.loja.link, endereco: e.loja.endereco, gradeHorario: e.loja.gradeHorario, aceitaEntrega: e.loja.aceitaEntrega,
      aceitaRetirada: e.loja.aceitaRetirada, tempoEntrega: e.loja.tempoEntrega, formasPagamento: formasDePagamento(e.loja), resumoCardapio: resumoDoCardapio(cardapio),
    },
    { agora: hora, aberta: e.loja.aberta, proximaAbertura: e.loja.proximaAbertura, nomeWhatsapp: e.nomeWhatsapp },
  )
  const mensagemAtual = e.historico.find((m) => m.id === e.mensagemId)
  const efeitos: EfeitosFerramentas = {}
  if (e.tipo === 'texto') {
    const { data: conv } = await admin.from('whatsapp_conversas').select('ia_carrinho, ia_resumo_em').eq('id', e.conversaId).eq('restaurante_id', e.restauranteId).maybeSingle()
    const c = conv as { ia_carrinho?: { carrinho?: unknown } | null; ia_resumo_em?: string | null } | null
    const em = mensagemAtual?.criadoEm ?? agora.toISOString()
    if (confirmacaoDireta({ texto: e.texto, em, resumoEm: c?.ia_resumo_em ?? null, temCarrinho: !!c?.ia_carrinho?.carrinho })) {
      const r = await criarPedidoDaConversa({ admin, restauranteId: e.restauranteId, telefone: e.telefone, conversaId: e.conversaId, nomeWhatsapp: e.nomeWhatsapp, pixOnlineAtivo: pix.ativo === true }, { texto: e.texto, em }, agora)
      if (r.ok) {
        efeitos.pedido = { id: r.id, numero: r.numero, total: r.total, pixOnline: r.pixOnline, repetido: r.repetido }
        return { ok: true, mensagens: await mensagensDoPedidoCriado(admin, e, efeitos.pedido), efeitos, custoMicroUsd: 0, chamadas: 0, ferramentas: ['criar_pedido (servidor)'] }
      }
      // Não deu (loja fechou, item acabou...): a IA explica ao cliente com o histórico.
    }
  }
  const ctx = {
    admin, restauranteId: e.restauranteId, telefone: e.telefone, conversaId: e.conversaId, nomeWhatsapp: e.nomeWhatsapp,
    pixOnlineAtivo: pix.ativo === true, cardapio, loja: e.loja, semEntregador: e.semEntregador,
    mensagemAtual: { texto: e.texto, em: mensagemAtual?.criadoEm ?? agora.toISOString() },
  }
  const teto = e.cfg.ia_teto_usd_dia === null || e.cfg.ia_teto_usd_dia === undefined ? null : Number(e.cfg.ia_teto_usd_dia)
  const r = await conversarComIa({
    system,
    mensagens: mensagensDoHistorico(e.historico, imagem),
    ferramentas: FERRAMENTAS,
    executar: (nome, input) => executarFerramenta(ctx, efeitos, nome, input),
    chamarModelo: (pedido, timeoutMs) => chamarClaude(admin, { loja: e.restauranteId, conversa: e.conversaId, tetoLojaUsd: teto }, pedido, { timeoutMs }),
  })
  if (!r.ok) return { ok: false, motivo: r.motivo, custoMicroUsd: r.custoMicroUsd }

  // Mensagens ao cliente: o que é dinheiro (resumo, confirmação, Pix) é texto do SERVIDOR, não da IA.
  const mensagens = efeitos.pedido ? await mensagensDoPedidoCriado(admin, e, efeitos.pedido) : mensagensDaResposta(efeitos, r.texto)
  if (!mensagens.length) return { ok: false, motivo: 'resposta_vazia', custoMicroUsd: r.custoMicroUsd }
  return { ok: true, mensagens, efeitos, custoMicroUsd: r.custoMicroUsd, chamadas: r.chamadas, ferramentas: r.ferramentas }
}

/**
 * O que vai ao cliente quando não houve pedido criado. Quando o SERVIDOR já respondeu (resumo, troca de pagamento,
 * atendente), o texto da IA não vai junto: era o "Seu pedido está montado… Posso confirmar?" repetindo o resumo (#287).
 * Senão, o texto da IA sem cabeçalho nem marcador de lista (tom, 12/10). Puro.
 */
export function mensagensDaResposta(efeitos: EfeitosFerramentas, textoIa: string): string[] {
  const doServidor = [...(efeitos.resumo ? [efeitos.resumo] : []), ...(efeitos.mensagens ?? [])]
  if (doServidor.length) return doServidor
  const texto = limparTom(textoIa)
  return texto ? [texto] : []
}

/** Confirmação do pedido criado + Pix (online: copia e cola; senão, a chave cadastrada no robô). Dispara os avisos. */
async function mensagensDoPedidoCriado(admin: SupabaseClient, e: EntradaAtender, p: NonNullable<EfeitosFerramentas['pedido']>): Promise<string[]> {
  // Uma mensagem só no fim (12/10, teste #306): o "Pedido recebido" automático (com o total) é a confirmação. A IA só
  // manda o que ele não tem: o Pix (código ou chave).
  const msgs: string[] = []
  if (p.pixOnline) {
    try {
      const pix = await criarCobrancaPix(admin, { restauranteId: e.restauranteId, pedidoId: p.id })
      if (pix.qrCode) {
        const ate = new Date(pix.expiraEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
        msgs.push(`*✅ Pedido \`#${p.numero}\` anotado!*\n\n*Total:* \`${brl(p.total)}\`\n\n> O pedido vai para a cozinha assim que o Pix for pago (vale até ${ate}). Copie o código abaixo 👇`)
        msgs.push(pix.qrCode)
      }
    } catch (err) {
      console.error('[agente-ia] Pix online não gerado:', (err as Error).message?.slice(0, 120))
      msgs.push('> Não consegui gerar o Pix agora. Um atendente da loja vai te ajudar com o pagamento.')
    }
    return msgs
  }
  const { data: pedido } = await admin.from('pedidos').select('forma_pagamento, tipo').eq('id', p.id).maybeSingle()
  const ped = (pedido ?? {}) as { forma_pagamento?: string; tipo?: string }
  if (ped.forma_pagamento === 'pix' && e.loja.pixChave) {
    msgs.push(`Para pagar, a chave Pix (${TIPOS_CHAVE[e.loja.pixTipo ?? ''] ?? 'Pix'}) vai na próxima mensagem 👇`)
    msgs.push(e.loja.pixChave)
  }
  if (!p.repetido) {
    avisarPainelPedidoNovo(admin, e.restauranteId, { id: p.id, numero: p.numero, canal: ped.tipo ?? null }).catch(() => null)
    const aviso = await notificarPedido(admin, p.id, 'recebido').catch((err) => { console.error('[agente-ia] aviso de pedido recebido', (err as Error).message); return 'falhou' as const })
    // O automático não saiu (loja desligou o aviso, falhou…): a IA confirma, para o cliente nunca ficar sem resposta.
    if (aviso !== 'enviada') msgs.unshift(textoPedidoAnotado(p.numero, p.total))
  }
  return msgs
}

/** Grava o resultado no estado da conversa (modo IA, contador, pedido criado, atendente). */
export async function registrarRespostaIa(
  admin: SupabaseClient,
  p: { restauranteId: string; conversaId: string; estado: EstadoConversaIa; efeitos: EfeitosFerramentas; custoMicroUsd: number; ferramentas: string[]; agora?: Date },
): Promise<{ saiuPorLimite: boolean }> {
  const agora = (p.agora ?? new Date()).toISOString()
  const respostas = p.estado.iaRespostas + 1
  const saiuPorLimite = respostas >= MAX_RESPOSTAS_IA && !p.efeitos.pedido
  const patch: Record<string, unknown> = { ia_respostas: p.efeitos.pedido ? 0 : respostas, ia_desde: p.estado.iaDesde ?? agora }
  // O carrinho fica guardado (Pix expirado → a IA remonta o mesmo pedido com outra forma); sem resumo, criar_pedido não repete.
  if (p.efeitos.pedido) Object.assign(patch, { ia_desde: null, ia_resumo_em: null, ia_pedido_id: p.efeitos.pedido.id, ia_pedido_em: agora })
  if (saiuPorLimite) Object.assign(patch, { ia_desde: null, ia_carrinho: null, ia_resumo_em: null })
  if (p.efeitos.atendente) {
    // Motivo na central ("Cancelamento do pedido #X") e aviso ao cliente se ninguém responder em 10 min (0184).
    Object.assign(patch, {
      estado: 'silenciada', silenciada_em: agora, silenciada_motivo: 'cliente', atendimento: 'aguardando', pediu_atendente_em: agora,
      pediu_atendente_motivo: p.efeitos.atendente.slice(0, 200), pediu_atendente_aviso_em: null,
    })
  }
  await admin.from('whatsapp_conversas').update(patch).eq('id', p.conversaId).eq('restaurante_id', p.restauranteId)
  const eventos: { restaurante_id: string; conversa_id: string; tipo: string; resultado: Record<string, unknown> }[] = []
  if (p.efeitos.pedido && !p.efeitos.pedido.repetido) {
    eventos.push({ restaurante_id: p.restauranteId, conversa_id: p.conversaId, tipo: 'ia_pedido', resultado: { pedido: p.efeitos.pedido.id, numero: p.efeitos.pedido.numero, custo_micro_usd: p.custoMicroUsd } })
  }
  if (p.efeitos.atendente) eventos.push({ restaurante_id: p.restauranteId, conversa_id: p.conversaId, tipo: 'atendente', resultado: { modo: 'agente_ia', motivo: p.efeitos.atendente } })
  if (eventos.length) await admin.from('whatsapp_eventos').insert(eventos).then(() => {}, () => {})
  return { saiuPorLimite }
}

/** Falha da IA: fica registrada com o motivo (a resposta ao cliente sai pelo robô padrão). */
export async function registrarFalhaIa(admin: SupabaseClient, p: { restauranteId: string; conversaId: string; motivo: string; custoMicroUsd: number }) {
  console.error(`[agente-ia] falhou (${p.motivo}); o robô padrão respondeu`)
  await admin.from('whatsapp_eventos').insert({ restaurante_id: p.restauranteId, conversa_id: p.conversaId, tipo: 'ia_falha', resultado: { motivo: p.motivo, custo_micro_usd: p.custoMicroUsd } }).then(() => {}, () => {})
}

/** Fim por limite de respostas: manda o link e devolve ao robô. */
export function textoLimiteIa(loja: DadosLojaAuto): string {
  return `*🍽️ Para continuar*, faça seu pedido pelo cardápio: ${loja.link}\n\n> Se precisar, digite *0* para falar com um atendente.`
}

export const TEXTO_AUDIO_IA = 'Ainda não consigo ouvir áudio, pode me escrever? 🙏'

/** Confirmação da IA quando o aviso automático "Pedido recebido" não sai (padrão de 12/10). */
export function textoPedidoAnotado(numero: number, total: number): string {
  return `*✅ Pedido \`#${numero}\` anotado!*\n\n*Total:* \`${brl(total)}\`\n\n> Você recebe por aqui as atualizações do pedido. Obrigado! 😊`
}
