/**
 * Fila por loja para as SAÍDAS da gaveta (sangria, retirada, despesa, perda, conta/compra paga com o
 * caixa). Conferir "há dinheiro na gaveta?" e gravar são dois passos: sem a fila, duas sangrias ao
 * mesmo tempo passavam juntas pela conferência e a gaveta ficava negativa (auditoria 09/10: duas de
 * R$ 125,99 com R$ 209,99 → −R$ 41,99). Com a fila, a segunda só confere depois que a primeira gravou.
 *
 * Vale dentro de UM processo — o app roda numa instância só (Coolify). Se um dia rodar em várias, a
 * conferência precisa ir para dentro da transação do banco (fin_lancar_grupo).
 */
const filas = new Map<string, Promise<void>>()

export async function naFilaDaGaveta<T>(loja: string, fn: () => Promise<T>): Promise<T> {
  const anterior = filas.get(loja) ?? Promise.resolve()
  let soltar!: () => void
  const minha = new Promise<void>((r) => { soltar = r })
  const cauda = anterior.then(() => minha)
  filas.set(loja, cauda)
  await anterior
  try {
    return await fn()
  } finally {
    soltar()
    if (filas.get(loja) === cauda) filas.delete(loja)
  }
}
