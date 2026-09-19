import { describe, it, expect } from 'vitest'
import type { GrupoCardapio, ItemCardapio } from '@/lib/queries/cardapio'
import {
  adicionarAoLancamento,
  bloqueioDoEnvio,
  buscarItens,
  categoriaAtivaValida,
  categoriasComItens,
  itemSimples,
  itensLancaveis,
  resolverDaSelecao,
  resumoIndisponibilidade,
  temObrigatorio,
  totalDoLancamento,
  type LinhaLancamento,
  type LinhaSelecao,
  type Relogio,
} from './garcom-catalogo'

// Cenário real da Menuzia em 2026-09-18 às 15h: Gourmet fora do horário (11:40–14:00),
// Sobremesa com tudo pausado, Bebidas disponível.
const grupo = (id: string, nome: string, posicao: number, janela?: [string, string]): GrupoCardapio =>
  ({ id, nome, posicao, horarioAtivoInicio: janela?.[0] ?? null, horarioAtivoFim: janela?.[1] ?? null } as GrupoCardapio)

const item = (id: string, nome: string, grupoId: string | null, extra: Partial<ItemCardapio> = {}): ItemCardapio =>
  ({
    id, grupoId, nome, descricao: '', preco: 10, imagemUrl: null, imagemThumbUrl: null, status: 'disponivel',
    diasDisponiveis: [0, 1, 2, 3, 4, 5, 6], promocaoPreco: null, maisVendido: false, tag: null, tipoItem: 'simples',
    disponivelDelivery: true, disponivelSalao: true, grupos: [], complementos: [], tamanhos: [], sabores: [],
    ...extra,
  }) as ItemCardapio

const GOURMET = grupo('g-gourmet', 'Gourmet', 0, ['11:40', '14:00'])
const SOBREMESA = grupo('g-sobremesa', 'Sobremesa', 1)
const BEBIDAS = grupo('g-bebidas', 'Bebidas', 2)
const CATEGORIAS = [GOURMET, SOBREMESA, BEBIDAS]

// 15h: Gourmet fora da janela.
const AS_15H: Relogio = {
  disponivelHoje: (d) => d.includes(5),
  categoriaAtiva: (g) => !g.horarioAtivoInicio,
}

const PONTO = {
  id: 'gp', nome: 'Ponto da carne', obrigatorio: true, minEscolhas: 1, maxEscolhas: 1, posicao: 0, permiteQuantidade: false,
  complementos: [
    { id: 'c1', nome: 'Ao ponto', preco: 0, presetOrigemId: null, imagemUrl: null, pausado: false },
    { id: 'c2', nome: 'Bem passado', preco: 0, presetOrigemId: null, imagemUrl: null, pausado: false },
  ],
}
const ADICIONAL = {
  id: 'ga', nome: 'Adicionais', obrigatorio: false, minEscolhas: 0, maxEscolhas: 3, posicao: 1, permiteQuantidade: false,
  complementos: [{ id: 'c3', nome: 'Bacon', preco: 4, presetOrigemId: null, imagemUrl: null, pausado: false }],
}

const SMASH = item('i-smash', 'Smash', 'g-gourmet', { preco: 29 })
const BOLO = item('i-bolo', 'Bolo', 'g-sobremesa', { status: 'pausado' })
const COCA = item('i-coca', 'Coca Lata 350ml', 'g-bebidas', { preco: 7.5 })
const COCA15 = item('i-coca15', 'Coca 1,5L', 'g-bebidas', { preco: 14, descricao: 'garrafa gelada' })
const SEMCAT = item('i-x', 'Xtudo', null)
const TODOS = [SMASH, BOLO, COCA, COCA15, SEMCAT]

describe('categorias do garçom', () => {
  const lancaveis = itensLancaveis(TODOS, CATEGORIAS, AS_15H)
  const disponiveis = categoriasComItens(CATEGORIAS, lancaveis)

  it('1. Gourmet fora do horário e Bebidas disponível → abre Bebidas', () => {
    expect(categoriaAtivaValida(null, disponiveis)).toBe('g-bebidas')
    expect(lancaveis.map((i) => i.nome).sort()).toEqual(['Coca 1,5L', 'Coca Lata 350ml'])
  })

  it('2. categoria com tudo pausado (e a fora do horário) não aparece como chip', () => {
    expect(disponiveis.map((g) => g.nome)).toEqual(['Bebidas'])
  })

  it('3. só uma categoria disponível → abre essa, mesmo que a atual fosse outra', () => {
    expect(categoriaAtivaValida('g-gourmet', disponiveis)).toBe('g-bebidas')
  })

  it('3b. categoria atual ainda válida continua aberta', () => {
    const almoco: Relogio = { ...AS_15H, categoriaAtiva: () => true }
    const d = categoriasComItens(CATEGORIAS, itensLancaveis(TODOS, CATEGORIAS, almoco))
    expect(categoriaAtivaValida('g-bebidas', d)).toBe('g-bebidas')
    expect(categoriaAtivaValida(null, d)).toBe('g-gourmet')
  })

  it('4. nenhuma categoria disponível → nada aberto, e a tela sabe explicar por quê', () => {
    const nada = itensLancaveis([SMASH, BOLO, SEMCAT], CATEGORIAS, AS_15H)
    expect(categoriasComItens(CATEGORIAS, nada)).toEqual([])
    expect(categoriaAtivaValida(null, [])).toBeNull()
    expect(resumoIndisponibilidade([SMASH, BOLO, SEMCAT], CATEGORIAS, AS_15H)).toEqual({
      pausados: 1, foraDoHorario: 1, foraDoDia: 0, semCategoria: 1,
    })
  })

  it('5. busca encontra em todas as categorias disponíveis, ignora acento e maiúscula', () => {
    expect(buscarItens(lancaveis, 'coca').length).toBe(2)
    expect(buscarItens(lancaveis, 'GELADA').map((i) => i.nome)).toEqual(['Coca 1,5L'])
    expect(buscarItens(lancaveis, 'smash')).toEqual([]) // fora do horário não volta pela busca
  })

  it('item fora do salão, do dia ou sem categoria nunca é lançável', () => {
    const soDelivery = item('i-d', 'Só delivery', 'g-bebidas', { disponivelSalao: false })
    const domingo = item('i-dom', 'Domingo', 'g-bebidas', { diasDisponiveis: [0] })
    expect(itensLancaveis([soDelivery, domingo, SEMCAT], CATEGORIAS, AS_15H)).toEqual([])
  })
})

describe('produto no lançamento', () => {
  it('6. produto simples entra com um toque', () => {
    expect(itemSimples(COCA)).toBe(true)
  })

  it('7. produto com obrigatório abre o configurador', () => {
    const burger = item('i-b', 'Burger', 'g-bebidas', { grupos: [PONTO] })
    expect(itemSimples(burger)).toBe(false)
    expect(temObrigatorio(burger)).toBe(true)
    const comTamanho = item('i-t', 'Açaí', 'g-bebidas', { tamanhos: [{ id: 't', nome: '500 ml', preco: 20, posicao: 0 }] })
    expect(itemSimples(comTamanho)).toBe(false)
  })

  it('toques repetidos no mesmo item juntam na mesma linha', () => {
    const l = (): LinhaLancamento => ({ chave: crypto.randomUUID(), itemId: 'i-coca', nome: 'Coca', preco: 7.5, quantidade: 1, observacao: '', complementos: [] })
    const dois = adicionarAoLancamento(adicionarAoLancamento([], l()), l())
    expect(dois).toHaveLength(1)
    expect(dois[0]!.quantidade).toBe(2)
    expect(totalDoLancamento(dois)).toEqual({ itens: 2, total: 15 })
  })
})

describe('seleção do cliente → lançamento, só por ação do garçom', () => {
  const sel = (over: Partial<LinhaSelecao> = {}): LinhaSelecao => ({
    chave: 's1:0', itemId: 'i-coca', nome: 'Coca Lata 350ml', quantidade: 2, precoUnitario: 7.5, observacao: 'gelada', opcoes: [], ...over,
  })

  it('8. item da seleção entra individualmente, com quantidade, observação e origem', () => {
    const r = resolverDaSelecao(sel(), TODOS, CATEGORIAS, AS_15H)
    expect(r.tipo).toBe('pronto')
    if (r.tipo !== 'pronto') return
    expect(r.linha).toMatchObject({ itemId: 'i-coca', quantidade: 2, observacao: 'gelada', preco: 7.5, origemSelecao: 's1:0' })
    expect(r.precoMudou).toBe(false)
  })

  it('9. a seleção inteira entra por ação explícita, uma linha por vez, sem enviar nada', () => {
    const linhas = [sel(), sel({ chave: 's1:1', itemId: 'i-coca15', nome: 'Coca 1,5L', precoUnitario: 14, quantidade: 1, observacao: '' })]
    let lancamento: LinhaLancamento[] = []
    for (const s of linhas) {
      const r = resolverDaSelecao(s, TODOS, CATEGORIAS, AS_15H)
      if (r.tipo === 'pronto') lancamento = adicionarAoLancamento(lancamento, r.linha)
    }
    expect(lancamento.map((l) => l.nome)).toEqual(['Coca Lata 350ml', 'Coca 1,5L'])
    expect(bloqueioDoEnvio(lancamento, false)).toBeNull()
  })

  it('10. item indisponível da seleção não é importado — o motivo aparece', () => {
    const r = resolverDaSelecao(sel({ itemId: 'i-smash', nome: 'Smash' }), TODOS, CATEGORIAS, AS_15H)
    expect(r).toEqual({ tipo: 'indisponivel', motivo: '"Smash" é de uma categoria fora do horário agora.' })
    expect(resolverDaSelecao(sel({ itemId: 'i-bolo', nome: 'Bolo' }), TODOS, CATEGORIAS, AS_15H).tipo).toBe('indisponivel')
    expect(resolverDaSelecao(sel({ itemId: 'apagado', nome: 'Velho' }), TODOS, CATEGORIAS, AS_15H)).toEqual({
      tipo: 'indisponivel', motivo: '"Velho" saiu do cardápio.',
    })
  })

  it('11. preço alterado: usa o do catálogo agora e avisa que mudou', () => {
    const r = resolverDaSelecao(sel({ precoUnitario: 6 }), TODOS, CATEGORIAS, AS_15H)
    expect(r.tipo === 'pronto' && r.linha.preco).toBe(7.5)
    expect(r.tipo === 'pronto' && r.precoMudou).toBe(true)
  })

  it('obrigatório sem resposta ou opção extinta abre o configurador já preenchido', () => {
    const burger = item('i-b', 'Burger', 'g-bebidas', { grupos: [PONTO, ADICIONAL], preco: 30 })
    const semPonto = resolverDaSelecao(
      sel({ itemId: 'i-b', nome: 'Burger', opcoes: [{ grupo: 'Adicionais', escolha: 'Bacon', preco: 4 }] }),
      [burger], CATEGORIAS, AS_15H,
    )
    expect(semPonto.tipo).toBe('configurar')
    if (semPonto.tipo === 'configurar') expect(semPonto.preescolha.complementos?.map((c) => c.nome)).toEqual(['Bacon'])

    const extinta = resolverDaSelecao(
      sel({ itemId: 'i-b', nome: 'Burger', opcoes: [{ grupo: 'Ponto', escolha: 'Mal passado', preco: 0 }] }),
      [burger], CATEGORIAS, AS_15H,
    )
    expect(extinta.tipo === 'configurar' && extinta.motivo).toMatch(/Mal passado/)

    const completo = resolverDaSelecao(
      sel({ itemId: 'i-b', nome: 'Burger', precoUnitario: 30, opcoes: [{ grupo: 'Ponto', escolha: 'Ao ponto', preco: 0 }, { grupo: 'Adicionais', escolha: 'Bacon', preco: 4 }] }),
      [burger], CATEGORIAS, AS_15H,
    )
    expect(completo.tipo === 'pronto' && completo.linha.preco).toBe(34)
  })
})

describe('envio', () => {
  const linha: LinhaLancamento = { chave: 'k', itemId: 'i-coca', nome: 'Coca', preco: 7.5, quantidade: 1, observacao: '', complementos: [] }

  it('12. envio vazio é bloqueado na tela (e o servidor recusa de novo)', () => {
    expect(bloqueioDoEnvio([], false)).toMatch(/pelo menos um item/)
  })

  it('13. envio em andamento bloqueia o segundo clique', () => {
    expect(bloqueioDoEnvio([linha], true)).toBe('Enviando…')
  })

  it('item marcado indisponível pelo servidor trava o envio até ser trocado ou removido', () => {
    expect(bloqueioDoEnvio([{ ...linha, indisponivel: 'saiu' }], false)).toMatch(/indisponível/)
  })
})
