/**
 * Parceiro de entrega que NÃO recebe na entrega (21/10/2026): pedido "a receber" (dinheiro/maquininha) só sai pelo
 * parceiro depois de pago por Pix. Parte PURA (testada): quem não recebe, estados do fluxo, limite de preço e textos.
 *   aguardando       Pix do total enviado ao cliente; pago → o servidor chama o parceiro sozinho
 *   vencido          10 min sem pagar → alarme no painel; a loja escolhe motoboy próprio (cancela o Pix) ou cobra de novo
 *   confirmar_preco  pagou, mas a corrida ficou >20% mais cara → o dono confirma no card
 *   erro             pagou, mas o parceiro recusou → o dono resolve no card
 */
export type EstadoParceiroPix = 'aguardando' | 'vencido' | 'confirmar_preco' | 'erro'
export interface ParceiroPix { provedor: string; estado: EstadoParceiroPix; preco: number; desde: string; precoNovo?: number; erro?: string }

/** Parceiros cujo entregador não cobra o cliente (Foody/Machine aceitam pagamento na entrega pelo Open Delivery). */
export const NAO_RECEBE_NA_ENTREGA = new Set(['uber', 'lalamove'])
export const PIX_PARCEIRO_PRAZO_MIN = 10
export const LIMITE_AUMENTO = 0.2

export function precisaPixAntes(provedor: string, pedido: { pago: boolean }): boolean {
  return NAO_RECEBE_NA_ENTREGA.has(provedor) && !pedido.pago
}

/** A cotação nova passou de 20% acima da que a loja viu? */
export function precoMudouDemais(antigo: number, novo: number): boolean {
  if (!(antigo > 0)) return false
  return novo > antigo * (1 + LIMITE_AUMENTO)
}

export function venceuPixParceiro(desde: string, agora = Date.now()): boolean {
  return agora - Date.parse(desde) >= PIX_PARCEIRO_PRAZO_MIN * 60_000
}

export function lerParceiroPix(raw: unknown): ParceiroPix | null {
  const v = raw as Partial<ParceiroPix> | null
  if (!v || typeof v.provedor !== 'string' || !['aguardando', 'vencido', 'confirmar_preco', 'erro'].includes(String(v.estado))) return null
  return { provedor: v.provedor, estado: v.estado as EstadoParceiroPix, preco: Number(v.preco ?? 0), desde: String(v.desde ?? ''), ...(v.precoNovo !== undefined ? { precoNovo: Number(v.precoNovo) } : {}), ...(v.erro ? { erro: String(v.erro) } : {}) }
}

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

/** 1ª mensagem ao cliente (a 2ª é o código Pix sozinho, fácil de copiar). */
export function textoPixParceiro(p: { numero: number; valor: number }): string {
  return `*Seu pedido \`#${p.numero}\` está pronto! 🛵*\n\nPara enviarmos pelo entregador parceiro, pague por Pix: *${brl(p.valor)}*. Assim que pagar, ele sai na hora. Copie o código 👇`
}

export function textoPixParceiroPago(p: { numero: number }): string {
  return `*Pagamento recebido ✅*\n\nO pedido \`#${p.numero}\` já vai sair com o entregador parceiro.`
}

/** Etiqueta do card do Kanban. */
export function etiquetaParceiroPix(pp: ParceiroPix, nome: string): string {
  if (pp.estado === 'aguardando') return `Aguardando Pix para chamar ${nome}`
  if (pp.estado === 'vencido') return 'Cliente não pagou o Pix — entregar com motoboy próprio?'
  if (pp.estado === 'confirmar_preco') return `Pix pago · ${nome} ficou ${brl(pp.precoNovo ?? 0)} (era ${brl(pp.preco)}) — confirme`
  return `Pix pago · ${nome} não chamou: ${pp.erro ?? 'tente de novo'}`
}
