/**
 * Login do motoboy por NOME (item 61): "João da Silva", "joão  da silva" e "JOAO DA SILVA" são o
 * mesmo nome. Também gera o usuário técnico do login a partir do nome ("joao.da.silva").
 */
export function nomeComparavel(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function usuarioDoNome(nome: string): string {
  return nomeComparavel(nome).replace(/ /g, '.').slice(0, 30) || 'motoboy'
}
