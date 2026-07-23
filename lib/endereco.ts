export interface EnderecoPartes {
  rua: string
  numero: string
  complemento: string
  bairro: string
  cidade: string
  estado: string
}

/**
 * Compõe o endereço completo em texto livre a partir dos campos estruturados,
 * ignorando partes vazias (sem vírgula/traço sobrando). Formato:
 * "Rua, Nº - Complemento, Bairro, Cidade - UF".
 */
export function composeEndereco(partes: EnderecoPartes): string {
  const rua = partes.rua.trim()
  const numero = partes.numero.trim()
  const complemento = partes.complemento.trim()
  const bairro = partes.bairro.trim()
  const cidade = partes.cidade.trim()
  const estado = partes.estado.trim()

  const ruaNumero = [rua, numero].filter(Boolean).join(', ')
  const linha1 = [ruaNumero, complemento].filter(Boolean).join(' - ')
  const cidadeUf = [cidade, estado].filter(Boolean).join(' - ')
  const linha2 = [bairro, cidadeUf].filter(Boolean).join(', ')

  return [linha1, linha2].filter(Boolean).join(', ')
}
