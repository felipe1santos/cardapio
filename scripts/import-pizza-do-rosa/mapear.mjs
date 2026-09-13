import fs from 'fs'
import path from 'path'

const NOME_TAMANHO = { 'Pizza Pequena': 'Pequena', 'Pizza Média': 'Média', 'Pizza Grande': 'Grande', 'Pizza Gigante': 'Gigante' }
const ID_TAMANHO_GRANDE = '15'
const PRECO_BORDA = 19

const num = (v) => Math.round(Number(v) * 100) / 100

function tamanhos(origem) {
  const base = origem.tamanhosPizza.map((t, i) => ({
    nome: NOME_TAMANHO[t.nome] ?? t.nome,
    fatias: parseInt(t.fatias, 10) || 0,
    maxSabores: t.maxSabores,
    posicao: i,
  }))
  return [...base, { nome: 'Brotinho', fatias: 4, maxSabores: 1, posicao: base.length }]
}

function presets(origem) {
  const rotulo = {
    pizza: 'Adicionais de Pizza',
    hamburguers: 'Adicionais de Hambúrguer',
    massas: 'Adicionais de Massa',
    porcoes: 'Adicionais de Porção',
    saladas: 'Adicionais de Salada',
  }
  const saida = []
  for (const s of origem.sessoes) {
    const nome = rotulo[s.link]
    if (!nome || !s.api?.adicionais?.length) continue
    const itens = s.api.adicionais.map((a, i) => {
      const precos = a.precoPorTamanho
      const bruto = s.link === 'pizza' ? precos[ID_TAMANHO_GRANDE] : Object.values(precos)[0]
      return { nome: a.nome, preco: num(bruto ?? 0), posicao: i }
    })
    saida.push({ nome, obrigatorio: false, minEscolhas: 0, maxEscolhas: itens.length, itens })
  }
  return saida
}

function saborDeItem(item, precosApi, i) {
  return {
    nome: item.nome,
    descricao: item.descricao,
    imagemOrigem: item.imagem,
    posicao: i,
    precos: precosApi,
  }
}

function itemPizza(nome, itens, precosPor, tag = null) {
  const sabores = itens.map((it, i) => saborDeItem(it, precosPor(it), i))
  // O card da vitrine mostra `item.preco` (não há ramo de pizza em `ProductCard`),
  // então deixar 0 aqui faria a home anunciar "Pizza Salgada — R$ 0,00". O menor
  // preço de sabor no tamanho mais barato que o item de fato precifica é o
  // valor "a partir de".
  const precos = sabores.flatMap((s) => s.precos.map((p) => p.preco)).filter((p) => p > 0)
  return {
    nome,
    descricao: '',
    preco: precos.length > 0 ? Math.min(...precos) : 0,
    imagemOrigem: itens[0]?.imagem ?? null,
    tipoItem: 'pizza',
    tag,
    presets: ['Adicionais de Pizza'],
    sabores,
  }
}

function itemSimples(item, presetsDoGrupo) {
  return {
    nome: item.nome,
    descricao: item.descricao,
    preco: num(item.preco),
    imagemOrigem: item.imagem,
    tipoItem: 'simples',
    tag: null,
    presets: presetsDoGrupo,
  }
}

export function mapear(origem) {
  const porLink = Object.fromEntries(origem.sessoes.map((s) => [s.link, s]))
  const grupos = []
  let pos = 0
  const add = (nome, itens) => { grupos.push({ nome, posicao: pos++, itens }) }

  // ── Pizzas salgadas e doces ──────────────────────────────────────────────
  const pizza = porLink['pizza']
  const precoPizza = (it) => {
    const linhas = pizza.api.precosPorItem[it.nome] ?? []
    return linhas
      .filter((l) => NOME_TAMANHO[l.sizeName])
      .map((l) => ({ tamanho: NOME_TAMANHO[l.sizeName], preco: num(l.price) }))
  }
  add('Pizzas Salgadas', [itemPizza('Pizza Salgada', pizza.itens.filter((i) => i.subcategoria === 'Tradicionais'), precoPizza)])
  add('Pizzas Doces', [itemPizza('Pizza Doce', pizza.itens.filter((i) => i.subcategoria === 'Doces'), precoPizza)])

  // ── Promocional: só Gigante ──────────────────────────────────────────────
  // Um preço só, no tamanho Gigante (spec 4.2 #3) — a vitrine filtra tamanhos
  // sem preço (spec 3, decisão #4), então os demais tamanhos da loja somem
  // sozinhos pra esse item.
  const promo = porLink['pizza-promocional']
  add('Pizza Promocional', [itemPizza('Pizza Promocional', promo.itens, (it) => [{ tamanho: 'Gigante', preco: num(it.preco) }], 'promocao')])

  // ── Brotinho: só Brotinho ────────────────────────────────────────────────
  // Mesma lógica da Promocional acima (spec 4.2 #4 + spec 3, decisão #4),
  // mas com o tamanho "Brotinho" — que nem existe na origem (ver tamanhos()).
  const brot = porLink['pizza-brotinho']
  add('Pizza Brotinho', [itemPizza('Pizza Brotinho', brot.itens, (it) => [{ tamanho: 'Brotinho', preco: num(it.preco) }])])

  // ── Simples ──────────────────────────────────────────────────────────────
  const simples = [
    ['Hambúrguers', 'hamburguers', ['Hambúrguers'], ['Adicionais de Hambúrguer']],
    ['Pizza Burguer', 'hamburguers', ['Pizza Burguer'], ['Adicionais de Hambúrguer']],
    ['Porções', 'porcoes', null, ['Adicionais de Porção']],
    ['Massas', 'massas', null, ['Adicionais de Massa']],
    ['Saladas', 'saladas', null, ['Adicionais de Salada']],
    ['Sobremesas', 'sobremesas', null, []],
    ['Bebidas', 'bebidas', ['Refrigerante', 'Suco', 'Água'], []],
    ['Cervejas e Vinhos', 'bebidas', ['Cerveja', 'vinho'], []],
    ['Molhos', 'molhos', null, []],
    ['Congelados', 'congelados', null, []],
    ['Loja Virtual', 'loja-virtual', null, []],
  ]
  for (const [nomeGrupo, link, subcats, presetsDoGrupo] of simples) {
    const itens = porLink[link].itens
      .filter((i) => !subcats || subcats.includes(i.subcategoria))
      .map((i) => itemSimples(i, presetsDoGrupo))
    add(nomeGrupo, itens)
  }

  return {
    tamanhosPizza: tamanhos(origem),
    bordas: origem.bordas.map((b, i) => ({ nome: b.nome, preco: PRECO_BORDA, posicao: i })),
    presets: presets(origem),
    grupos,
  }
}

if (process.argv[1] === import.meta.filename) {
  const dir = path.join(import.meta.dirname, 'dados')
  const origem = JSON.parse(fs.readFileSync(path.join(dir, 'cardapio-origem.json'), 'utf8'))
  const plano = mapear(origem)
  fs.writeFileSync(path.join(dir, 'cardapio-menuzia.json'), JSON.stringify(plano, null, 2))
  console.log('grupos', plano.grupos.length, '| itens', plano.grupos.flatMap((g) => g.itens).length, '| sabores', plano.grupos.flatMap((g) => g.itens).flatMap((i) => i.sabores ?? []).length, '| presets', plano.presets.length)
}
