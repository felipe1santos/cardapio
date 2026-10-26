import { mapEntregador, type Entregador } from './queries/pedidos'

/**
 * Evento de `entregadores` aplicado direto na lista (achado #7 da auditoria, 25/10). O heartbeat do app do motoboy grava a
 * cada 30 s e cada gravação fazia a Logística e o Despacho relerem pedidos, motoboys e concluídos. O registro novo vem
 * inteiro no evento: basta trocar a linha. Só motoboy novo, apagado ou desconhecido pede recarga.
 */
export function aplicarEventoEntregador(
  lista: Entregador[],
  payload: { eventType?: string; new?: unknown; old?: unknown },
  agora: number = Date.now(),
): { lista: Entregador[]; recarregar: boolean } {
  const novo = payload.new as Record<string, unknown> | null | undefined
  if (payload.eventType !== 'UPDATE' || typeof novo?.id !== 'string') return { lista, recarregar: true }
  const i = lista.findIndex((e) => e.id === novo.id)
  if (i < 0) return { lista, recarregar: true }
  const copia = lista.slice()
  // Entregas em rota vêm dos pedidos, não da linha do motoboy.
  copia[i] = mapEntregador(novo, lista[i].emRota, agora)
  return { lista: copia, recarregar: false }
}
