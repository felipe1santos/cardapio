/**
 * Dinheiro do módulo financeiro em CENTAVOS inteiros (nunca ponto flutuante).
 *
 * As tabelas antigas guardam reais em `numeric(10,2)`; a conversão para o livro-caixa passa
 * SEMPRE por aqui (e, no banco, por `round(valor * 100)`), num ponto só.
 */

/** Reais (número ou texto "1.234,56" / "1234.56") → centavos inteiros. Inválido → null. */
export function paraCentavos(valor: number | string | null | undefined): number | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return null
    // Pelo texto com 6 casas (1.005 → "1.005000"): arredonda meio para cima sem o erro do
    // ponto flutuante (1.005 * 100 = 100.4999…).
    const neg = valor < 0
    const [int, dec] = Math.abs(valor).toFixed(6).split('.')
    let c = Number(int) * 100 + Number(dec.slice(0, 2))
    if (Number(dec[2]) >= 5) c += 1
    if (!Number.isSafeInteger(c)) return null
    return neg ? -c : c
  }
  let s = valor.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  if (!s) return null
  const negativo = s.startsWith('-')
  if (negativo) s = s.slice(1)
  // "1.234,56" (pt-BR) ou "1234.56" / "1234,5"
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [inteiro, dec = ''] = s.split('.')
  const c = Number(inteiro) * 100 + Number((dec + '00').slice(0, 2))
  if (!Number.isSafeInteger(c)) return null
  return negativo ? -c : c
}

/** Centavos → texto "R$ 1.234,56" (com sinal quando negativo). */
export function formatarCentavos(c: number): string {
  const neg = c < 0
  const abs = Math.abs(Math.trunc(c))
  const reais = Math.floor(abs / 100).toLocaleString('pt-BR')
  const cent = String(abs % 100).padStart(2, '0')
  return `${neg ? '−' : ''}R$ ${reais},${cent}`
}

/** Centavos → reais (para comparar com as colunas antigas em numeric). */
export const paraReais = (c: number) => c / 100

/** Soma segura de centavos (inteiros). */
export const somar = (valores: number[]) => valores.reduce((s, v) => s + Math.trunc(v), 0)
