/**
 * Número de celular brasileiro no formato que o WhatsApp entende: DDI + DDD +
 * número, só dígitos.
 *
 * A regra antiga era "se começa com 55, já tem DDI; senão, põe 55 na frente".
 * Ela erra de dois jeitos, os dois vistos em produção:
 *
 *  - **DDD 55 (Santa Maria/RS e região).** `(55) 99999-8888` tem 11 dígitos e
 *    começa com 55, então o número saía sem DDI — `55999998888` vira, para o
 *    WhatsApp, o DDI 55 com DDD 99. O cliente do RS nunca recebia o código de
 *    confirmação nem o aviso do pedido.
 *  - **Sem teto de tamanho.** Um dígito a mais na digitação passava direto:
 *    havia três clientes gravados com 14 dígitos (`55279950921011`). O aviso ia
 *    para um número que não existe, e o cliente nunca mais entrava na conta
 *    dele, porque o telefone que ele digita não bate com o que foi gravado.
 *
 * Aqui quem decide é o COMPRIMENTO, não o prefixo:
 *
 *   10 ou 11 dígitos  → número local (DDD + 8 ou 9). Ganha o 55 na frente.
 *   12 ou 13 dígitos  → já veio com o DDI 55. Fica como está.
 *   qualquer outro    → não é telefone brasileiro: `null`.
 */

/** Só os dígitos, sem máscara, parênteses, traço ou espaço. */
export function soDigitos(valor: string): string {
  return (valor ?? '').replace(/\D/g, '')
}

export function telefoneWhatsapp(valor: string): string | null {
  const d = soDigitos(valor)
  if (d.length === 10 || d.length === 11) return `55${d}`
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d
  return null
}

/** true quando o número dá para mandar mensagem. Usado pelo checkout e pelo cadastro. */
export function telefoneBrValido(valor: string): boolean {
  return telefoneWhatsapp(valor) !== null
}

/**
 * O que dizer ao cliente quando o número não passa. Fala do que ele digitou —
 * "faltam dígitos" e "sobram dígitos" são erros diferentes na cabeça de quem
 * está com o dedo no teclado.
 */
export const TELEFONE_INVALIDO = 'Telefone inválido. Use DDD + número, como (27) 99999-8888.'

export function motivoTelefoneInvalido(valor: string): string | null {
  const d = soDigitos(valor)
  if (telefoneWhatsapp(valor)) return null
  if (d.length < 10) return 'Faltam dígitos no telefone. Use DDD + número, como (27) 99999-8888.'
  if (d.length > 13) return 'Esse telefone tem dígitos demais. Use DDD + número, como (27) 99999-8888.'
  return TELEFONE_INVALIDO
}

/**
 * Telefone de um pedido novo, pela origem.
 *
 * No cardápio o telefone é obrigatório: é por ele que a loja fala com o cliente
 * e que ele volta à conta. No PDV e no salão ele é OPCIONAL — venda de balcão e
 * mesa não têm telefone, e as duas rotas mandam `telefone: ''`. A varredura de
 * 2026-09-22 passou a exigir telefone de todo pedido e travou o PDV e o
 * lançamento do garçom inteiros; aqui o PDV só é cobrado se digitou algum
 * número. `origem` é decidida pelo servidor (a rota pública recusa o campo).
 */
export function motivoTelefoneDoPedido(telefone: string, origem: 'cardapio' | 'pdv' | undefined): string | null {
  if (origem === 'pdv' && !soDigitos(telefone)) return null
  return motivoTelefoneInvalido(telefone)
}
