/**
 * Iniciais do avatar na central de atendimento: a primeira LETRA (ou número) de até duas
 * palavras do nome do contato. Ignora emoji e símbolos — `p[0]` pegava meia letra de um
 * emoji ("L.S 🌟" virava "L�"). Sem letra nenhuma, os 2 últimos dígitos do telefone.
 */
export function iniciais(nome: string | null | undefined, telefone: string): string {
  const letras = (nome ?? '')
    .trim()
    .split(/\s+/)
    .map((p) => p.match(/[\p{L}\p{N}]/u)?.[0])
    .filter((l): l is string => !!l)
    .slice(0, 2)
    .map((l) => l.toLocaleUpperCase('pt-BR'))
    .join('')
  return letras || telefone.slice(-2)
}
