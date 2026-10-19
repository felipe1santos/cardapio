/**
 * Pix da diferença (19/10/2026, Fase 3 da edição de pedido). Parte PURA (testada): textos ao cliente, etiqueta do
 * card/painel e regras de prazo. Quem fala com o banco e com o Mercado Pago está em pix-online.ts (criarCobrancaDiferenca,
 * conferirPagamento com finalidade 'diferenca') e em lib/pedidos/editar.ts (decisão da edição).
 *
 * Modelo: pedido pago online cujo total AUMENTOU → `pedidos.diferenca_a_receber` = valor e `diferenca_modo`:
 *   'pix'         cobrança Pix da diferença pendente (vale DIFERENCA_VALIDADE_MIN);
 *   'pix_vencido' passou do prazo sem pagar — a loja decide (receber na entrega ou cobrar de novo);
 *   'entrega'     o motoboy/caixa recebe na entrega (fluxo da Fase 2).
 * Pago → os dois campos voltam a null e o cliente recebe "Recebemos a diferença ✅".
 */
export type DiferencaModo = 'entrega' | 'pix' | 'pix_vencido'

/** Prazo do Pix da diferença (pedido do dono: 30 min; o MP exige vencimento ≥ 31 min — vencimentoNoMp cuida). */
export const DIFERENCA_VALIDADE_MIN = 30

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

/** Horário local (São Paulo) hh:mm. */
export function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
}

/** 1ª mensagem ao cliente: o que mudou já foi dito pela mensagem "alterado"; aqui só a diferença e o prazo. A 2ª é o código sozinho. */
export function textoCobrancaDiferenca(p: { numero: number; valor: number; expiraEm: string }): string {
  return `*Diferença do pedido \`#${p.numero}\`: ${brl(p.valor)}*\n\n> Seu pedido ficou ${brl(p.valor)} mais caro com a alteração. Pague a diferença pelo Pix abaixo (vale até ${horaLocal(p.expiraEm)}). Copie o código 👇`
}

export function textoDiferencaRecebida(p: { numero: number; valor: number }): string {
  return `*Recebemos a diferença ✅*\n\n${brl(p.valor)} do pedido \`#${p.numero}\` confirmado. Obrigado!`
}

/** Alerta para a loja (painel/WhatsApp do dono) quando a diferença não foi paga no prazo. */
export function textoDiferencaVencida(p: { numero: number; valor: number }): string {
  return `Diferença de ${brl(p.valor)} do pedido #${p.numero} não foi paga pelo Pix em ${DIFERENCA_VALIDADE_MIN} min. Abra o pedido e decida: receber na entrega ou cobrar de novo.`
}

/** Push do painel (celular da equipe) para o mesmo caso. */
export function pushDiferencaVencida(p: { numero: number; valor: number }): { title: string; body: string } {
  return { title: `⚠️ Pedido #${p.numero}: diferença não paga`, body: `${brl(p.valor)} do Pix da diferença venceu. Decida no painel.` }
}

export interface EtiquetaDiferenca {
  /** Texto curto para o card ("Dif. R$ 6,00 · Pix pendente"). */
  curto: string
  /** Texto do painel. */
  longo: string
  tom: 'pendente' | 'vencido' | 'entrega'
}

/** Etiqueta do card/painel. null = nada a mostrar. Puro. */
export function etiquetaDiferenca(p: { diferencaAReceber?: number | null; diferencaModo?: DiferencaModo | null; pago: boolean; pagamentoOnline: boolean }): EtiquetaDiferenca | null {
  if (!p.pago || !p.pagamentoOnline) return null
  const v = Number(p.diferencaAReceber ?? 0)
  if (!(v > 0)) return null
  const valor = brl(v)
  if (p.diferencaModo === 'pix') return { curto: `Dif. ${valor} · Pix pendente`, longo: `Diferença de ${valor} · Pix enviado ao cliente, aguardando pagamento`, tom: 'pendente' }
  if (p.diferencaModo === 'pix_vencido') return { curto: `Dif. ${valor} · Pix vencido`, longo: `Diferença de ${valor} · Pix venceu sem pagamento — decida: receber na entrega ou cobrar de novo`, tom: 'vencido' }
  return { curto: `Dif. ${valor} · na entrega`, longo: `Diferença de ${valor} a receber na entrega`, tom: 'entrega' }
}

/** O pedido ainda tem diferença em aberto que o motoboy/caixa deve receber? (modo entrega). */
export function diferencaNaEntrega(p: { pago: boolean; diferencaAReceber?: number | null; diferencaModo?: DiferencaModo | null }): number {
  if (!p.pago || p.diferencaModo !== 'entrega') return 0
  const v = Number(p.diferencaAReceber ?? 0)
  return v > 0 ? Math.round(v * 100) / 100 : 0
}
