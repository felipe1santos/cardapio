/**
 * Regras PURAS da edição de pedido (18/10/2026): o que muda, quanto fica, o que acontece com o pagamento online, e o
 * HISTÓRICO ESTRUTURADO das alterações (Bloco A, 19/10): a observação do cliente fica intocada no banco; cada edição
 * grava quando, quem, origem e a lista `alteracoes` (tipo + valores de/para). O bloco "PEDIDO ALTERADO (hh:mm)" da
 * comanda é gerado desse histórico NA HORA DE IMPRIMIR (payload do Assistente — layout intocado). Sem rede, sem banco.
 */
export interface ItemAtual {
  id: string
  nome: string
  precoUnitario: number
  quantidade: number
  observacao: string
  tamanhoNome?: string
}

export interface ItemNovoPrecificado {
  nome: string
  precoUnitario: number
  quantidade: number
  tamanhoNome?: string
}

export interface MudancasItens {
  remover?: string[]
  quantidade?: { itemId: string; quantidade: number }[]
  observacao?: { itemId: string; observacao: string }[]
}

/** Uma alteração do pedido, estruturada (o que o card, o painel, o KDS e a comanda mostram). */
export type AlteracaoPedido =
  | { tipo: 'item_removido'; itemId: string; nome: string; quantidade: number }
  | { tipo: 'item_adicionado'; itemId?: string; nome: string; quantidade: number }
  | { tipo: 'item_quantidade'; itemId: string; nome: string; de: number; para: number }
  | { tipo: 'item_observacao'; itemId: string; nome: string; de: string; para: string }
  | { tipo: 'endereco'; de: string; para: string }
  | { tipo: 'taxa'; de: number; para: number }
  | { tipo: 'cupom'; de: string; para: null }
  | { tipo: 'pagamento'; de: string; para: string }
  | { tipo: 'troco'; de: number; para: null }
  | { tipo: 'diferenca'; para: number }
  | { tipo: 'estorno'; para: number }

/** Uma edição gravada em `pedidos.edicoes` (append-only). `alteracoes` falta nas edições anteriores a 19/10. */
export interface EdicaoRegistro {
  em: string
  por: string
  /** painel = loja; solicitacao = o cliente pediu pelo WhatsApp (via robô ou IA) e a loja aplicou; ia = o Agente aplicou. */
  origem: 'painel' | 'solicitacao' | 'ia' | string
  via?: 'robo' | 'ia' | null
  mudancas: string[]
  alteracoes?: AlteracaoPedido[]
}

const c2 = (v: number) => Math.round(v * 100) / 100
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const nomeDoItem = (i: { nome: string; tamanhoNome?: string }) => `${i.nome}${i.tamanhoNome ? ` ${i.tamanhoNome}` : ''}`

/**
 * Aplica as mudanças aos itens atuais (fora os já cancelados). Devolve o estado final, o subtotal, o texto de cada
 * mudança ("−1× Coca 2L", "+2× X-Tudo", "X-Tudo: 2× → 1×", "X-Tudo: obs. sem cebola") e a mesma lista estruturada
 * (`alteracoes`, na mesma ordem). Lança em pedido vazio.
 */
export function aplicarMudancasItens(atuais: ItemAtual[], mudancas: MudancasItens, novos: ItemNovoPrecificado[]) {
  const remover = new Set(mudancas.remover ?? [])
  const qtd = new Map((mudancas.quantidade ?? []).map((q) => [q.itemId, q.quantidade]))
  const obs = new Map((mudancas.observacao ?? []).map((o) => [o.itemId, o.observacao]))
  const textos: string[] = []
  const alteracoes: AlteracaoPedido[] = []
  const cancelar: string[] = []
  const atualizar: { id: string; quantidade?: number; observacao?: string }[] = []
  const finais: { precoUnitario: number; quantidade: number }[] = []

  for (const i of atuais) {
    const nome = nomeDoItem(i)
    if (remover.has(i.id)) { cancelar.push(i.id); textos.push(`−${i.quantidade}× ${nome}`); alteracoes.push({ tipo: 'item_removido', itemId: i.id, nome, quantidade: i.quantidade }); continue }
    let quantidade = i.quantidade
    const patch: { id: string; quantidade?: number; observacao?: string } = { id: i.id }
    if (qtd.has(i.id)) {
      const q = Math.floor(qtd.get(i.id)!)
      if (!Number.isFinite(q) || q < 0 || q > 999) throw new Error('Quantidade por item deve ser de 0 a 999.')
      if (q === 0) { cancelar.push(i.id); textos.push(`−${i.quantidade}× ${nome}`); alteracoes.push({ tipo: 'item_removido', itemId: i.id, nome, quantidade: i.quantidade }); continue }
      if (q !== i.quantidade) { patch.quantidade = q; textos.push(`${nome}: ${i.quantidade}× → ${q}×`); alteracoes.push({ tipo: 'item_quantidade', itemId: i.id, nome, de: i.quantidade, para: q }); quantidade = q }
    }
    if (obs.has(i.id)) {
      const o = (obs.get(i.id) ?? '').trim().slice(0, 300)
      const antes = (i.observacao ?? '').trim()
      if (o !== antes) { patch.observacao = o; textos.push(o ? `${nome}: obs. "${o}"` : `${nome}: obs. removida`); alteracoes.push({ tipo: 'item_observacao', itemId: i.id, nome, de: antes, para: o }) }
    }
    if (patch.quantidade !== undefined || patch.observacao !== undefined) atualizar.push(patch)
    finais.push({ precoUnitario: i.precoUnitario, quantidade })
  }
  for (const n of novos) {
    if (!Number.isFinite(n.quantidade) || n.quantidade < 1 || n.quantidade > 999) throw new Error('Quantidade por item deve ser de 1 a 999.')
    textos.push(`+${n.quantidade}× ${nomeDoItem(n)}`)
    alteracoes.push({ tipo: 'item_adicionado', nome: nomeDoItem(n), quantidade: n.quantidade })
    finais.push({ precoUnitario: n.precoUnitario, quantidade: n.quantidade })
  }
  if (finais.length === 0) throw new Error('O pedido não pode ficar sem itens. Para desistir, cancele o pedido.')
  const subtotal = c2(finais.reduce((s, f) => s + f.precoUnitario * f.quantidade, 0))
  return { cancelar, atualizar, subtotal, textos, alteracoes }
}

/** Total = subtotal + taxa − desconto (nunca negativo). */
export function totalDoPedido(subtotal: number, taxaEntrega: number, desconto: number): number {
  return Math.max(0, c2(subtotal + taxaEntrega - desconto))
}

/**
 * Troco depois da edição: se o cliente ia pagar com "troco para X" e o total passou de X, o troco não vale mais —
 * zera e avisa. Devolve o novo trocoPara e o texto da mudança (ou null).
 */
export function ajustarTroco(formaPagamento: string, pago: boolean, trocoPara: number | null, totalNovo: number): { trocoPara: number | null; texto: string | null } {
  if (formaPagamento !== 'dinheiro' || pago || trocoPara === null) return { trocoPara, texto: null }
  if (trocoPara < totalNovo) return { trocoPara: null, texto: `Troco p/ ${brl(trocoPara)} removido (total passou para ${brl(totalNovo)})` }
  return { trocoPara, texto: null }
}

export type EscolhaPagoOnline = 'estorno_parcial' | 'diferenca_entrega' | 'diferenca_pix'
export type DecisaoPagoOnline =
  | { ok: true; acao: 'nada' }
  | { ok: true; acao: 'estorno_parcial'; valor: number }
  | { ok: true; acao: 'diferenca_entrega'; valor: number }
  /** Fase 3 (19/10): Pix só da diferença pelo Mercado Pago da loja, enviado ao cliente pelo WhatsApp. */
  | { ok: true; acao: 'diferenca_pix'; valor: number }
  | { ok: false; texto: string; precisa: EscolhaPagoOnline }

/**
 * Pago online (Pix/cartão pelo Mercado Pago) e o total mudou (decisão do dono, 18/10): diminuiu → estorno PARCIAL da
 * diferença, só com a escolha explícita; aumentou → só com "receber a diferença na entrega". Sem escolha, bloqueia.
 * Total igual → nada. Pedido não pago online → nada.
 */
export function decisaoPagoOnline(p: { pago: boolean; pagamentoOnline: boolean; totalAntigo: number; totalNovo: number; escolha?: EscolhaPagoOnline | null; jaAReceber?: number | null }): DecisaoPagoOnline {
  if (!(p.pago && p.pagamentoOnline)) return { ok: true, acao: 'nada' }
  // O que já estava "a receber na entrega" de uma edição anterior entra na conta do que o cliente pagou de fato.
  const pagoDeFato = c2(p.totalAntigo - (p.jaAReceber ?? 0))
  const delta = c2(p.totalNovo - pagoDeFato)
  if (Math.abs(delta) < 0.005) return { ok: true, acao: 'nada' }
  if (delta < 0) {
    if (p.escolha === 'estorno_parcial') return { ok: true, acao: 'estorno_parcial', valor: c2(-delta) }
    return { ok: false, precisa: 'estorno_parcial', texto: `O cliente já pagou ${brl(pagoDeFato)} online e o novo total é ${brl(p.totalNovo)}. Para salvar, confirme o estorno de ${brl(-delta)} pelo Mercado Pago.` }
  }
  if (p.escolha === 'diferenca_entrega') return { ok: true, acao: 'diferenca_entrega', valor: delta }
  if (p.escolha === 'diferenca_pix') return { ok: true, acao: 'diferenca_pix', valor: delta }
  return { ok: false, precisa: 'diferenca_entrega', texto: `O cliente já pagou ${brl(pagoDeFato)} online e o novo total é ${brl(p.totalNovo)}. Para salvar, escolha como receber a diferença de ${brl(delta)}: Pix pelo WhatsApp ou na entrega.` }
}

/** Hora local (São Paulo) hh:mm para o bloco. */
export function horaSP(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/** Texto CURTO de uma alteração — o que cabe na comanda e no KDS ("− 1× fsd", "+ 1× coca lata", "novo endereço"). */
export function textoCurto(a: AlteracaoPedido): string {
  switch (a.tipo) {
    case 'item_removido': return `− ${a.quantidade}× ${a.nome}`
    case 'item_adicionado': return `+ ${a.quantidade}× ${a.nome}`
    case 'item_quantidade': return `${a.nome} ${a.de}×→${a.para}×`
    case 'item_observacao': return a.para ? `${a.nome}: obs. "${a.para}"` : `${a.nome}: obs. removida`
    case 'endereco': return 'novo endereço'
    case 'taxa': return `taxa ${brl(a.para)}`
    case 'cupom': return `cupom ${a.de} removido`
    case 'pagamento': return `pagamento ${a.para}`
    case 'troco': return 'sem troco'
    case 'diferenca': return `+ ${brl(a.para)} na entrega`
    case 'estorno': return `estorno ${brl(a.para)}`
  }
}

/** Resumo curto de UMA edição: as alterações estruturadas; edição antiga (sem `alteracoes`) usa os textos. */
export function resumoCurtoDaEdicao(e: EdicaoRegistro): string {
  const partes = e.alteracoes?.length ? e.alteracoes.map(textoCurto) : e.mudancas
  return partes.join(' · ')
}

/** Resumo curto da ÚLTIMA edição (faixa do KDS). Vazio sem edição. */
export function resumoCurto(edicoes: EdicaoRegistro[] | null | undefined): string {
  const ultima = (edicoes ?? []).filter((e) => (e.alteracoes?.length ?? 0) > 0 || e.mudancas.length > 0).at(-1)
  return ultima ? resumoCurtoDaEdicao(ultima) : ''
}

/**
 * Observação que vai no PAYLOAD da comanda (lib/queries/impressao.ts): o bloco "PEDIDO ALTERADO (hh:mm): …" curto, as
 * 3 edições mais recentes primeiro, e a observação do cliente (intocada no banco) por último. O layout do Assistente
 * só imprime "Obs. do pedido: …" — nada muda nele.
 */
export function observacaoParaImpressao(observacaoCliente: string | null | undefined, edicoes: EdicaoRegistro[] | null | undefined): string {
  const blocos = (edicoes ?? []).filter((e) => (e.alteracoes?.length ?? 0) > 0 || e.mudancas.length > 0).slice(-3).reverse()
    .map((e) => `PEDIDO ALTERADO (${horaSP(new Date(e.em))}): ${resumoCurtoDaEdicao(e)}`)
  const orig = (observacaoCliente ?? '').trim()
  return [...blocos, orig].filter(Boolean).join(' | ').slice(0, 1000)
}

/** Ids dos itens que entraram por edição (fundo amarelo + "adicionado" no card e no painel). */
export function itensAdicionados(edicoes: EdicaoRegistro[] | null | undefined): Set<string> {
  const ids = new Set<string>()
  for (const e of edicoes ?? []) for (const a of e.alteracoes ?? []) if (a.tipo === 'item_adicionado' && a.itemId) ids.add(a.itemId)
  return ids
}

/** A alteração mais recente de um campo (endereço, taxa, cupom, pagamento, troco) — para mostrar o valor antigo riscado. */
export function ultimaAlteracao<T extends AlteracaoPedido['tipo']>(edicoes: EdicaoRegistro[] | null | undefined, tipo: T): Extract<AlteracaoPedido, { tipo: T }> | null {
  for (const e of [...(edicoes ?? [])].reverse()) {
    for (const a of [...(e.alteracoes ?? [])].reverse()) if (a.tipo === tipo) return a as Extract<AlteracaoPedido, { tipo: T }>
  }
  return null
}

/** "pela loja" · "pelo cliente (robô)" · "pelo cliente (IA)" · "pelo Agente de IA". */
export function rotuloOrigemEdicao(e: Pick<EdicaoRegistro, 'origem' | 'via'>): string {
  if (e.origem === 'solicitacao') return e.via === 'robo' ? 'pelo cliente (robô)' : e.via === 'ia' ? 'pelo cliente (IA)' : 'pelo cliente'
  if (e.origem === 'ia') return 'pelo Agente de IA'
  return 'pela loja'
}

/** Texto do WhatsApp ao cliente. */
export function textoClienteAlterado(numero: number, mudancas: string[], total: number, diferencaAReceber?: number | null): string {
  const linhas = [`*✏️ Pedido #${numero} alterado*`, '', ...mudancas.map((m) => `• ${m}`), '', `Novo total: *${brl(total)}*`]
  if (diferencaAReceber && diferencaAReceber > 0) linhas.push(`Diferença a pagar na entrega: *${brl(diferencaAReceber)}*`)
  return linhas.join('\n')
}
