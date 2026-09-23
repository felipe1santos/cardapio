/**
 * Comanda esquecida: conta aberta há tempo demais para ainda ter gente na mesa.
 *
 * A conta só fecha quando alguém da loja fecha. Quando ninguém fecha, ela fica —
 * e ficou: a MENUZIA tinha a Mesa 06 aberta desde 28/06 com R$ 97,50, e mais
 * três mesas na mesma situação; a pizza-do-rosa, uma. Para o salão aquelas
 * mesas aparecem OCUPADAS para sempre, e o garçom evita sentar cliente numa
 * mesa "em uso" que está vazia há dois meses.
 *
 * Irmã de `lib/pedido-parado.ts`, mesmo princípio: NADA fecha sozinho. Conta é
 * dinheiro — fechar por conta própria viraria venda registrada sem ninguém ter
 * cobrado, ou uma conta apagada com pedido lançado dentro. O sistema cobra,
 * quem resolve é a loja (fechar, cobrar ou cancelar).
 *
 * O corte é mais largo que o do pedido (12h): restaurante tem expediente que
 * vira a noite, e mesa aberta às 23h com fechamento às 3h é rotina. Um dia
 * inteiro sem ninguém fechar já é esquecimento.
 */

export const COMANDA_ESQUECIDA_MS = 24 * 60 * 60 * 1000

export interface ContaAberta {
  /** ISO da abertura da comanda. */
  abertaEm: string | null
}

export function comandaEsquecida(conta: ContaAberta, agora: number): boolean {
  if (!conta.abertaEm) return false
  const aberta = Date.parse(conta.abertaEm)
  if (!Number.isFinite(aberta)) return false
  return agora - aberta >= COMANDA_ESQUECIDA_MS
}

/** Há quanto tempo, curto o bastante para caber no bloco da mesa. */
export function tempoAberta(abertaEm: string, agora: number): string {
  const ms = agora - Date.parse(abertaEm)
  if (!Number.isFinite(ms) || ms < 0) return ''
  const horas = Math.floor(ms / 3_600_000)
  if (horas < 24) return `${horas}h`
  const dias = Math.floor(horas / 24)
  return dias === 1 ? '1 dia' : `${dias} dias`
}

/** Aviso do topo do salão. Null = não há conta esquecida. */
export function avisoDeComandasEsquecidas(contas: ContaAberta[], agora: number): string | null {
  const qtd = contas.filter((c) => comandaEsquecida(c, agora)).length
  if (qtd === 0) return null
  return qtd === 1
    ? '1 mesa está com a conta aberta há mais de um dia. Feche ou cancele — enquanto isso ela aparece ocupada para a equipe.'
    : `${qtd} mesas estão com a conta aberta há mais de um dia. Feche ou cancele cada uma — enquanto isso elas aparecem ocupadas para a equipe.`
}
