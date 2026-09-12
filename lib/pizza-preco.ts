/**
 * Pizza com mais de um sabor.
 *
 * O pedido guarda só o NOME do sabor (`pedido_itens.sabor_nome`, um text), e
 * kanban, cozinha, WhatsApp e recibo térmico apenas imprimem esse texto. Então
 * meio a meio é uma junção de nomes — nenhuma tabela nova, nenhuma mudança na
 * folha de impressão.
 *
 * O separador é " / " com espaços dos dois lados de propósito: nome de sabor
 * costuma ter "C/" colado ("Bacon C/ Milho"), e colado não casa com o separador.
 */

export type RegraPrecoPizza = 'media' | 'maior'

export const SEPARADOR_SABORES = ' / '

export function juntarSabores(nomes: string[]): string {
  return nomes.join(SEPARADOR_SABORES)
}

export function separarSabores(texto: string): string[] {
  return texto
    .split(SEPARADOR_SABORES)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/** Nome que contém o separador quebraria o round-trip — o cadastro recusa. */
export function nomeTemSeparador(nome: string): boolean {
  return nome.includes(SEPARADOR_SABORES)
}

/**
 * Preço da pizza a partir dos preços dos sabores escolhidos, no tamanho já
 * escolhido. `media` é o padrão de mercado; `maior` é o que algumas casas usam
 * pra não perder margem quando o cliente mistura um sabor caro com um barato.
 */
export function precoPizzaSabores(precos: number[], regra: RegraPrecoPizza): number {
  if (precos.length === 0) return 0
  if (regra === 'maior') return Math.max(...precos)
  const soma = precos.reduce((s, p) => s + p, 0)
  return Math.round((soma / precos.length) * 100) / 100
}
