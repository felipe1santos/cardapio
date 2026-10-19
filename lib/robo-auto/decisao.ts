/**
 * Robô de autoatendimento — máquina de estados pura (sem banco): dada a mensagem classificada e o estado da
 * conversa, decide a ação e o estado novo. O webhook e o simulador usam a mesma função.
 * Decisões em docs/robo-whatsapp/autoatendimento-decisoes.md (D6, D7, D11, D12, D13).
 */
import { bairroDaFrase, bairroPlausivel, type Assunto, type Classificacao, type Intencao } from './classificador'
import type { TipoMensagem } from '@/lib/mensageria/provedor'

export type AcaoAuto =
  | 'saudacao' | 'menu_curto' | 'cardapio' | 'entrega' | 'entrega_perguntar_bairro' | 'status' | 'status_numero'
  | 'horario' | 'pagamento' | 'endereco' | 'reclamacao' | 'atendente' | 'parar' | 'nao_entendeu' | 'audio' | 'nada'
  | 'pix_chave' | 'resumo_pedido' | 'tempo_entrega' | 'duvida'
  | 'pedir_link' | 'pedir_sem_link'
  // 19/10 (dono): loja fechada — quem quer pedir ouve que está fechada e quando abre; nada é anotado.
  | 'pedir_fechada'
  // 18/10: "Alterar ou cancelar meu pedido" (só com pedido aberto): pergunta o que mudar; a mensagem seguinte vira solicitação.
  | 'alterar_pedido_perguntar' | 'alterar_pedido_registrar'

export interface EstadoAuto {
  /** 12/10: escolhendo categoria / item da categoria N (cardápio pelo robô, sem IA). */
  autoEstado: 'aguardando_bairro' | 'aguardando_numero' | 'pedir_link' | 'escolher_categoria' | `escolher_item:${number}` | `alterar_pedido:${string}` | null
  autoEstadoEm: string | null
  naoEntendeu: number
  saudacaoEm: string | null
  /** Último aviso de "não consigo ouvir áudio" (11/10): no máximo 1 a cada 6 h. */
  audioEm?: string | null
}

export const ESTADO_VAZIO: EstadoAuto = { autoEstado: null, autoEstadoEm: null, naoEntendeu: 0, saudacaoEm: null, audioEm: null }

export const SAUDACAO_JANELA_MS = 6 * 3600_000
export const ESTADO_VALIDADE_MS = 15 * 60_000
/** O dono não desliga estes (segurança do cliente). */
const SEMPRE_LIGADOS: Assunto[] = ['atendente', 'parar', 'reclamacao']

export interface Decisao {
  acao: AcaoAuto
  intencao: Intencao
  estado: EstadoAuto
  bairro?: string | null
  numeroPedido?: number
  /** Silenciar a conversa: atendente (1 h ou até reativar) ou parar (até "voltar"). */
  silenciar?: 'atendente' | 'parar'
  /** Vai para "Perguntas que o robô não entendeu". */
  naoEntendida: boolean
  /** Transferido por não entender 2 vezes seguidas. */
  porNaoEntender?: boolean
  /** Pediu a chave Pix e a loja não cadastrou: vai para o atendente (16/10). */
  porSemPix?: boolean
  /** Quer pedir pela conversa e a IA não atendeu: o atendente anota (16/10; nunca o link de novo). */
  porPedido?: boolean
  /** 18/10: pedido alvo de "alterar ou cancelar meu pedido". */
  pedidoId?: string
}

/** "cancelar", "mudar/alterar/trocar o pedido", "tirar", "acrescentar", "esqueci de pedir" (as mesmas palavras que iam para o atendente). */
export function ehAlteracaoDePedido(normalizado: string): boolean {
  return /\b(cancel|mudar|alterar|trocar|tirar|acrescentar|adicionar|esqueci)/.test(normalizado)
}

export interface EntradaDecisao {
  classificacao: Classificacao
  texto: string
  estado: EstadoAuto
  agora: Date
  assuntosDesligados?: Set<Assunto>
  /** Tipo da mensagem (padrão: texto). */
  tipo?: TipoMensagem
  /** A loja cadastrou a chave Pix do robô (padrão: sim). */
  temPix?: boolean
  /** 18/10: id do pedido aberto e ainda editável deste telefone (o motor consulta). Sem ele, "alterar/cancelar" vai para o atendente como antes. */
  pedidoEditavelId?: string | null
  /** 19/10: loja aberta agora (padrão: sim). Fechada, "quero pedir" vira `pedir_fechada`. */
  lojaAberta?: boolean
}

const ACAO_DO_ASSUNTO: Record<Assunto, AcaoAuto> = {
  saudacao: 'saudacao', cardapio: 'cardapio', entrega: 'entrega', status_pedido: 'status', horario: 'horario', pagamento_pix: 'pagamento',
  endereco_retirada: 'endereco', reclamacao: 'reclamacao', atendente: 'atendente', parar: 'parar',
}

function valido(estado: EstadoAuto, agora: Date): boolean {
  return !!estado.autoEstado && !!estado.autoEstadoEm && agora.getTime() - Date.parse(estado.autoEstadoEm) < ESTADO_VALIDADE_MS
}

export function decidir(e: EntradaDecisao): Decisao {
  const { classificacao, texto, agora } = e
  const desligados = e.assuntosDesligados ?? new Set<Assunto>()
  let intencao = classificacao.intencao
  if (intencao !== 'ok' && intencao !== 'voltar' && intencao !== 'outro' && intencao !== 'pedir' && intencao !== 'pix_chave' && intencao !== 'resumo_pedido' && intencao !== 'tempo_entrega' && intencao !== 'duvida'
    && desligados.has(intencao) && !SEMPRE_LIGADOS.includes(intencao)) intencao = 'outro'
  // Pedir a chave é parte do assunto Pix: desligado pelo dono, desliga junto.
  if (intencao === 'pix_chave' && desligados.has('pagamento_pix')) intencao = 'outro'

  const agoraIso = agora.toISOString()

  // Mídia (diagnóstico 11/10): um álbum de fotos virava "não entendi" 2× → atendente e pausava o robô. Foto, vídeo,
  // documento, figurinha, contato e tipo desconhecido (inclusive outro robô mandando mensagem vazia) não respondem e
  // não contam como "não entendi". Áudio: aviso no máximo 1× a cada 6 h. Localização: pergunta o bairro.
  if (e.tipo && e.tipo !== 'texto') {
    if (e.tipo === 'audio') {
      const recente = e.estado.audioEm && agora.getTime() - Date.parse(e.estado.audioEm) < SAUDACAO_JANELA_MS
      return recente
        ? { acao: 'nada', intencao: 'outro', estado: e.estado, naoEntendida: false }
        : { acao: 'audio', intencao: 'outro', estado: { ...e.estado, audioEm: agoraIso }, naoEntendida: false }
    }
    if (e.tipo === 'localizacao') {
      return { acao: 'entrega_perguntar_bairro', intencao: 'entrega', estado: { ...e.estado, naoEntendeu: 0, autoEstado: 'aguardando_bairro', autoEstadoEm: agoraIso }, naoEntendida: false }
    }
    return { acao: 'nada', intencao: 'outro', estado: e.estado, naoEntendida: false }
  }
  const limpo: EstadoAuto = { ...e.estado, autoEstado: null, autoEstadoEm: null }
  const emEspera = valido(e.estado, agora) ? e.estado.autoEstado : null
  const entendido = (est: EstadoAuto): EstadoAuto => ({ ...est, naoEntendeu: 0 })

  if (intencao === 'ok' || intencao === 'voltar') return { acao: 'nada', intencao, estado: e.estado, naoEntendida: false }

  // Esperando o que mudar no pedido (18/10): a mensagem vira a solicitação (o motor registra), a não ser que seja atendente/parar.
  // "cancelar", "tirar do pedido" etc. são palavras do assunto "atendente", mas aqui são a resposta à pergunta do robô
  // (19/10: "quero cancelar" caía na pergunta de novo, em loop). Só o pedido explícito de atendente continua atendente.
  const respostaDeAlteracao = intencao !== 'atendente' || ehAlteracaoDePedido(classificacao.normalizado)
  if (emEspera?.startsWith('alterar_pedido:') && respostaDeAlteracao && intencao !== 'parar' && intencao !== 'reclamacao') {
    return { acao: 'alterar_pedido_registrar', intencao: 'status_pedido', estado: entendido(limpo), naoEntendida: false, pedidoId: emEspera.slice('alterar_pedido:'.length) }
  }
  // "7" do menu, ou "mudar/cancelar o pedido" com pedido aberto editável: pergunta o que mudar (em vez do atendente).
  if (e.pedidoEditavelId && (/^(?:opcao )?7$/.test(classificacao.normalizado) || (intencao === 'atendente' && ehAlteracaoDePedido(classificacao.normalizado)))) {
    return { acao: 'alterar_pedido_perguntar', intencao: 'status_pedido', estado: { ...entendido(limpo), autoEstado: `alterar_pedido:${e.pedidoEditavelId}`, autoEstadoEm: agoraIso }, naoEntendida: false, pedidoId: e.pedidoEditavelId }
  }

  // Esperando o número do pedido: um número na mensagem (que não seja pedido de atendente/reclamação).
  if (emEspera === 'aguardando_numero' && !['atendente', 'reclamacao', 'parar'].includes(intencao)) {
    // Só número solto ("67", "#67", "é o 67"): código de outro sistema ("#FQ67XK") não é número de pedido (16/10).
    const n = /(?:^|[\s#nº°])(\d{1,7})(?=$|[\s.,!?)])/.exec(texto)?.[1]
    if (n && !classificacao.porNumero) return { acao: 'status_numero', intencao: 'status_pedido', numeroPedido: Number(n), estado: entendido(limpo), naoEntendida: false }
  }

  // Esperando o bairro: a mensagem é o bairro, a não ser que seja outro assunto claro.
  if (emEspera === 'aguardando_bairro' && (intencao === 'outro' || intencao === 'entrega' || intencao === 'saudacao')) {
    const bairro = bairroDaFrase(texto) ?? (intencao === 'outro' ? classificacao.normalizado : null)
    if (bairro) return { acao: 'entrega', intencao: 'entrega', bairro, estado: entendido({ ...e.estado, autoEstadoEm: agoraIso }), naoEntendida: false }
  }

  // Quer pedir pela conversa e o Agente de IA não atendeu (desligado, sem módulo ou indisponível): 1ª vez, o link;
  // itens escritos na conversa, "não consigo usar o link" ou insistiu: chama o atendente (16/10; nunca o link de novo).
  if (intencao === 'pedir') {
    if (e.lojaAberta === false) return { acao: 'pedir_fechada', intencao, estado: entendido(limpo), naoEntendida: false }
    if (classificacao.pedidoSemLink || emEspera === 'pedir_link') return { acao: 'atendente', intencao, estado: entendido(limpo), silenciar: 'atendente', naoEntendida: false, porPedido: true }
    return { acao: 'pedir_link', intencao, estado: { ...entendido(limpo), autoEstado: 'pedir_link', autoEstadoEm: agoraIso }, naoEntendida: false }
  }

  // Pediu a chave Pix (16/10): a chave sai sozinha; sem chave cadastrada, o atendente manda (conversa amarela na central).
  if (intencao === 'pix_chave') {
    if (e.temPix === false) return { acao: 'atendente', intencao, estado: entendido(limpo), silenciar: 'atendente', naoEntendida: false, porSemPix: true }
    return { acao: 'pix_chave', intencao, estado: entendido(limpo), naoEntendida: false }
  }
  // Resumo que a vitrine mandou depois do pedido (16/10): confirma o pedido; nunca manda o link.
  if (intencao === 'resumo_pedido') return { acao: 'resumo_pedido', intencao, estado: entendido(limpo), naoEntendida: false }
  if (intencao === 'tempo_entrega') return { acao: 'tempo_entrega', intencao, estado: entendido(limpo), naoEntendida: false }
  if (intencao === 'duvida') return { acao: 'duvida', intencao, estado: entendido(limpo), naoEntendida: false }

  if (intencao === 'outro') {
    const vezes = e.estado.naoEntendeu + 1
    if (vezes >= 2) {
      return { acao: 'atendente', intencao, estado: { ...limpo, naoEntendeu: 0 }, silenciar: 'atendente', naoEntendida: true, porNaoEntender: true }
    }
    return { acao: 'nao_entendeu', intencao, estado: { ...limpo, naoEntendeu: vezes }, naoEntendida: true }
  }

  const acao = ACAO_DO_ASSUNTO[intencao]
  const base = entendido(limpo)
  switch (acao) {
    case 'saudacao': {
      const recente = e.estado.saudacaoEm && agora.getTime() - Date.parse(e.estado.saudacaoEm) < SAUDACAO_JANELA_MS
      return recente
        ? { acao: 'menu_curto', intencao, estado: base, naoEntendida: false }
        : { acao: 'saudacao', intencao, estado: { ...base, saudacaoEm: agoraIso }, naoEntendida: false }
    }
    case 'entrega': {
      // "Vcs tá fazendo entrega ainda" → "Não encontrei o bairro 'ainda'" (19/10): só vale bairro que parece bairro.
      const achado = classificacao.porNumero ? null : bairroDaFrase(texto)
      const bairro = bairroPlausivel(achado) ? achado : null
      const estado = { ...base, autoEstado: 'aguardando_bairro' as const, autoEstadoEm: agoraIso }
      return bairro
        ? { acao: 'entrega', intencao, bairro, estado, naoEntendida: false }
        : { acao: 'entrega_perguntar_bairro', intencao, estado, naoEntendida: false }
    }
    case 'atendente':
    case 'reclamacao':
      return { acao, intencao, estado: base, silenciar: 'atendente', naoEntendida: false }
    case 'parar':
      return { acao, intencao, estado: base, silenciar: 'parar', naoEntendida: false }
    default:
      return { acao, intencao, estado: base, naoEntendida: false }
  }
}
