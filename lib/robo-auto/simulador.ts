/**
 * Simulador do robô de autoatendimento: roda uma conversa em memória com a MESMA classificação, decisão e textos
 * do webhook, mas não grava nem envia nada. Usado pela tela do dono e pelos testes de conversa completa.
 * O silêncio (atendente 1 h, parar até "voltar") imita o que o banco faz (whatsapp_auto_entrada).
 */
import { classificar, type PalavrasExtras } from './classificador'
import { decidir, ESTADO_VAZIO, type EstadoAuto } from './decisao'
import { responder, type DadosLojaAuto, type PedidoAuto } from './respostas'

export const PAUSA_ATENDENTE_MS = 3600_000

export interface ConversaSimulada {
  estado: EstadoAuto
  silenciada: null | { motivo: 'atendente' | 'parar'; desde: string }
}

export interface PassoSimulado {
  entrada: string
  intencao: string
  acao: string
  respostas: string[]
  silenciada: ConversaSimulada['silenciada']
}

export interface FontesSimulador {
  loja: DadosLojaAuto
  extras?: PalavrasExtras
  nomeCliente?: string | null
  /** Pedidos em aberto deste telefone (para o status). */
  pedidosAbertos?: PedidoAuto[]
  /** Buscar por número (só os do telefone). */
  pedidoPorNumero?: (n: number) => PedidoAuto | null
}

export function novaConversa(): ConversaSimulada {
  return { estado: { ...ESTADO_VAZIO }, silenciada: null }
}

export function passo(conv: ConversaSimulada, texto: string, f: FontesSimulador, agora: Date): PassoSimulado {
  const c = classificar(texto, f.extras)
  if (conv.silenciada) {
    const venceu = conv.silenciada.motivo === 'atendente' && agora.getTime() - Date.parse(conv.silenciada.desde) >= PAUSA_ATENDENTE_MS
    const volta = conv.silenciada.motivo === 'parar' && c.intencao === 'voltar'
    if (!venceu && !volta) {
      conv.silenciada = { ...conv.silenciada, desde: conv.silenciada.motivo === 'atendente' ? agora.toISOString() : conv.silenciada.desde }
      return { entrada: texto, intencao: c.intencao, acao: 'silenciada', respostas: [], silenciada: conv.silenciada }
    }
    conv.silenciada = null
    if (volta) return { entrada: texto, intencao: 'voltar', acao: 'reativada', respostas: ['*🔔 Pronto!* O atendimento automático voltou. Digite *oi* para ver as opções.'], silenciada: null }
  }
  const d = decidir({ classificacao: c, texto, estado: conv.estado, agora, assuntosDesligados: f.loja.assuntosDesligados, temPix: !!f.loja.pixChave?.trim() })
  let pedido: PedidoAuto | null = null
  let abertos = 0
  if (d.acao === 'status') {
    abertos = f.pedidosAbertos?.length ?? 0
    pedido = abertos === 1 ? f.pedidosAbertos![0] : null
  } else if (d.acao === 'status_numero' && d.numeroPedido) {
    pedido = f.pedidoPorNumero?.(d.numeroPedido) ?? null
  }
  const r = responder(d, f.loja, { agora, nomeCliente: f.nomeCliente, pedido, abertos })
  conv.estado = { ...d.estado }
  if (r.autoEstado !== undefined) {
    conv.estado.autoEstado = r.autoEstado
    conv.estado.autoEstadoEm = r.autoEstado ? agora.toISOString() : null
  }
  if (d.silenciar) conv.silenciada = { motivo: d.silenciar, desde: agora.toISOString() }
  return { entrada: texto, intencao: d.intencao, acao: d.acao, respostas: r.mensagens, silenciada: conv.silenciada }
}
