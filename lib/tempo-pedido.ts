/**
 * Contador de tempo do card do Kanban (2026-10-03): um só, legível em qualquer idade do pedido.
 * Antes: "1986:17" (minutos:segundos) e um selo separado "PARADO HÁ 1 DIA".
 *   < 1 hora  → "13 min"
 *   < 1 dia   → "1 hora", "2 horas"
 *   ≥ 1 dia   → "1 dia", "2 dias"
 */
export function textoTempoPedido(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000))
  if (min < 60) return `${min} min`
  const horas = Math.floor(min / 60)
  if (horas < 24) return horas === 1 ? '1 hora' : `${horas} horas`
  const dias = Math.floor(horas / 24)
  return dias === 1 ? '1 dia' : `${dias} dias`
}

/**
 * Cor do contador (só texto, sem fundo): verde até 10 min, âmbar até 20 min, vermelho depois —
 * as mesmas faixas de alerta de antes.
 */
export function corTempoPedido(ms: number): 'ok' | 'atencao' | 'atraso' {
  const min = ms / 60_000
  if (min < 10) return 'ok'
  if (min < 20) return 'atencao'
  return 'atraso'
}
