/**
 * Card novo do Kanban (13/10/2026, "Novidades em teste"): o que cada pedaço do card mostra. Puro — o card e o
 * painel do pedido usam as mesmas regras, e os testes conferem sem tela. Nada aqui muda o pedido.
 */
import { atendimentoNoCard, rotuloOrigemPedido, type PedidoParaRotulo } from '@/lib/pedido-origem'
import { formatarReal } from '@/lib/moeda'

export interface PedidoCard extends PedidoParaRotulo {
  status: string
  tipo: string
  origemCanal: string | null
  origemCampanha: string | null
  formaPagamento: string
  pagamentoOnline: boolean
  pago: boolean
  trocoPara: number | null
}

const EMOJI_TIPO = { ENTREGA: ['🛵', 'Entrega'], RETIRADA: ['🛍️', 'Retirada'], MESA: ['🍽️', 'Mesa'], 'BALCÃO': ['🏪', 'Balcão'] } as const

/** Ícones da linha 1: o tipo (entrega/retirada/mesa/balcão) e ✍️ quando a IA do WhatsApp anotou o pedido. */
export function iconesDoTipo(p: PedidoCard): { emoji: string; rotulo: string }[] {
  const [emoji, rotulo] = EMOJI_TIPO[atendimentoNoCard(p)]
  return [{ emoji, rotulo }, ...(p.origemCanal === 'whatsapp_ia' ? [{ emoji: '✍️', rotulo: 'Anotado pelo WhatsApp' }] : [])]
}

export type IconePagamento = 'dinheiro' | 'pix' | 'cartao' | 'mercado_pago' | 'conta'

/** Etiqueta da forma de pagamento (embaixo do valor). Pago online = Mercado Pago. */
export function pagamentoDoCard(p: PedidoCard): { texto: string; icone: IconePagamento } {
  if (p.canal === 'mesa') return { texto: 'Na conta', icone: 'conta' }
  if (p.pagamentoOnline) return { texto: p.pago ? 'Pago' : 'Aguardando pagamento', icone: 'mercado_pago' }
  if (p.formaPagamento === 'dinheiro') return { texto: p.pago ? 'Dinheiro pago' : `Dinheiro${p.trocoPara ? ` · troco p/ ${formatarReal(p.trocoPara)}` : ''}`, icone: 'dinheiro' }
  if (p.formaPagamento === 'pix') return { texto: p.pago ? 'Pix pago' : 'Pix', icone: 'pix' }
  if (p.pago) return { texto: 'Cartão pago', icone: 'cartao' }
  return { texto: p.tipo === 'entrega' ? 'Cartão na entrega' : 'Cartão na retirada', icone: 'cartao' }
}

export interface LogoOrigem {
  /** Arquivo em public/origens; null = ícone neutro. */
  arquivo: string | null
  rotulo: string
  /** Ícone neutro quando não há logo: PDV, mesa, QR Code, outros ou só o nome. */
  neutro?: 'pdv' | 'mesa' | 'qrcode' | 'outros' | 'nome'
  /** Selo sobre o ícone do Menuzia (Notificação do app). */
  selo?: 'sino'
}

const LOGOS: Record<string, LogoOrigem> = {
  whatsapp: { arquivo: '/origens/whatsapp.svg', rotulo: 'WhatsApp' },
  whatsapp_ia: { arquivo: '/origens/whatsapp.svg', rotulo: 'WhatsApp (IA)' },
  instagram: { arquivo: '/origens/instagram.svg', rotulo: 'Instagram' },
  facebook: { arquivo: '/origens/facebook.svg', rotulo: 'Facebook' },
  meta: { arquivo: '/origens/meta.svg', rotulo: 'Anúncio Meta' },
  google_anuncio: { arquivo: '/origens/google-ads.svg', rotulo: 'Anúncio Google' },
  google_busca: { arquivo: '/origens/google.svg', rotulo: 'Google' },
  ifood: { arquivo: '/origens/ifood.svg', rotulo: 'iFood' },
  push: { arquivo: '/origens/menuzia.png', rotulo: 'Notificação do app', selo: 'sino' },
  qrcode: { arquivo: null, rotulo: 'QR Code', neutro: 'qrcode' },
  outros: { arquivo: null, rotulo: 'Outros', neutro: 'outros' },
  // Sem arquivo oficial público (13/10): ícone neutro com o nome até o dono mandar o arquivo.
  '99food': { arquivo: null, rotulo: '99Food', neutro: 'nome' },
}

/** Logo da origem (ponta direita do card), do campo de origem que já existe no pedido. */
export function logoDaOrigem(p: PedidoCard): LogoOrigem {
  const posto = rotuloOrigemPedido(p).posto
  if (posto === 'PDV') return { arquivo: null, rotulo: 'PDV', neutro: 'pdv' }
  if (posto === 'Salão') return { arquivo: null, rotulo: 'Salão', neutro: 'mesa' }
  if (p.origemCanal && LOGOS[p.origemCanal]) return LOGOS[p.origemCanal]
  return { arquivo: '/origens/menuzia.png', rotulo: 'Cardápio' }
}

/** Itens do corpo do card (ajuste do dono 13/10 v2): no máximo 2 linhas; com mais, os 2 primeiros e o resto ("+N" na linha do 2º). */
export function itensDoCard<T extends { quantidade: number; nome: string }>(itens: T[]): { linhas: T[]; resto: number } {
  return { linhas: itens.slice(0, 2), resto: Math.max(0, itens.length - 2) }
}

export type AcaoCard = 'aceitar' | 'pronto' | 'entregue' | 'saiu' | 'despachar'

/** A setinha faz o MESMO que o botão de etapa do card antigo (mesmas condições). */
export function acaoDoCard(p: Pick<PedidoCard, 'status' | 'tipo'>, usaDespachoDeRotas: boolean): AcaoCard | null {
  if (p.status === 'recebido') return 'aceitar'
  if (p.status === 'preparando') return 'pronto'
  if (p.status === 'pronto' && p.tipo === 'retirada') return 'entregue'
  if (p.status === 'pronto' && p.tipo === 'entrega') return usaDespachoDeRotas ? 'despachar' : 'saiu'
  return null
}
