/** Siglas que ficam em caixa alta mesmo num endereço todo maiúsculo. */
const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
  'KM', 'CEP', 'BR',
])

/** Palavras que ficam minúsculas no meio de um endereço ("Rua das Flores"). */
const CONECTORES = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas'])

/**
 * Deixa um texto livre apresentável na vitrine: "RUA DAS FLORES, 10" e
 * "rua das flores, 10" viram "Rua das Flores, 10".
 *
 * O lojista e o cliente digitam endereço como dá — tudo maiúsculo, tudo
 * minúsculo, misturado. Consertar na escrita não resolve (o dado que já está
 * gravado continua torto), então a normalização acontece na exibição.
 */
export function capitalizarTexto(texto: string | null | undefined): string {
  if (!texto) return ''

  // Endereço inteiro em caixa alta não permite adivinhar sigla ("DAS" não é
  // sigla); aí só as UFs ficam de pé.
  const tudoMaiusculo = texto === texto.toLocaleUpperCase('pt-BR')

  let primeiraPalavra = true
  return texto.replace(/[\p{L}][\p{L}'’]*/gu, (palavra) => {
    // Sigla escrita em caixa alta (MG, ES, KM) continua como está —
    // "Santos Dumont - Mg" fica pior do que o original.
    const caixaAlta = palavra === palavra.toLocaleUpperCase('pt-BR')
    const sigla = caixaAlta && (UFS.has(palavra) || (!tudoMaiusculo && palavra.length <= 3 && !CONECTORES.has(palavra.toLocaleLowerCase('pt-BR'))))
    if (sigla) {
      primeiraPalavra = false
      return palavra
    }

    const minuscula = palavra.toLocaleLowerCase('pt-BR')
    const manterMinusculo = !primeiraPalavra && CONECTORES.has(minuscula)
    primeiraPalavra = false
    return manterMinusculo ? minuscula : minuscula.charAt(0).toLocaleUpperCase('pt-BR') + minuscula.slice(1)
  })
}
