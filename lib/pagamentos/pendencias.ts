/**
 * O que o cron faz com uma cobrança online depois de conferi-la no Mercado Pago (verificarPendentes).
 * - 'recusado' (cartão recusado) é final no MP, mas o pedido espera até o prazo: o cliente pode tentar outro cartão.
 *   Vencido o prazo, expira o pedido — antes de 26/10 ficava `pendente` para sempre e era conferido a cada minuto.
 * - 'pendente' vencido: cancela no MP (para ninguém pagar depois) e expira.
 */
export type AcaoPendencia = 'aguardar' | 'expirar' | 'cancelar_no_mp_e_expirar'

/** Folga depois do prazo, a mesma de sempre do cron. */
const FOLGA_MS = 60_000

export function acaoDaPendencia(resultado: string, expiraEm: string, agora: number): AcaoPendencia {
  const vencido = Date.parse(expiraEm) + FOLGA_MS < agora
  if (!vencido) return 'aguardar'
  if (resultado === 'recusado') return 'expirar'
  if (resultado === 'pendente') return 'cancelar_no_mp_e_expirar'
  return 'aguardar'
}
