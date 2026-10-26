import { intervaloAnterior, type Intervalo } from './dashboard-metricas'

/**
 * Janela de pedidos que o Dashboard precisa carregar (achado #8, 26/10). Antes baixava o histórico INTEIRO com itens a
 * cada abertura. O período escolhido + o período anterior (a variação "vs. período anterior") bastam; o "novos x
 * recorrentes" usa um histórico leve à parte (carregarDashboard).
 *
 * Em ms. `null` = histórico inteiro ("Tudo").
 */
export function desdeNecessario(intervalo: Intervalo): number | null {
  if (intervalo.inicio <= 0) return null
  return intervaloAnterior(intervalo)?.inicio ?? intervalo.inicio
}

/** `carregado`: desde quando os dados já carregados vão (`null` = tudo; `undefined` = nada carregado ainda). */
export function precisaRecarregar(carregado: number | null | undefined, necessario: number | null): boolean {
  if (carregado === undefined) return true
  if (carregado === null) return false
  if (necessario === null) return true
  return necessario < carregado
}
