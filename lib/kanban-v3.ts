/**
 * Kanban v3 (15/10/2026, "Novidades em teste"): o que o card e o painel do pedido mostram, no padrão visual da central do
 * WhatsApp. Puro — o card, o painel e os testes usam as mesmas regras. Nada aqui muda o pedido: a ação da seta e do botão
 * principal é a mesma de hoje (acaoDoCard), só com a confirmação de entrega do "Em trânsito" somada.
 */
import { atendimentoNoCard } from '@/lib/pedido-origem'
import { acaoDoCard, type AcaoCard, type PedidoCard } from '@/lib/kanban-card'

export interface PedidoV3 extends PedidoCard {
  enderecoBairro: string
  total: number
}

export type Tom = 'verde' | 'azul' | 'ambar'
export type Selo = { emoji: string | null; texto: string }

/** Real sem centavos quando é redondo ("R$ 100"), como no modelo; senão "R$ 64,80". */
function real(v: number): string {
  return Number.isInteger(v) ? `R$ ${v}` : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ')
}

/** Linha 2 do card: tipo no selo verde e, no azul, "Anotado no WhatsApp" (pedido da IA) ou o bairro. */
export function selosDoCard(p: PedidoV3): { tipo: Selo; azul: Selo | null } {
  const a = atendimentoNoCard(p)
  const tipo: Selo = a === 'ENTREGA' ? { emoji: '🛵', texto: 'Entrega' }
    : a === 'RETIRADA' ? { emoji: '🛍️', texto: 'Retirada' }
    : a === 'MESA' ? { emoji: '🍽️', texto: p.mesa ? `Mesa ${p.mesa}` : 'Mesa' }
    : { emoji: '🏪', texto: 'Balcão' }
  if (p.origemCanal === 'whatsapp_ia') return { tipo, azul: { emoji: '✍️', texto: 'Anotado no WhatsApp' } }
  const bairro = a === 'ENTREGA' ? p.enderecoBairro?.trim() : ''
  return { tipo, azul: bairro ? { emoji: null, texto: bairro } : null }
}

/** Selo de pagamento (linha 4 do card e painel). Verde: paga na entrega ou Pix pago. Azul: pago no app. */
export function pagamentoV3(p: PedidoV3): Selo & { tom: Tom } {
  if (p.canal === 'mesa') return { emoji: '🧾', texto: 'Na conta', tom: 'verde' }
  if (p.pagamentoOnline) return p.pago ? { emoji: '✅', texto: 'Pago no app', tom: 'azul' } : { emoji: '⏳', texto: 'Aguardando pagamento', tom: 'ambar' }
  if (p.formaPagamento === 'dinheiro') return { emoji: '💵', texto: p.pago ? 'Dinheiro pago' : `Dinheiro${p.trocoPara ? ` · troco p/ ${real(p.trocoPara)}` : ''}`, tom: 'verde' }
  if (p.formaPagamento === 'pix') return { emoji: '💠', texto: p.pago ? 'Pix pago' : 'Pix', tom: 'verde' }
  if (p.pago) return { emoji: '💳', texto: 'Cartão pago', tom: 'verde' }
  return { emoji: '💳', texto: p.tipo === 'entrega' ? 'Cartão na entrega' : 'Cartão na retirada', tom: 'verde' }
}

/** Situação no painel: "Pago" (azul) ou "A receber" (âmbar). */
export function situacaoPagamento(p: Pick<PedidoV3, 'pago'>): { texto: string; tom: Tom } {
  return p.pago ? { texto: 'Pago', tom: 'azul' } : { texto: 'A receber', tom: 'ambar' }
}

export type AcaoV3 = AcaoCard | 'confirmar'

/**
 * Ação da seta do card e do botão principal do painel. A mesma de hoje (acaoDoCard) e, em trânsito, "Confirmar entrega"
 * só quando o Kanban já tem essa ação (loja sem Logística — o mesmo `onConcluir` do card "Em trânsito").
 */
export function acaoV3(p: Pick<PedidoCard, 'status' | 'tipo'>, o: { despacho: boolean; concluirEmRota: boolean }): AcaoV3 | null {
  if (p.status === 'em_rota') return o.concluirEmRota ? 'confirmar' : null
  return acaoDoCard(p, o.despacho)
}

const ROTULOS: Record<AcaoV3, string> = {
  aceitar: 'Aceitar pedido',
  pronto: 'Marcar como pronto',
  despachar: 'Despachar',
  confirmar: 'Confirmar entrega',
  entregue: 'Marcar como entregue',
  saiu: 'Saiu para entrega',
}
export function rotuloDaAcao(a: AcaoV3): string {
  return ROTULOS[a]
}

export type EstadoEtapa = 'feita' | 'atual' | 'proxima'

/** Barra de etapas: verde-escuro nas concluídas, azul na atual, cinza nas próximas. */
export function estadosDasEtapas(etapas: { id: string }[], status: string): EstadoEtapa[] {
  if (status === 'entregue') return etapas.map(() => 'feita')
  const atual = etapas.findIndex((e) => e.id === status)
  if (atual < 0) return etapas.map(() => 'proxima')
  return etapas.map((_, i) => (i < atual ? 'feita' : i === atual ? 'atual' : 'proxima'))
}

/** Iniciais do avatar: primeiro e último nome. */
export function iniciais(nome: string): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  const primeira = partes[0][0]
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : ''
  return (primeira + ultima).toUpperCase()
}

/** "Abrir no mapa": só um link aberto pelo operador (nenhuma API paga é chamada). */
export function linkDoMapa(p: { enderecoRua: string; enderecoNumero: string; enderecoBairro: string; enderecoCidade: string }): string {
  const texto = [p.enderecoRua, p.enderecoNumero, p.enderecoBairro, p.enderecoCidade].map((s) => (s ?? '').trim()).filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(texto)}`
}
