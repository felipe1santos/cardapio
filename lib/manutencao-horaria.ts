/**
 * Portão para tarefas de manutenção dentro de crons que rodam a cada minuto (revisão de escala, 26/10): libera a primeira
 * vez e depois só passado o intervalo. Em memória do processo — reiniciar o servidor só antecipa uma rodada, o que é
 * inofensivo para manutenção (limpeza, expiração).
 */
export function criarPortaoHorario(intervaloMs: number) {
  let ultima = 0
  return {
    liberar(agora: number = Date.now()): boolean {
      if (ultima && agora - ultima < intervaloMs) return false
      ultima = agora
      return true
    },
  }
}
