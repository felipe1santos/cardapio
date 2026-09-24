/**
 * Valor em real para as telas do painel administrativo: "R$ 4.088,00".
 *
 * Várias telas do painel tinham um `brl` local com `toFixed(2)` que mostrava
 * "R$ 4088,00", sem o ponto de milhar. Esta é a versão única para elas.
 *
 * Feita à mão (como a de lib/fidelidade-regras.ts), sem toLocaleString: o ICU troca
 * o espaço depois de "R$" por espaço não separável entre versões, o que muda o texto
 * na tela e quebra quem compara texto. Só formata: nenhum valor, cálculo, banco ou
 * API muda. Não é usada pela vitrine, pela tela do entregador nem pela impressão
 * (recibo.js e pre-conta.js têm o próprio formato, validado no papel).
 */
export function formatarReal(valor: number): string {
  const v = Number.isFinite(valor) ? valor : 0
  const centavos = Math.round(Math.abs(v) * 100)
  const inteiro = Math.floor(centavos / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const decimal = String(centavos % 100).padStart(2, '0')
  return `${v < 0 && centavos !== 0 ? '-' : ''}R$ ${inteiro},${decimal}`
}
