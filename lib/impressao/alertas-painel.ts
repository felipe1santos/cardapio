/**
 * Alertas de impressão no painel do lojista (Alfa 1, 09/10) — regras puras; a rota
 * /api/admin/impressao/alerta junta os dados e a barra (components/admin/alertas-impressao.tsx) mostra.
 *   c) "A impressão automática está desligada": Imprimir sozinho desligado, loja aberta e pedido chegando
 *      (pelo menos um nos últimos 30 min).
 *   d) Nenhum computador buscando pedidos há mais de 2 min, com a loja aberta, o Imprimir sozinho ligado e
 *      algum Assistente instalado (novo pareado ou o antigo com sinal registrado).
 */
export const PEDIDOS_RECENTES_MIN = 30
export const SEM_SINAL_MS = 2 * 60_000

export function alertaImprimirSozinhoDesligado(p: { impressaoAutomatica: boolean; lojaAberta: boolean; pedidosRecentes: number }): boolean {
  return !p.impressaoAutomatica && p.lojaAberta && p.pedidosRecentes > 0
}

/** `sinais`: último sinal (ISO) de cada Assistente da loja — novos não revogados e o antigo, se houver. */
export function alertaSemAssistente(p: { impressaoAutomatica: boolean; lojaAberta: boolean; sinais: (string | null)[]; agora: number }): boolean {
  if (!p.impressaoAutomatica || !p.lojaAberta || p.sinais.length === 0) return false
  return !p.sinais.some((s) => !!s && p.agora - Date.parse(s) <= SEM_SINAL_MS)
}
