/**
 * Limpeza dos dados do Dashboard geral (item 54, 2026-10-04). Regras puras, testadas em
 * dashboard-limpeza.test.ts. Só decidem o que ENTRA nas análises e como os cliques são agrupados;
 * nenhum número é recalculado de outro jeito.
 */

/** Lojas de teste: nelas os pedidos de teste continuam aparecendo (é para isso que elas existem). */
export const LOJAS_DE_TESTE = new Set(['menuzia'])

/** Telefone de teste/suporte da Menuzia (lib/suporte.ts): pedido feito com ele numa loja real é teste nosso. */
const TELEFONE_TESTE = '27992534407'

const PALAVRA_TESTE = /(^|[^a-zà-ú])test(e|es)?([^a-zà-ú]|$)/i

/** Pedido de TESTE: cliente, observação ou bairro com a palavra "teste", ou feito com o telefone de teste. */
export function ehPedidoDeTeste(p: { clienteNome?: string | null; observacao?: string | null; bairro?: string | null; telefone?: string | null }): boolean {
  if ([p.clienteNome, p.observacao, p.bairro].some((t) => !!t && PALAVRA_TESTE.test(t))) return true
  const tel = (p.telefone ?? '').replace(/\D/g, '')
  return tel.length >= 10 && tel.endsWith(TELEFONE_TESTE)
}

export type TipoClique = 'produto' | 'categoria' | 'promocao' | 'cupom' | 'sacola' | 'pagamento' | 'escolha' | 'navegacao'

export const ROTULO_TIPO_CLIQUE: Record<TipoClique, string> = {
  produto: 'Produto', categoria: 'Categoria', promocao: 'Banner / promoção', cupom: 'Cupom', sacola: 'Sacola',
  pagamento: 'Ir para pagamento', escolha: 'Escolha do produto', navegacao: 'Navegação',
}

/** Os que importam para a loja (o resto vai para "Navegação" ou "Escolha do produto", agrupados). */
export const CLIQUES_QUE_IMPORTAM: ReadonlySet<TipoClique> = new Set(['produto', 'categoria', 'promocao', 'cupom', 'sacola', 'pagamento'])

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase()

const NAVEGACAO = new Set([
  '', 'x', 'fechar', 'voltar', 'home', 'inicio', 'pedidos', 'entrar', 'sair', 'sair mesmo assim', 'continuar no cardapio', 'continuar comprando',
  'ver cardapio', 'informacoes da loja', 'salvar', 'salvar alteracoes', 'calcular', 'calcular taxa de entrega', 'ver lista de bairros atendidos',
  'confirmar codigo', 'continuar', 'ok', 'cancelar', 'perfil', 'menu', 'buscar', 'buscar no cardapio', 'ver mais', 'ver menos', 'avisar a loja no whatsapp',
  'tirar duvidas no whatsapp', 'acompanhar pedido', 'fazer login', 'usar estes dados', 'editar', 'trocar endereco',
])
const PAGAMENTO = /^(continuar para pagamento|revisar pedido|ir para endereco|fazer pedido|finalizar|finalizar pedido|ir para o pagamento|pagar|confirmar pedido|cartao|dinheiro|pix|entrega|retirada)\b/
const SACOLA = /^(\d+ )?ver sacola$|^adicionar\b|^sacola$/
const CUPOM = /cupom|cupons|premio|premios|resgatar|aplicar/
const PROMOCAO = /^promocoes?\b|^promocao\b|banner/

/**
 * Tipo do clique, pelo rótulo gravado na vitrine. `produtos` e `categorias` são os nomes do cardápio da loja:
 * o rótulo de um cartão de produto começa pelo nome dele ("X - BACON Pão, Bife…").
 */
export function classificarClique(alvo: string, nomes: { produtos: string[]; categorias: string[] }): TipoClique {
  const a = norm(alvo)
  if (!a || /^[x+\-−×✕←<>]$/.test(alvo.trim()) || NAVEGACAO.has(a)) return 'navegacao'
  if (PAGAMENTO.test(a)) return 'pagamento'
  if (SACOLA.test(a)) return 'sacola'
  if (CUPOM.test(a)) return 'cupom'
  if (PROMOCAO.test(a)) return 'promocao'
  const cats = nomes.categorias.map(norm).filter(Boolean)
  if (cats.includes(a)) return 'categoria'
  const prods = nomes.produtos.map(norm).filter((p) => p.length >= 3)
  if (prods.some((p) => a === p || a.startsWith(p + ' ') || a.includes(' ' + p + ' ') || a.endsWith(' ' + p))) return 'produto'
  if (/\bgratis\b|^(sim|nao)$/.test(a)) return 'escolha'
  return 'navegacao'
}

export interface Clique { alvo: string; cliques: number; visitantes: number }
export interface CliqueClassificado extends Clique { tipo: TipoClique }

/**
 * Cliques prontos para a tela: os que importam primeiro (os `max` maiores), e a navegação e as escolhas de
 * complemento agrupadas numa linha cada — a soma dos cliques continua a mesma. `todos` traz a lista inteira.
 */
export function organizarCliques(cliques: Clique[], nomes: { produtos: string[]; categorias: string[] }, max = 10) {
  const todos: CliqueClassificado[] = cliques.map((c) => ({ ...c, tipo: classificarClique(c.alvo, nomes) })).sort((a, b) => b.cliques - a.cliques)
  const importantes = todos.filter((c) => CLIQUES_QUE_IMPORTAM.has(c.tipo))
  const agrupar = (tipo: TipoClique) => {
    const g = todos.filter((c) => c.tipo === tipo)
    return g.length ? { tipo, alvos: g.map((c) => c.alvo), cliques: g.reduce((s, c) => s + c.cliques, 0) } : null
  }
  return { principais: importantes.slice(0, max), restantesImportantes: Math.max(0, importantes.length - max), navegacao: agrupar('navegacao'), escolhas: agrupar('escolha'), todos }
}
