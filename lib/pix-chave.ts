/** Tipos de chave Pix do Perfil da loja (0205). O robô e a IA leem `restaurantes.pix_chave/pix_chave_tipo`. */
export const TIPOS_PIX = [
  { valor: 'cpf', rotulo: 'CPF' }, { valor: 'cnpj', rotulo: 'CNPJ' }, { valor: 'telefone', rotulo: 'Telefone' },
  { valor: 'email', rotulo: 'E-mail' }, { valor: 'aleatoria', rotulo: 'Chave aleatória' },
] as const
export type TipoPix = (typeof TIPOS_PIX)[number]['valor']
export const PIX_CHAVE_MAX = 140
export function tipoPixValido(t: string): t is TipoPix { return TIPOS_PIX.some((x) => x.valor === t) }
