/**
 * Nome repetido em catálogo de tamanhos, bordas, massas e sabores.
 *
 * O pedido casa essas coisas PELO NOME (lib/queries/pedidos.ts). Duas "Grande"
 * na mesma loja fariam o servidor pegar a primeira que achasse. A 0097 criou
 * índices únicos em `lower(btrim(nome))`; esta chave é a mesma, para que a tela
 * recuse exatamente o que o banco recusaria — e com uma frase legível.
 */

export function chaveNomeCatalogo(nome: string): string {
  return nome.trim().toLowerCase()
}

export function nomeRepetidoNoCatalogo(
  existentes: readonly { id: string; nome: string }[],
  nome: string,
  ignorarId?: string,
): boolean {
  const alvo = chaveNomeCatalogo(nome)
  return existentes.some((e) => e.id !== ignorarId && chaveNomeCatalogo(e.nome) === alvo)
}

/** Erro que a tela mostra como está: já vem em português, pronto para o dono ler. */
export class ErroCadastroCardapio extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroCadastroCardapio'
  }
}

/** 23505 = unique_violation. Chega aqui quando duas abas gravam o mesmo nome ao mesmo tempo. */
export function ehViolacaoDeUnicidade(erro: unknown): boolean {
  return typeof erro === 'object' && erro !== null && (erro as { code?: unknown }).code === '23505'
}

/**
 * Frase para qualquer falha de gravação do cardápio. Nunca devolve vazio: a tela
 * mostra isto em vez de engolir o erro, que era o que acontecia antes.
 */
export function mensagemErroCardapio(erro: unknown, padrao = 'Não foi possível salvar. Tente de novo.'): string {
  if (erro instanceof ErroCadastroCardapio) return erro.message
  if (ehViolacaoDeUnicidade(erro)) return 'Já existe um cadastro com esse nome. Use outro nome.'
  const codigo = typeof erro === 'object' && erro !== null ? (erro as { code?: unknown }).code : undefined
  // 42501 = sem permissão (RLS/grant): só dono e gerente mexem nos catálogos da loja.
  if (codigo === '42501') return 'Sem permissão para alterar isto. Peça ao dono ou gerente da loja.'
  if (erro instanceof Error && erro.message && !/^[a-z_]+$/.test(erro.message) && erro.name === 'Error') return erro.message
  return padrao
}
