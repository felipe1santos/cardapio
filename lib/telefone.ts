/**
 * Máscara de telefone brasileiro para os campos da vitrine.
 *
 * O servidor normaliza o número antes de gravar (ver `normalizarTelefone` em
 * lib/queries/clientes.ts), então a máscara existe só pra leitura: digitar 11
 * dígitos crus num campo de checkout é onde o cliente erra e desiste.
 */
export function mascararTelefoneBR(valor: string): string {
  // Cola de WhatsApp costuma vir com o DDI: "+55 27 99999-9999".
  const digitos = valor.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '').slice(0, 11)

  if (digitos.length === 0) return ''
  if (digitos.length <= 2) return `(${digitos}`

  const ddd = digitos.slice(0, 2)
  const resto = digitos.slice(2)
  if (resto.length <= 4) return `(${ddd}) ${resto}`

  // Celular (9 dígitos) quebra em 5+4; fixo (8 dígitos) em 4+4.
  const corte = resto.length > 8 ? 5 : 4
  return `(${ddd}) ${resto.slice(0, corte)}-${resto.slice(corte)}`
}

/** true quando o número tem DDD + 8 (fixo) ou 9 (celular) dígitos. */
export function telefoneCompleto(valor: string): boolean {
  const digitos = valor.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')
  return digitos.length === 10 || digitos.length === 11
}
