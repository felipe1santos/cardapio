import { mapEntregador, type Entregador } from './queries/pedidos'

/**
 * Evento de `entregadores` aplicado direto na lista (achado #7 da auditoria, 25/10). O heartbeat do app do motoboy grava a
 * cada 30 s e cada gravação fazia a Logística e o Despacho relerem pedidos, motoboys e concluídos. O registro novo vem
 * inteiro no evento: basta trocar a linha. Só motoboy novo, apagado ou desconhecido pede recarga.
 */
/**
 * Recalcula o "online" pelo último sinal (2 min), sem consultar o banco. Antes o heartbeat de qualquer motoboy recarregava
 * a lista toda e o ponto verde apagava sozinho; com o evento aplicado na linha, isso precisa de um relógio (revisão 26/10).
 * Nada mudou → devolve a mesma lista (sem re-render).
 */
export function atualizarOnline(lista: Entregador[], agora: number = Date.now()): Entregador[] {
  let mudou = false
  const nova = lista.map((e) => {
    const online = !!e.ultimoAcessoEm && agora - new Date(e.ultimoAcessoEm).getTime() < 2 * 60_000
    if (online === e.online) return e
    mudou = true
    return { ...e, online }
  })
  return mudou ? nova : lista
}

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
