/**
 * Agente de IA — pedido EM ANDAMENTO guardado pelo servidor (12/10/2026, teste do Felipe 19:36). Puro.
 *
 * O servidor pergunta o que falta, UMA coisa por mensagem e nesta ordem: complementos obrigatórios → extras pagos →
 * entrega ou retirada → endereço → pagamento → troco. Os textos das perguntas são do servidor (formato fixo, sem número
 * na frente). As respostas simples ("1 234", "1,2,3,4", "todos", nomes, "nenhuma", "retirada", "pix", "troco pra 50",
 * "fica quanto?") são entendidas AQUI, sem IA; mínimo/máximo de cada grupo é conferido aqui (a IA aceitava 3 num grupo de
 * mínimo 4). O que não for entendido (endereço, mudança, dúvida) vai para a IA, que anota pelo montar_pedido.
 */
import { brl, emojiDoItem, linhaComplemento } from '@/lib/mensageria/formato'
import { maximoDoGrupo, minimoDoGrupo } from '@/lib/opcoes-item'
import type { FormaPagamento } from '@/lib/queries/pedidos'
import type { CardapioIa, GrupoIa, ItemIa } from './cardapio'
import type { Carrinho, EnderecoCarrinho } from './pedido'

export const RASCUNHO_VALIDADE_MS = 2 * 3600_000

export interface LinhaRascunho {
  itemId: string
  quantidade: number
  /** Escolhas por grupo (nome do grupo → nomes das opções): "banana" pode estar em dois grupos. */
  escolhas: Record<string, string[]>
  /** Grupos já respondidos (inclusive "nenhuma" nos extras). */
  respondidos: string[]
  observacao?: string
  tamanho?: string
  sabores?: string[]
  borda?: string
  massa?: string
}
export interface Rascunho {
  /** Última alteração. */
  em: string
  itens: LinhaRascunho[]
  tipo?: 'entrega' | 'retirada'
  endereco?: EnderecoCarrinho | null
  pagamento?: FormaPagamento
  trocoPara?: number | null
  trocoRespondido?: boolean
}
export interface OpcoesLoja { aceitaEntrega: boolean; aceitaRetirada: boolean; pix: boolean }

export type Pergunta =
  | { campo: 'grupo'; linha: number; grupo: string; texto: string; textoEmSeguida: string }
  | { campo: 'tipo' | 'endereco' | 'pagamento' | 'troco'; texto: string; textoEmSeguida: string }

export const novoRascunho = (em: string): Rascunho => ({ em, itens: [] })

/** Vale por 2 h e só se foi mexido depois do último pedido criado na conversa. */
export function rascunhoValido(r: Rascunho | null | undefined, agora: number, iaPedidoEm: string | null): r is Rascunho {
  if (!r?.em || !Array.isArray(r.itens) || !r.itens.length) return false
  const em = Date.parse(r.em)
  return agora - em < RASCUNHO_VALIDADE_MS && (!iaPedidoEm || em > Date.parse(iaPedidoEm))
}

const norm = (s: string) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const centavos = (v: number) => Math.round(v * 100) / 100

// ── Entender a resposta do cliente ────────────────────────────────────────────────────────────────────────────────

const NENHUM = /^(nenhum|nenhuma|nada|nao|n|sem|dispenso|so isso)\b/
const TODOS = /\b(todos|todas|tudo)\b/
const OS_N = /\b(?:os|as) (\d{1,2})\b/
const ENCHIMENTO = new Set(['e', 'com', 'quero', 'queria', 'vou', 'querer', 'os', 'as', 'o', 'a', 'mais', 'tambem', 'pode', 'ser', 'por', 'favor', 'so', 'isso',
  'de', 'do', 'da', 'pra', 'para', 'me', 've', 'manda', 'opcao', 'opcoes', 'numero', 'numeros', 'eu', 'escolho', 'ok', 'entao', 'um', 'uma', 'n', 'no', 'na'])

/**
 * Posições (0-based) das opções escolhidas, "nenhum", ou null quando não é uma escolha (vai para a IA). Números contam a
 * posição na lista mostrada: com menos de 10 opções, "1 234" e "1234" são 1, 2, 3 e 4.
 */
export function interpretarEscolhas(texto: string, nomes: string[]): number[] | 'nenhum' | null {
  const t = norm(texto)
  if (!t) return null
  if (NENHUM.test(t)) return 'nenhum'
  const osN = OS_N.exec(t)
  if (TODOS.test(t) || (osN && Number(osN[1]) === nomes.length)) return nomes.map((_, i) => i)
  const idx = new Set<number>()
  let resto = ` ${t} `
  const ordem = nomes.map((n, i) => ({ i, n: norm(n) })).filter((x) => x.n).sort((a, b) => b.n.length - a.n.length)
  for (const { i, n } of ordem) {
    for (const v of [n, `${n}s`, n.endsWith('s') ? n.slice(0, -1) : '']) {
      if (v && resto.includes(` ${v} `)) { idx.add(i); resto = resto.replace(` ${v} `, ' '); break }
    }
  }
  for (const tok of resto.split(' ').filter(Boolean)) {
    if (/^\d+$/.test(tok)) {
      const nums = nomes.length < 10 ? [...tok].map(Number) : [Number(tok)]
      for (const n of nums) { if (n < 1 || n > nomes.length) return null; idx.add(n - 1) }
    } else if (!ENCHIMENTO.has(tok)) return null
  }
  return idx.size ? [...idx].sort((a, b) => a - b) : null
}

const VALOR = /\b(fica quanto|quanto fica|quanto (deu|da|ficou|vai dar|vai ficar|sai|saiu|esta|ta)|qual (e )?(o )?(valor|total)|valor total|total fica|ta quanto|esta quanto)\b/
/** "Fica quanto?", "quanto deu?", "qual o total?" (não "quanto custa o X?"). */
export function perguntaValor(texto: string): boolean {
  const t = norm(texto)
  return t.length <= 60 && VALOR.test(t)
}

function tipoDoTexto(t: string): 'entrega' | 'retirada' | null {
  const n = norm(t)
  const ent = /\b(entrega|entregar|entreguem|delivery)\b/.test(n)
  const ret = /\b(retirada|retirar|retiro|buscar|busco|balcao|pegar|pego|vou ai|passo ai)\b/.test(n)
  return ent === ret ? null : ent ? 'entrega' : 'retirada'
}

function pagamentoDoTexto(t: string, pix: boolean): FormaPagamento | null {
  const n = norm(t)
  const achados = ([['pix', /\bpix\b/], ['dinheiro', /\b(dinheiro|especie|cash)\b/], ['cartao', /\b(cartao|credito|debito|maquininha|maquina)\b/]] as const)
    .filter(([, re]) => re.test(n)).map(([f]) => f)
  if (achados.length !== 1 || (achados[0] === 'pix' && !pix)) return null
  return achados[0]
}

function trocoDoTexto(t: string): { trocoPara: number | null } | null {
  const n = norm(t)
  const v = /(\d+(?:[.,]\d{1,2})?)/.exec((t ?? '').replace(/r\$\s*/i, ''))
  if (v && Number(v[1].replace(',', '.')) > 0) return { trocoPara: centavos(Number(v[1].replace(',', '.'))) }
  if (/\b(sem troco|nao precis\w*|nao vou precisar|trocado|certinho|exato)\b/.test(n) || /^(nao|n|nao obrigad[oa])$/.test(n)) return { trocoPara: null }
  return null
}

// ── Grupos e textos ───────────────────────────────────────────────────────────────────────────────────────────────

function regras(g: GrupoIa) {
  const opcoes = g.opcoes.filter((o) => !o.pausado)
  return {
    opcoes,
    min: minimoDoGrupo({ obrigatorio: g.obrigatorio, minEscolhas: g.min }),
    max: maximoDoGrupo({ maxEscolhas: g.max, opcoes: opcoes.map((o) => o.nome) }),
  }
}
const itemDe = (c: CardapioIa, id: string) => c.itens.find((i) => i.id === id)
const opcoesEmLinhas = (ops: { nome: string; preco: number }[], comPreco: boolean) => ops.map((o) => linhaComplemento(o.nome, comPreco ? o.preco : 0)).join('\n')

function textoObrigatorio(item: ItemIa, g: GrupoIa, min: number, max: number): string {
  const nome = g.nome.toLowerCase()
  const frase = min === max ? (min === 1 ? `Escolha 1 opção de ${nome}` : `Escolha ${min} opções de ${nome}`) : `Escolha de ${min} a ${max} opções de ${nome}`
  const e = emojiDoItem(item.nome)
  return `*${item.nome}* \`${brl(item.preco)}\`${e ? ` ${e}` : ''}\n${frase} (obrigatório):\n\n${opcoesEmLinhas(regras(g).opcoes, true)}\n\n_Pode responder com os nomes._`
}

function textoExtras(g: GrupoIa, max: number): string {
  const ops = regras(g).opcoes
  const precos = new Set(ops.map((o) => o.preco))
  const comum = precos.size === 1 && ops[0].preco > 0 ? ops[0].preco : null
  return `Quer adicionar ${g.nome.toLowerCase()}? (${comum ? `\`+${brl(comum)}\` cada, ` : ''}até ${max})\n\n${opcoesEmLinhas(ops, comum === null)}\n\n_Se não quiser, é só dizer "nenhuma"._`
}

function linhaDoItem(l: LinhaRascunho, item: ItemIa): string {
  const nomes = item.grupos.flatMap((g) => l.escolhas[g.nome] ?? [])
  return `*${l.quantidade > 1 ? `${l.quantidade}x ` : ''}${item.nome}*${nomes.length ? ` com ${nomes.map((n) => `\`${cap(n)}\``).join(' ')}` : ''}`
}

const TEXTO_TIPO = 'Beleza!\nVai ser `Entrega` ou `Retirada no balcão`?'
const TEXTO_TIPO_EM_SEGUIDA = 'Agora, vai ser `Entrega` ou `Retirada no balcão`?'
const TEXTO_ENDERECO = 'Me passa o endereço de entrega: rua, número e bairro 📍'
const TEXTO_TROCO = 'Precisa de troco para quanto? Se não precisar, é só dizer "sem troco".'
const textoPagamento = (tipo: 'entrega' | 'retirada', pix: boolean) =>
  ['Como prefere pagar?', ...(pix ? ['💠 Pix'] : []), '💵 Dinheiro', `💳 Cartão na ${tipo === 'retirada' ? 'retirada' : 'entrega'}`].join('\n')

export function tipoEfetivo(r: Rascunho, loja: OpcoesLoja): 'entrega' | 'retirada' | undefined {
  if (r.tipo) return r.tipo
  if (loja.aceitaEntrega && !loja.aceitaRetirada) return 'entrega'
  if (!loja.aceitaEntrega && loja.aceitaRetirada) return 'retirada'
  return undefined
}

const enderecoOk = (e?: EnderecoCarrinho | null) => !!(e?.rua && e.numero && e.bairro)

/** A próxima pergunta (uma só), ou null quando o pedido está completo. */
export function proximaPergunta(r: Rascunho, cardapio: CardapioIa, loja: OpcoesLoja): Pergunta | null {
  if (!r.itens.length) return null
  for (let i = 0; i < r.itens.length; i++) {
    const l = r.itens[i]
    const item = itemDe(cardapio, l.itemId)
    if (!item) continue
    for (const extras of [false, true]) {
      for (const g of item.grupos) {
        if (l.respondidos.includes(g.nome)) continue
        const { opcoes, min, max } = regras(g)
        if (!opcoes.length || max < 1) continue
        if (!extras && min > 0) { const t = textoObrigatorio(item, g, min, max); return { campo: 'grupo', linha: i, grupo: g.nome, texto: t, textoEmSeguida: t } }
        if (extras && min === 0 && opcoes.some((o) => o.preco > 0)) { const t = textoExtras(g, max); return { campo: 'grupo', linha: i, grupo: g.nome, texto: t, textoEmSeguida: t } }
      }
    }
  }
  const tipo = tipoEfetivo(r, loja)
  if (!tipo) return { campo: 'tipo', texto: TEXTO_TIPO, textoEmSeguida: TEXTO_TIPO_EM_SEGUIDA }
  if (tipo === 'entrega' && !enderecoOk(r.endereco)) return { campo: 'endereco', texto: TEXTO_ENDERECO, textoEmSeguida: TEXTO_ENDERECO }
  if (!r.pagamento) { const t = textoPagamento(tipo, loja.pix); return { campo: 'pagamento', texto: t, textoEmSeguida: t } }
  if (r.pagamento === 'dinheiro' && (r.trocoPara === null || r.trocoPara === undefined) && !r.trocoRespondido) return { campo: 'troco', texto: TEXTO_TROCO, textoEmSeguida: TEXTO_TROCO }
  return null
}

/** Valor do que já foi escolhido (itens + complementos, sem taxa), com os preços do cardápio. */
export function valorParcial(r: Rascunho, cardapio: CardapioIa): number {
  let total = 0
  for (const l of r.itens) {
    const item = itemDe(cardapio, l.itemId)
    if (!item) continue
    let unit = l.tamanho ? (item.tamanhos.find((t) => norm(t.nome) === norm(l.tamanho!))?.preco ?? item.preco) : item.preco
    for (const g of item.grupos) for (const n of l.escolhas[g.nome] ?? []) unit += g.opcoes.find((o) => norm(o.nome) === norm(n))?.preco ?? 0
    total += unit * l.quantidade
  }
  return centavos(total)
}

interface Aplicado { rascunho: Rascunho; anotado?: string; aviso?: string }

function aplicarResposta(r0: Rascunho, p: Pergunta, texto: string, cardapio: CardapioIa, loja: OpcoesLoja): Aplicado | null {
  const r: Rascunho = structuredClone(r0)
  if (p.campo === 'grupo') {
    const l = r.itens[p.linha]
    const item = itemDe(cardapio, l.itemId)
    const g = item?.grupos.find((x) => x.nome === p.grupo)
    if (!item || !g) return null
    const { opcoes, min, max } = regras(g)
    const sel = interpretarEscolhas(texto, opcoes.map((o) => o.nome))
    if (sel === null) return null
    const antes = l.escolhas[g.nome] ?? []
    const faltou = (escolhidas: string[]) => {
      const restantes = opcoes.filter((o) => !escolhidas.includes(o.nome))
      return `Faltou escolher mais ${min - escolhidas.length} 😉\n\n${opcoesEmLinhas(restantes, true)}`
    }
    if (sel === 'nenhum') {
      if (min > 0) return { rascunho: r, aviso: faltou(antes) }
      l.escolhas[g.nome] = []
      l.respondidos.push(g.nome)
      return { rascunho: r, anotado: `Anotado ✍️:\n${linhaDoItem(l, item)}` }
    }
    const uniao = opcoes.map((o) => o.nome).filter((n, i) => antes.includes(n) || sel.includes(i))
    if (uniao.length > max) { l.escolhas[g.nome] = []; return { rascunho: r, aviso: `Aqui dá para escolher até ${max} 😉\n\nQuais você quer?` } }
    l.escolhas[g.nome] = uniao
    if (uniao.length < min) return { rascunho: r, aviso: faltou(uniao) }
    l.respondidos.push(g.nome)
    return { rascunho: r, anotado: `Anotado ✍️:\n${linhaDoItem(l, item)}` }
  }
  if (p.campo === 'tipo') { const t = tipoDoTexto(texto); if (!t) return null; r.tipo = t; return { rascunho: r } }
  if (p.campo === 'pagamento') {
    const f = pagamentoDoTexto(texto, loja.pix)
    if (!f) return null
    r.pagamento = f
    if (f !== 'dinheiro') { r.trocoPara = null; r.trocoRespondido = false }
    return { rascunho: r }
  }
  if (p.campo === 'troco') { const t = trocoDoTexto(texto); if (!t) return null; r.trocoPara = t.trocoPara; r.trocoRespondido = true; return { rascunho: r } }
  return null // endereço: a IA entende e anota
}

/**
 * Respostas do cliente desde a última mensagem da loja (várias mensagens seguidas = uma resposta só). null = algo não foi
 * entendido: a IA responde (com o pedido em andamento no contexto).
 */
export function responderPeloRascunho(r: Rascunho, textos: string[], cardapio: CardapioIa, loja: OpcoesLoja): { rascunho: Rascunho; mensagens: string[]; completo: boolean } | null {
  let atual = r
  let pergunta = proximaPergunta(atual, cardapio, loja)
  if (!pergunta) return null
  let anotado: string | undefined
  let aviso: string | undefined
  let valor = false
  let entendeu = false
  for (const t of textos.map((x) => (x ?? '').trim()).filter(Boolean)) {
    if (perguntaValor(t)) { valor = true; entendeu = true; continue }
    if (!pergunta) return null
    const a = aplicarResposta(atual, pergunta, t, cardapio, loja)
    if (!a) return null
    entendeu = true
    atual = a.rascunho
    if (a.anotado) { anotado = a.anotado; aviso = undefined }
    if (a.aviso) aviso = a.aviso
    pergunta = proximaPergunta(atual, cardapio, loja)
  }
  if (!entendeu) return null
  atual = { ...atual, em: new Date().toISOString() }
  const mensagens: string[] = []
  const blocos: string[] = []
  if (anotado) blocos.push(anotado)
  if (valor) blocos.push(`Até agora fica \`${brl(valorParcial(atual, cardapio))}\` (sem a taxa de entrega).`)
  if (aviso) blocos.push(aviso)
  else if (pergunta) {
    // Lista de opções vai numa mensagem só dela (extras = "outra mensagem").
    if (pergunta.campo === 'grupo') { if (blocos.length) mensagens.push(blocos.splice(0).join('\n\n')); blocos.push(pergunta.texto) }
    else blocos.push(blocos.length ? pergunta.textoEmSeguida : pergunta.texto)
  }
  if (blocos.length) mensagens.push(blocos.join('\n\n'))
  return { rascunho: atual, mensagens, completo: !pergunta }
}

// ── A IA anota (montar_pedido parcial) ────────────────────────────────────────────────────────────────────────────

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const ID = /^[0-9a-f-]{36}$/i
const lista = (v: unknown) => (Array.isArray(v) ? v.slice(0, 20).map((s) => txt(s, 80)).filter(Boolean) : [])

/** Distribui os nomes que a IA mandou nos grupos do item (repetido vai para o grupo seguinte). */
function distribuir(item: ItemIa, nomes: string[]): { ok: true; escolhas: Record<string, string[]>; respondidos: string[] } | { ok: false; erro: string } {
  const escolhas: Record<string, string[]> = {}
  for (const nome of nomes) {
    const n = norm(nome)
    let posto = false
    let existe = false
    for (const g of item.grupos) {
      const { opcoes, max } = regras(g)
      const o = opcoes.find((x) => { const k = norm(x.nome); return k === n || `${k}s` === n || k === `${n}s` })
      if (!o) continue
      existe = true
      const atual = escolhas[g.nome] ?? []
      if (atual.includes(o.nome) || atual.length >= max) continue
      escolhas[g.nome] = [...atual, o.nome]
      posto = true
      break
    }
    if (!existe) return { ok: false, erro: `A opção "${nome}" não existe em ${item.nome} (use só as opções que consultar_cardapio devolveu).` }
    if (!posto) return { ok: false, erro: `Opções demais em ${item.nome}: "${nome}" passa do máximo.` }
  }
  const respondidos = item.grupos.filter((g) => { const c = (escolhas[g.nome] ?? []).length; const { min, max } = regras(g); return c > 0 && c >= min && c <= max }).map((g) => g.nome)
  return { ok: true, escolhas, respondidos }
}

/**
 * Junta ao pedido em andamento o que a IA mandou no montar_pedido. `itens`, quando vem, é a lista COMPLETA (cada item
 * guarda as escolhas já feitas se a IA não mandar complementos). O resto (tipo, endereço, pagamento, troco) só muda se veio.
 */
export function mesclarDoIa(r: Rascunho | null, bruto: unknown, cardapio: CardapioIa, agoraIso: string): { ok: true; rascunho: Rascunho } | { ok: false; erro: string } {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const base: Rascunho = r ? structuredClone(r) : novoRascunho(agoraIso)
  if (Array.isArray(b.itens) && b.itens.length) {
    const novas: LinhaRascunho[] = []
    for (const x of b.itens.slice(0, 20)) {
      const i = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
      const itemId = txt(i.item_id ?? i.itemId, 40)
      if (!ID.test(itemId)) return { ok: false, erro: 'Item sem item_id válido (use o id de consultar_cardapio).' }
      const item = itemDe(cardapio, itemId)
      if (!item) return { ok: false, erro: 'Esse item não está no cardápio agora.' }
      const quantidade = Math.floor(Number(i.quantidade ?? 1))
      if (!Number.isFinite(quantidade) || quantidade < 1 || quantidade > 50) return { ok: false, erro: 'Quantidade deve ser de 1 a 50.' }
      const anterior = base.itens.find((l) => l.itemId === itemId)
      const linha: LinhaRascunho = anterior ? { ...anterior, quantidade } : { itemId, quantidade, escolhas: {}, respondidos: [] }
      const comps = lista(i.complementos)
      if (comps.length) {
        const d = distribuir(item, comps)
        if (!d.ok) return d
        linha.escolhas = d.escolhas
        linha.respondidos = d.respondidos
      }
      const obs = txt(i.observacao, 140); if (obs) linha.observacao = obs
      const tam = txt(i.tamanho, 80); if (tam) linha.tamanho = tam
      const sab = lista(i.sabores); if (sab.length) linha.sabores = sab
      const borda = txt(i.borda, 80); if (borda) linha.borda = borda
      const massa = txt(i.massa, 80); if (massa) linha.massa = massa
      novas.push(linha)
    }
    base.itens = novas
  }
  if (b.tipo === 'entrega' || b.tipo === 'retirada') base.tipo = b.tipo
  if (b.endereco && typeof b.endereco === 'object') {
    const e = b.endereco as Record<string, unknown>
    const end: EnderecoCarrinho = { rua: txt(e.rua, 120), numero: txt(e.numero, 20), complemento: txt(e.complemento, 80), bairro: txt(e.bairro, 80), referencia: txt(e.referencia, 120), cep: txt(e.cep, 9).replace(/\D/g, '') }
    if (enderecoOk(end)) base.endereco = end
  }
  if (b.pagamento === 'pix' || b.pagamento === 'dinheiro' || b.pagamento === 'cartao') {
    base.pagamento = b.pagamento
    if (b.pagamento !== 'dinheiro') { base.trocoPara = null; base.trocoRespondido = false }
  }
  const troco = Number(b.troco_para ?? b.trocoPara)
  if (base.pagamento === 'dinheiro' && Number.isFinite(troco) && troco > 0) { base.trocoPara = centavos(troco); base.trocoRespondido = true }
  if (b.sem_troco === true) { base.trocoPara = null; base.trocoRespondido = true }
  base.em = agoraIso
  return { ok: true, rascunho: base }
}

/** Pedido completo → carrinho do montar (complementos na ordem dos grupos). null = ainda falta algo. */
export function rascunhoParaCarrinho(r: Rascunho, cardapio: CardapioIa, loja: OpcoesLoja, nomeCliente: string): Carrinho | null {
  const tipo = tipoEfetivo(r, loja)
  if (!r.itens.length || !tipo || !r.pagamento || (tipo === 'entrega' && !enderecoOk(r.endereco))) return null
  return {
    itens: r.itens.map((l) => {
      const item = itemDe(cardapio, l.itemId)
      const complementos = item ? item.grupos.flatMap((g) => l.escolhas[g.nome] ?? []) : Object.values(l.escolhas).flat()
      return {
        itemId: l.itemId, quantidade: l.quantidade, observacao: l.observacao ?? '', complementos,
        ...(l.tamanho ? { tamanho: l.tamanho } : {}), ...(l.sabores?.length ? { sabores: l.sabores } : {}), ...(l.borda ? { borda: l.borda } : {}), ...(l.massa ? { massa: l.massa } : {}),
      }
    }),
    tipo,
    endereco: tipo === 'entrega' ? r.endereco ?? null : null,
    pagamento: r.pagamento,
    trocoPara: r.pagamento === 'dinheiro' ? r.trocoPara ?? null : null,
    nomeCliente,
  }
}

/** Uma linha para a IA saber o que já está anotado (bloco que muda do prompt). */
export function descreverRascunho(r: Rascunho, cardapio: CardapioIa, loja: OpcoesLoja): string {
  const itens = r.itens.map((l) => { const it = itemDe(cardapio, l.itemId); return it ? linhaDoItem(l, it).replace(/[*`]/g, '') : '' }).filter(Boolean).join('; ')
  const tipo = tipoEfetivo(r, loja)
  const p = proximaPergunta(r, cardapio, loja)
  return [
    `PEDIDO EM ANDAMENTO (guardado pelo sistema): ${itens}`,
    tipo ? (tipo === 'entrega' ? `entrega${enderecoOk(r.endereco) ? ` em ${r.endereco!.rua}, ${r.endereco!.numero} — ${r.endereco!.bairro}` : ''}` : 'retirada') : '',
    r.pagamento ? `pagamento: ${r.pagamento}` : '',
    `valor até agora: ${brl(valorParcial(r, cardapio))} (sem taxa)`,
    p ? `o sistema está esperando: ${p.campo === 'grupo' ? `opções de ${p.grupo}` : p.campo}` : 'tudo escolhido',
  ].filter(Boolean).join(' · ')
}
