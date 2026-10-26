/**
 * O que um evento de `pedidos` muda no PDV (achado #24 da auditoria, 25/10). O mapa de mesas e a comanda aberta só
 * dependem de pedidos ligados a uma comanda (mesa, balcão ou delivery lançado no PDV); delivery da vitrine não mexe em
 * nada ali. Evento sem os dados (DELETE traz só a chave) recarrega tudo, por segurança.
 */
/** Junta os eventos de uma janela curta numa recarga só (a janela conta do primeiro evento). */
export function criarAgrupadorPdv(esperaMs: number, executar: (r: { mesas: boolean; comanda: boolean }) => void) {
  let pendente = { mesas: false, comanda: false }
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    pedir(r: { mesas: boolean; comanda: boolean }) {
      if (!r.mesas && !r.comanda) return
      pendente = { mesas: pendente.mesas || r.mesas, comanda: pendente.comanda || r.comanda }
      if (timer) return
      timer = setTimeout(() => {
        const p = pendente
        pendente = { mesas: false, comanda: false }
        timer = null
        executar(p)
      }, esperaMs)
    },
    cancelar() {
      if (timer) clearTimeout(timer)
      timer = null
      pendente = { mesas: false, comanda: false }
    },
  }
}

export function reacaoDoPdv(
  payload: { eventType?: string; new?: unknown; old?: unknown },
  comandaAbertaId: string | null,
): { mesas: boolean; comanda: boolean } {
  const linha = payload.new as { canal?: unknown; comanda_id?: unknown } | null | undefined
  const semDados = payload.eventType === 'DELETE' || !linha || !('comanda_id' in linha)
  if (semDados) return { mesas: true, comanda: !!comandaAbertaId }
  const comandaId = typeof linha.comanda_id === 'string' ? linha.comanda_id : null
  const doPdv = !!comandaId || (typeof linha.canal === 'string' && linha.canal !== 'delivery')
  return { mesas: doPdv, comanda: !!comandaAbertaId && comandaId === comandaAbertaId }
}
