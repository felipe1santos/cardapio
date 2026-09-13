/**
 * Ponto de foco de uma imagem recortada por `object-fit: cover`.
 *
 * A capa da loja e o cartão de categoria são exibidos em proporções diferentes
 * conforme a largura da tela (2:1 no celular, bem mais largo no desktop). Um
 * recorte gravado no arquivo acertaria uma proporção e erraria a outra; um par
 * de coordenadas percentuais serve as duas com o mesmo arquivo, e ainda
 * funciona nas capas que já foram enviadas.
 */

export interface Foco {
  /** 0-100, percentual da largura. 0 = esquerda, 100 = direita. */
  x: number
  /** 0-100, percentual da altura. 0 = topo, 100 = base. */
  y: number
}

/** Centro — idêntico a um `object-cover` sem `object-position`. */
export const FOCO_PADRAO: Foco = { x: 50, y: 50 }

function eixo(v: unknown): number | null {
  // O Postgres devolve `numeric` como string; o formulário devolve string.
  // String vazia/só espaço vira `''`/`'  '` num campo limpo pelo usuário —
  // `Number('')` e `Number('   ')` dão 0, não NaN, então precisam ser
  // barradas antes do Number() ou o campo limpo ancora a imagem no canto.
  if (typeof v === 'string' && v.trim() === '') return null
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  if (!Number.isFinite(n)) return null
  return Math.min(100, Math.max(0, n))
}

/**
 * Satura na faixa 0-100 e cai no centro pro que não for número finito. O pior
 * caso de um dado corrompido é a imagem ancorada numa borda — nunca um
 * `object-position` inválido, que o navegador ignoraria inteiro.
 */
export function focoValido(x: unknown, y: unknown): Foco {
  const px = eixo(x)
  const py = eixo(y)
  // Se só um eixo for inválido, os dois caem no padrão — um foco parcial
  // (ex.: x bom, y no lixo) ancoraria a imagem num ponto que ninguém
  // escolheu, o que é pior que simplesmente centralizar.
  if (px === null || py === null) return FOCO_PADRAO
  return { x: px, y: py }
}

/** Arredonda em 2 casas pra não emitir "33.333333333%" no style. */
export function objectPosition(foco: Foco): string {
  const r = (n: number) => String(Math.round(n * 100) / 100)
  return `${r(foco.x)}% ${r(foco.y)}%`
}
