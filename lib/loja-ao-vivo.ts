/**
 * Vitrine: quando conferir de novo se a loja está aberta (16/10/2026). O HTML da vitrine pode vir do cache (revalidate
 * de 60 s) e a página pode ficar aberta no celular por horas; "aberto/fechado" muda com o relógio e com o botão do
 * painel. A conta de aberto/fechado é SEMPRE `lojaEstaAberta` (lib/timezone.ts), a mesma do robô, da IA e do pedido;
 * aqui só se decide quando reler. É leitura do banco (sem custo de API), só com a página visível.
 */
export const INTERVALO_LOJA_FECHADA_MS = 60_000
export const INTERVALO_LOJA_ABERTA_MS = 5 * 60_000

export function deveReconferirLoja(o: { aberta: boolean; visivel: boolean; ultimaConferencia: number | null; agora: number }): boolean {
  if (!o.visivel) return false
  if (o.ultimaConferencia === null) return true
  const intervalo = o.aberta ? INTERVALO_LOJA_ABERTA_MS : INTERVALO_LOJA_FECHADA_MS
  return o.agora - o.ultimaConferencia >= intervalo
}
