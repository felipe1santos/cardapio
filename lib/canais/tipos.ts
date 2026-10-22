/**
 * Canais externos (Etapa 2, 19/10/2026): marketplaces que mandam pedidos para o Kanban. Modelo COMUM: cada conector
 * (Open Delivery → Keeta/99Food; iFood) traduz o pedido do app para `PedidoExterno`; `importarPedidoExterno` grava o
 * pedido Menuzia uma única vez; `sincronizarStatus` devolve ao app o status que a loja move no Kanban.
 *
 * O pedido do app NÃO é editável no Menuzia (lib/pedido-editavel.ts › app_externo) e o pagamento já aconteceu no app
 * (prepago) ou será recebido na entrega pelo entregador do app (pending).
 */
export type Canal = 'keeta' | '99food' | 'ifood'
export const CANAIS: readonly Canal[] = ['keeta', '99food', 'ifood']
export const NOME_CANAL: Record<Canal, string> = { keeta: 'Keeta', '99food': '99Food', ifood: 'iFood' }
/** 20/10: canal liberado para conectar (credenciais homologadas). false = "Em breve" em Integrações e a API recusa salvar/ligar. */
// 21/10 (ordem do dono): todos liberados para conectar; cada loja cola as próprias credenciais.
export const CANAL_DISPONIVEL: Record<Canal, boolean> = { keeta: true, '99food': true, ifood: true }

export interface ItemExterno {
  /** Id do item no app (para responder/rastrear). */
  externoId: string
  /** Código que liga ao cardápio Menuzia (Open Delivery: externalCode = nosso item id; iFood: externalCode do catálogo). */
  codigoExterno: string | null
  nome: string
  quantidade: number
  /** Preço unitário do item SEM complementos, em reais. */
  precoUnitario: number
  observacao: string
  complementos: { nome: string; preco: number; quantidade: number }[]
}

export interface PedidoExterno {
  canal: Canal
  externoId: string
  /** Número curto que o cliente e o entregador do app veem (ex.: "1234"). */
  displayId: string
  criadoEm: string
  tipo: 'entrega' | 'retirada'
  cliente: { nome: string; telefone: string; documento: string | null }
  endereco: { rua: string; numero: string; complemento: string; bairro: string; cidade: string; estado: string; cep: string; referencia: string; latitude: number | null; longitude: number | null } | null
  itens: ItemExterno[]
  subtotal: number
  taxaEntrega: number
  desconto: number
  total: number
  pagamento: {
    /** Já pago no app (cartão/Pix/carteira). false = o entregador do app recebe na entrega. */
    prepago: boolean
    forma: 'pix' | 'cartao' | 'dinheiro'
    trocoPara: number | null
    descricao: string
  }
  /** Quem entrega: o app (entregador do app) ou a loja. */
  entregaPor: 'app' | 'loja'
  observacao: string
  agendadoPara: string | null
  /** Payload original (auditoria/depuração). */
  bruto: unknown
}

/** Status do pedido no Menuzia que interessam ao app, na ordem do fluxo. */
export type StatusParaApp = 'confirmado' | 'preparando' | 'pronto' | 'despachado' | 'entregue' | 'cancelado'

/** Traduz o status Menuzia para a etapa que o app entende. null = nada a mandar. Puro. */
export function statusParaApp(statusMenuzia: string, tipo: 'entrega' | 'retirada'): StatusParaApp | null {
  switch (statusMenuzia) {
    case 'preparando': return 'preparando'
    case 'pronto': return 'pronto'
    case 'em_rota': return tipo === 'entrega' ? 'despachado' : 'pronto'
    case 'entregue': return 'entregue'
    case 'cancelado': return 'cancelado'
    default: return null
  }
}

/** Ordem das etapas: só avança (o app não aceita voltar). Puro. */
const ORDEM: Record<StatusParaApp, number> = { confirmado: 1, preparando: 2, pronto: 3, despachado: 4, entregue: 5, cancelado: 9 }
export function etapasAEnviar(jaEnviado: StatusParaApp | null, alvo: StatusParaApp): StatusParaApp[] {
  if (alvo === 'cancelado') return jaEnviado === 'cancelado' ? [] : ['cancelado']
  const de = jaEnviado ? ORDEM[jaEnviado] : 0
  if (de >= ORDEM[alvo] || jaEnviado === 'cancelado') return []
  const todas: StatusParaApp[] = ['confirmado', 'preparando', 'pronto', 'despachado', 'entregue']
  return todas.filter((e) => ORDEM[e] > de && ORDEM[e] <= ORDEM[alvo])
}

const brlNum = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0 }
export const num2 = brlNum

/** Telefone só dígitos com DDI 55 quando faltar (o Kanban/WhatsApp usam assim). Puro. */
export function telefoneBr(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '')
  // 0800 (número intermediário do iFood) não é celular: fica como está.
  if (d.startsWith('0800')) return d
  if (d.length === 10 || d.length === 11) d = `55${d}`
  return d
}
