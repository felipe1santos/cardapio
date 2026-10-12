/**
 * Robô de autoatendimento — máquina de estados pura (sem banco): dada a mensagem classificada e o estado da
 * conversa, decide a ação e o estado novo. O webhook e o simulador usam a mesma função.
 * Decisões em docs/robo-whatsapp/autoatendimento-decisoes.md (D6, D7, D11, D12, D13).
 */
import { bairroDaFrase, type Assunto, type Classificacao, type Intencao } from './classificador'
import type { TipoMensagem } from '@/lib/mensageria/provedor'

export type AcaoAuto =
  | 'saudacao' | 'menu_curto' | 'cardapio' | 'entrega' | 'entrega_perguntar_bairro' | 'status' | 'status_numero'
  | 'horario' | 'pagamento' | 'endereco' | 'reclamacao' | 'atendente' | 'parar' | 'nao_entendeu' | 'audio' | 'nada'
  | 'pedir_link' | 'pedir_sem_link'

export interface EstadoAuto {
  autoEstado: 'aguardando_bairro' | 'aguardando_numero' | 'pedir_link' | null
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
}

export interface EntradaDecisao {
  classificacao: Classificacao
  texto: string
  estado: EstadoAuto
  agora: Date
  assuntosDesligados?: Set<Assunto>
  /** Tipo da mensagem (padrão: texto). */
  tipo?: TipoMensagem
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
  if (intencao !== 'ok' && intencao !== 'voltar' && intencao !== 'outro' && intencao !== 'pedir' && desligados.has(intencao) && !SEMPRE_LIGADOS.includes(intencao)) intencao = 'outro'

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

  // Esperando o número do pedido: um número na mensagem (que não seja pedido de atendente/reclamação).
  if (emEspera === 'aguardando_numero' && !['atendente', 'reclamacao', 'parar'].includes(intencao)) {
    const n = /\d{1,7}/.exec(texto)?.[0]
    if (n && !classificacao.porNumero) return { acao: 'status_numero', intencao: 'status_pedido', numeroPedido: Number(n), estado: entendido(limpo), naoEntendida: false }
  }

  // Esperando o bairro: a mensagem é o bairro, a não ser que seja outro assunto claro.
  if (emEspera === 'aguardando_bairro' && (intencao === 'outro' || intencao === 'entrega' || intencao === 'saudacao')) {
    const bairro = bairroDaFrase(texto) ?? (intencao === 'outro' ? classificacao.normalizado : null)
    if (bairro) return { acao: 'entrega', intencao: 'entrega', bairro, estado: entendido({ ...e.estado, autoEstadoEm: agoraIso }), naoEntendida: false }
  }

  // Quer pedir pela conversa e o Agente de IA não atendeu (desligado, sem módulo ou indisponível): link gentil;
  // se insistir em 15 min ou disser que não consegue usar o link, oferece o atendente (11/10).
  if (intencao === 'pedir') {
    if (classificacao.pedidoSemLink || emEspera === 'pedir_link') return { acao: 'pedir_sem_link', intencao, estado: entendido(limpo), naoEntendida: false }
    return { acao: 'pedir_link', intencao, estado: { ...entendido(limpo), autoEstado: 'pedir_link', autoEstadoEm: agoraIso }, naoEntendida: false }
  }

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
      const bairro = classificacao.porNumero ? null : bairroDaFrase(texto)
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
