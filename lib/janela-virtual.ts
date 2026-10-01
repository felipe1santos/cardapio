/**
 * Virtualização simples de linhas de altura fixa (2026-10-01): só as linhas à vista (+ folga)
 * entram no DOM; espaçadores acima/abaixo mantêm a altura total e a barra de rolagem fiéis.
 */
export function janelaVisivel(total: number, scrollTop: number, altura: number, alturaLinha: number, folga = 8): { inicio: number; fim: number } {
  const inicio = Math.max(0, Math.floor(scrollTop / alturaLinha) - folga)
  const fim = Math.min(total, Math.ceil((scrollTop + altura) / alturaLinha) + folga)
  return { inicio, fim }
}
