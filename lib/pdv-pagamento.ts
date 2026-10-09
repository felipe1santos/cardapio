/**
 * Forma de pagamento e troco escolhidos no PDV/balcão ANTES de lançar (0135). Mesmo modelo da
 * vitrine: `pedidos.forma_pagamento` (pix | cartao | dinheiro) + `troco_para`; o detalhe crédito/
 * débito vai em `pedidos.cartao_tipo`. Escolher a forma NÃO marca como pago.
 * Regras puras: valem para a tela (que só ajuda) e para o servidor (que decide).
 */
import type { FormaPagamento } from '@/lib/queries/pedidos'

export type EscolhaPdv = 'dinheiro' | 'pix' | 'credito' | 'debito'
export const ESCOLHAS_PDV: EscolhaPdv[] = ['dinheiro', 'pix', 'credito', 'debito']

export const ROTULO_ESCOLHA: Record<EscolhaPdv, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
}

export interface PagamentoPdv {
  escolha: EscolhaPdv
  /** Só dinheiro: "troco para" em reais. Nulo = não precisa de troco. */
  trocoPara: number | null
  /** "Cobrar agora" (09/10): registra o pagamento junto com o lançamento (entra no caixa e no Financeiro).
   *  Ausente = receber depois (na entrega/retirada), como sempre foi. */
  cobrarAgora?: boolean
}

/** Escolha da tela → colunas do pedido (modelo da vitrine). */
export function paraPedido(p: PagamentoPdv): { forma_pagamento: FormaPagamento; cartao_tipo: 'credito' | 'debito' | null; troco_para: number | null } {
  if (p.escolha === 'credito' || p.escolha === 'debito') return { forma_pagamento: 'cartao', cartao_tipo: p.escolha, troco_para: null }
  if (p.escolha === 'pix') return { forma_pagamento: 'pix', cartao_tipo: null, troco_para: null }
  return { forma_pagamento: 'dinheiro', cartao_tipo: null, troco_para: p.trocoPara && p.trocoPara > 0 ? Math.round(p.trocoPara * 100) / 100 : null }
}

/** Colunas do pedido → escolha da tela (para pré-preencher e editar). Cartão sem detalhe = crédito. */
export function daPedido(forma: string | null | undefined, cartaoTipo: string | null | undefined, trocoPara: number | null | undefined): PagamentoPdv | null {
  if (forma === 'pix') return { escolha: 'pix', trocoPara: null }
  if (forma === 'cartao') return { escolha: cartaoTipo === 'debito' ? 'debito' : 'credito', trocoPara: null }
  if (forma === 'dinheiro') return { escolha: 'dinheiro', trocoPara: trocoPara && trocoPara > 0 ? Number(trocoPara) : null }
  return null
}

/** Rótulo curto em qualquer tela: "Dinheiro", "Pix", "Cartão crédito", "Cartão" (vitrine, sem detalhe). */
export function rotuloForma(forma: string | null | undefined, cartaoTipo?: string | null): string {
  if (forma === 'cartao') return cartaoTipo === 'debito' ? 'Cartão débito' : cartaoTipo === 'credito' ? 'Cartão crédito' : 'Cartão'
  if (forma === 'pix') return 'Pix'
  if (forma === 'dinheiro') return 'Dinheiro'
  return forma ? String(forma) : '—'
}

/** Quanto levar de troco (nunca negativo). */
export function trocoLevar(total: number, trocoPara: number | null | undefined): number {
  if (!trocoPara || trocoPara <= total) return 0
  return Math.round((trocoPara - total) * 100) / 100
}

/**
 * Valida a escolha contra o total da conta. Devolve a mensagem para a tela ou null.
 * O "troco para" tem que ser MAIOR que o total (igual = não precisa de troco).
 */
export function erroPagamentoPdv(p: PagamentoPdv | null, total: number): string | null {
  if (!p || !ESCOLHAS_PDV.includes(p.escolha)) return 'Escolha a forma de pagamento.'
  if (p.escolha !== 'dinheiro' || p.trocoPara === null) return null
  if (!Number.isFinite(p.trocoPara) || p.trocoPara <= 0) return 'Informe para quanto é o troco.'
  if (p.trocoPara <= total) return `O troco tem que ser para mais que o total (${total.toFixed(2).replace('.', ',')}).`
  return null
}

/** Status de pagamento enquanto não foi registrado: nunca "PAGO" antes da hora. */
export function statusAReceber(tipo: string | null | undefined): string {
  return tipo === 'entrega' ? 'A receber na entrega' : 'A pagar na retirada'
}

/** Lê o corpo da requisição (lista fechada). */
export function lerPagamentoPdv(v: unknown): PagamentoPdv | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.escolha !== 'string' || !(ESCOLHAS_PDV as string[]).includes(o.escolha)) return null
  const t = o.trocoPara === null || o.trocoPara === undefined || o.trocoPara === '' ? null : Number(o.trocoPara)
  if (t !== null && (!Number.isFinite(t) || t < 0 || t > 100000)) return null
  return { escolha: o.escolha as EscolhaPdv, trocoPara: o.escolha === 'dinheiro' && t ? t : null, ...(o.cobrarAgora === true ? { cobrarAgora: true } : {}) }
}

/** Atalhos de "troco para" que fazem sentido para o total (só os maiores que ele). */
export function atalhosTroco(total: number): number[] {
  return [20, 50, 100, 200].filter((v) => v > total)
}

/** Chave do pagamento do "Cobrar agora": derivada da chave do lançamento (repetir o envio não cobra duas vezes). */
export function chavePagamentoDoLancamento(chaveLancamento: string): string {
  const h = chaveLancamento.replace(/-/g, '').toLowerCase()
  // Troca o último bloco (12 hex) por um marcador fixo: continua UUID válido e diferente da chave do lançamento.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-c0b4a0${h.slice(20, 26)}`
}
