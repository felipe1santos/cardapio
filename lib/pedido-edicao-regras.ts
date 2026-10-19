/**
 * Regras PURAS da edição de pedido (18/10/2026): o que muda, quanto fica, o que acontece com o pagamento online, e o
 * bloco "PEDIDO ALTERADO" que vai na observação (a comanda do Alfa 1 e o KDS já mostram a observação — sem mexer no
 * Assistente). Sem rede, sem banco. Dinheiro em centavos inteiros onde a conta importa.
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

const c2 = (v: number) => Math.round(v * 100) / 100
const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`
const nomeDoItem = (i: { nome: string; tamanhoNome?: string }) => `${i.nome}${i.tamanhoNome ? ` ${i.tamanhoNome}` : ''}`

/**
 * Aplica as mudanças aos itens atuais (fora os já cancelados). Devolve o estado final, o subtotal e o texto de cada
 * mudança ("−1× Coca 2L", "+2× X-Tudo", "X-Tudo: 2× → 1×", "X-Tudo: obs. sem cebola"). Lança em pedido vazio.
 */
export function aplicarMudancasItens(atuais: ItemAtual[], mudancas: MudancasItens, novos: ItemNovoPrecificado[]) {
  const remover = new Set(mudancas.remover ?? [])
  const qtd = new Map((mudancas.quantidade ?? []).map((q) => [q.itemId, q.quantidade]))
  const obs = new Map((mudancas.observacao ?? []).map((o) => [o.itemId, o.observacao]))
  const textos: string[] = []
  const cancelar: string[] = []
  const atualizar: { id: string; quantidade?: number; observacao?: string }[] = []
  const finais: { precoUnitario: number; quantidade: number }[] = []

  for (const i of atuais) {
    if (remover.has(i.id)) { cancelar.push(i.id); textos.push(`−${i.quantidade}× ${nomeDoItem(i)}`); continue }
    let quantidade = i.quantidade
    const patch: { id: string; quantidade?: number; observacao?: string } = { id: i.id }
    if (qtd.has(i.id)) {
      const q = Math.floor(qtd.get(i.id)!)
      if (!Number.isFinite(q) || q < 0 || q > 999) throw new Error('Quantidade por item deve ser de 0 a 999.')
      if (q === 0) { cancelar.push(i.id); textos.push(`−${i.quantidade}× ${nomeDoItem(i)}`); continue }
      if (q !== i.quantidade) { patch.quantidade = q; textos.push(`${nomeDoItem(i)}: ${i.quantidade}× → ${q}×`); quantidade = q }
    }
    if (obs.has(i.id)) {
      const o = (obs.get(i.id) ?? '').trim().slice(0, 300)
      if (o !== (i.observacao ?? '').trim()) { patch.observacao = o; textos.push(o ? `${nomeDoItem(i)}: obs. "${o}"` : `${nomeDoItem(i)}: obs. removida`) }
    }
    if (patch.quantidade !== undefined || patch.observacao !== undefined) atualizar.push(patch)
    finais.push({ precoUnitario: i.precoUnitario, quantidade })
  }
  for (const n of novos) {
    if (!Number.isFinite(n.quantidade) || n.quantidade < 1 || n.quantidade > 999) throw new Error('Quantidade por item deve ser de 1 a 999.')
    textos.push(`+${n.quantidade}× ${nomeDoItem(n)}`)
    finais.push({ precoUnitario: n.precoUnitario, quantidade: n.quantidade })
  }
  if (finais.length === 0) throw new Error('O pedido não pode ficar sem itens. Para desistir, cancele o pedido.')
  const subtotal = c2(finais.reduce((s, f) => s + f.precoUnitario * f.quantidade, 0))
  return { cancelar, atualizar, subtotal, textos }
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

export type EscolhaPagoOnline = 'estorno_parcial' | 'diferenca_entrega'
export type DecisaoPagoOnline =
  | { ok: true; acao: 'nada' }
  | { ok: true; acao: 'estorno_parcial'; valor: number }
  | { ok: true; acao: 'diferenca_entrega'; valor: number }
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
  return { ok: false, precisa: 'diferenca_entrega', texto: `O cliente já pagou ${brl(pagoDeFato)} online e o novo total é ${brl(p.totalNovo)}. Para salvar, marque "receber ${brl(delta)} na entrega".` }
}

/** Hora local (São Paulo) hh:mm para o bloco. */
export function horaSP(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}

/**
 * Observação do pedido com o bloco "PEDIDO ALTERADO (hh:mm): …" na frente da observação ORIGINAL do cliente. O bloco é
 * regerado a cada edição (todas as mudanças do dia, da mais recente para a mais antiga), para a comanda e o KDS mostrarem
 * o estado atual sem acumular lixo.
 */
export function montarObservacao(observacaoOriginal: string, edicoes: { em: string; mudancas: string[] }[]): string {
  const blocos = edicoes.filter((e) => e.mudancas.length > 0).slice(-3).reverse()
    .map((e) => `PEDIDO ALTERADO (${horaSP(new Date(e.em))}): ${e.mudancas.join(' · ')}`)
  const orig = observacaoOriginal.trim()
  return [...blocos, orig].filter(Boolean).join(' | ').slice(0, 1000)
}

/** Texto do WhatsApp ao cliente. */
export function textoClienteAlterado(numero: number, mudancas: string[], total: number, diferencaAReceber?: number | null): string {
  const linhas = [`*✏️ Pedido #${numero} alterado*`, '', ...mudancas.map((m) => `• ${m}`), '', `Novo total: *${brl(total)}*`]
  if (diferencaAReceber && diferencaAReceber > 0) linhas.push(`Diferença a pagar na entrega: *${brl(diferencaAReceber)}*`)
  return linhas.join('\n')
}
