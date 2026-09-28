// ─────────────────────────────────────────────────────────────────────────────
// VALORES POR LINHA dos documentos do Assistente Beta (comanda e pré-conta).
//
// O preço unitário que o servidor manda JÁ INCLUI os adicionais. Para a coluna de valor:
//   · linha do item   = (preço unitário − adicionais) × quantidade
//   · cada adicional  = preço do adicional × vezes escolhido × quantidade do item
// Assim a soma da coluna é o subtotal. Contas em centavos (sem erro de arredondamento).
// Se os adicionais não couberem no preço (dado antigo), o item leva o total da linha e os
// adicionais saem sem valor — a soma continua certa.
// ─────────────────────────────────────────────────────────────────────────────

const centavos = (v) => Math.round((Number(v) || 0) * 100)

/** "1.234,56" (sem R$). */
function numero(c) {
  const n = (Number(c) || 0) / 100
  return n.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/**
 * @param {number} quantidade
 * @param {number} precoUnitario  com os adicionais
 * @param {{nome: string, preco: number}[]} complementos  um por escolha (repetido = mais de uma vez)
 * @returns {{ item: number, adicionais: { nome: string, vezes: number, valor: number }[] }} valores em centavos
 */
function valoresDoItem(quantidade, precoUnitario, complementos) {
  const qtd = Math.max(1, Number(quantidade) || 1)
  const agrupados = new Map()
  for (const c of Array.isArray(complementos) ? complementos : []) {
    const nome = String(c?.nome ?? '').trim()
    if (!nome) continue
    const cur = agrupados.get(nome) || { nome, vezes: 0, unit: centavos(c.preco) }
    cur.vezes += 1
    agrupados.set(nome, cur)
  }
  const adicionais = [...agrupados.values()].map((c) => ({ nome: c.nome, vezes: c.vezes, valor: c.unit * c.vezes * qtd }))
  const somaUnit = [...agrupados.values()].reduce((s, c) => s + c.unit * c.vezes, 0)
  const base = centavos(precoUnitario) - somaUnit
  if (base < 0) return { item: centavos(precoUnitario) * qtd, adicionais: adicionais.map((a) => ({ ...a, valor: 0 })) }
  return { item: base * qtd, adicionais }
}

module.exports = { valoresDoItem, numero, centavos }
