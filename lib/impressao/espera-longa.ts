/**
 * O servidor avisa o Beta de que ESPEROU (espera longa, `esperaAte: 20`) — e o Beta, ao
 * ler isso, pergunta de novo na hora. Só pode avisar quando a espera de fato aconteceu:
 * com a impressão automática desligada a lista volta vazia na hora, e o aviso fazia o
 * Beta perguntar 2 a 4 vezes por segundo, sem parar (carga e egress contínuos por loja).
 */
export function anunciaEsperaLonga(esperarSegundos: number, impressaoAutomatica: boolean | null | undefined): boolean {
  return esperarSegundos > 0 && impressaoAutomatica === true
}
