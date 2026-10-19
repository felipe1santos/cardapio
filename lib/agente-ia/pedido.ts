/**
 * Agente de IA — o pedido tirado pela conversa (D29–D32 em docs/robo-whatsapp/autoatendimento-decisoes.md).
 *
 *  - montar: a IA manda só ITENS (id do cardápio, quantidade, opções pelo nome) e dados de entrega/pagamento. Preço,
 *    taxa e total são calculados AQUI com as mesmas regras do checkout (precificarLinhas + resolverFrete + frete grátis).
 *    Qualquer valor que a IA mande é ignorado. O resumo que o cliente vê é montado pelo servidor (não pela IA).
 *  - criar: só depois do resumo E de uma confirmação clara do cliente numa mensagem POSTERIOR ao resumo
 *    ("sim", "pode mandar", "confirmo"...). Recalcula tudo de novo e cria pelo MESMO caminho da vitrine (criarPedido:
 *    Kanban, impressão, avisos), origem "whatsapp_ia". Mesma conversa + mesmo conteúdo em 10 min = não cria de novo.
 */
import { createHash } from 'node:crypto'
import { linhaComplemento, linhaItem } from '@/lib/mensageria/formato'
import type { SupabaseClient } from '@supabase/supabase-js'
import { canalDoPedido, criarPedido, precificarLinhas, type FormaPagamento, type NovoPedidoItemInput } from '@/lib/queries/pedidos'
import { resolverFrete } from '@/lib/frete'
import { lojaEstaAberta, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'
import { normalizarTexto } from '@/lib/robo-auto/classificador'
import { brl } from '@/lib/robo-auto/respostas'

export interface ItemCarrinho {
  itemId: string
  quantidade: number
  observacao?: string
  complementos?: string[]
  tamanho?: string
  sabores?: string[]
  borda?: string
  massa?: string
}
export interface EnderecoCarrinho { rua: string; numero: string; complemento?: string; bairro: string; referencia?: string; cep?: string }
export interface Carrinho {
  itens: ItemCarrinho[]
  tipo: 'entrega' | 'retirada'
  endereco?: EnderecoCarrinho | null
  pagamento: FormaPagamento
  trocoPara?: number | null
  nomeCliente: string
}

const txt = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const ID = /^[0-9a-f-]{36}$/i

/** Limpa o que a IA mandou: só os campos conhecidos, com limites. Preço/total/desconto não existem aqui. Puro. */
export function limparCarrinho(bruto: unknown, nomeWhatsapp: string | null): { ok: true; carrinho: Carrinho } | { ok: false; erro: string } {
  const b = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>
  const itensBrutos = Array.isArray(b.itens) ? b.itens.slice(0, 20) : []
  const itens: ItemCarrinho[] = []
  for (const x of itensBrutos) {
    const i = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const itemId = txt(i.item_id ?? i.itemId, 40)
    const quantidade = Math.floor(Number(i.quantidade))
    if (!ID.test(itemId)) return { ok: false, erro: 'Item sem item_id válido (use o id de consultar_cardapio).' }
    if (!Number.isFinite(quantidade) || quantidade < 1 || quantidade > 50) return { ok: false, erro: 'Quantidade deve ser de 1 a 50.' }
    const lista = (v: unknown) => (Array.isArray(v) ? v.slice(0, 20).map((s) => txt(s, 80)).filter(Boolean) : [])
    itens.push({
      itemId, quantidade, observacao: txt(i.observacao, 140), complementos: lista(i.complementos), tamanho: txt(i.tamanho, 80) || undefined,
      sabores: lista(i.sabores), borda: txt(i.borda, 80) || undefined, massa: txt(i.massa, 80) || undefined,
    })
  }
  if (!itens.length) return { ok: false, erro: 'O pedido está sem itens.' }
  const tipo = b.tipo === 'retirada' ? 'retirada' : b.tipo === 'entrega' ? 'entrega' : null
  if (!tipo) return { ok: false, erro: 'Falta saber se é entrega ou retirada.' }
  const pagamento = b.pagamento === 'pix' || b.pagamento === 'dinheiro' || b.pagamento === 'cartao' ? b.pagamento : null
  if (!pagamento) return { ok: false, erro: 'Falta a forma de pagamento (pix, dinheiro ou cartao).' }
  let endereco: EnderecoCarrinho | null = null
  if (tipo === 'entrega') {
    const e = (b.endereco && typeof b.endereco === 'object' ? b.endereco : {}) as Record<string, unknown>
    endereco = { rua: txt(e.rua, 120), numero: txt(e.numero, 20), complemento: txt(e.complemento, 80), bairro: txt(e.bairro, 80), referencia: txt(e.referencia, 120), cep: txt(e.cep, 9).replace(/\D/g, '') }
    if (!endereco.rua || !endereco.numero || !endereco.bairro) return { ok: false, erro: 'Para entrega preciso de rua, número e bairro.' }
  }
  const troco = b.troco_para ?? b.trocoPara
  const trocoPara = pagamento === 'dinheiro' && troco !== null && troco !== undefined && Number(troco) > 0 ? Math.round(Number(troco) * 100) / 100 : null
  const nomeCliente = txt(b.nome_cliente ?? b.nomeCliente, 80) || (nomeWhatsapp ?? '').trim().slice(0, 80)
  if (!nomeCliente) return { ok: false, erro: 'Falta o nome do cliente.' }
  return { ok: true, carrinho: { itens, tipo, endereco, pagamento, trocoPara, nomeCliente } }
}

/** Mesma conversa, mesmo conteúdo → mesmo hash (a ordem dos itens não importa). Puro. */
export function hashCarrinho(c: Carrinho): string {
  const itens = [...c.itens].map((i) => JSON.stringify(i)).sort()
  return createHash('sha256').update(JSON.stringify({ ...c, itens })).digest('hex').slice(0, 24)
}

/** Confirmação clara do cliente ("sim", "pode mandar", "confirmo", "fechado"...). Puro. Qualquer "não" anula. */
export function confirmouPedido(texto: string): boolean {
  const n = normalizarTexto(texto)
  // "sim, mas troca pra dinheiro" não confirma (12/10): mudança junto com o sim refaz o resumo.
  if (!n || /\b(nao|n|espera|pera|calma|mudar|muda|trocar|troca|tira|tirar|cancela|errado|errada|mas|porem|so que)\b/.test(n)) return false
  return /^(sim|s|ss|isso|isso mesmo|pode|pode sim|pode mandar|manda|pode fechar|fecha|fechado|fechou|confirmo|confirmado|confirma|confirmar|ok|okay|beleza|certo|ta certo|esta certo|perfeito|correto|positivo|claro|bora|vai|pode ser|tudo certo)( .*)?$/.test(n)
}

export interface ResumoPedido { texto: string; total: number; subtotal: number; taxa: number; hash: string; pixOnline: boolean }

export interface ContextoPedido {
  admin: SupabaseClient
  restauranteId: string
  telefone: string
  conversaId: string
  nomeWhatsapp: string | null
  pixOnlineAtivo: boolean
}

/** Linhas de pedido no formato do checkout (a pizza junta os sabores com " / ", como a vitrine). */
export function linhasDoCarrinho(c: Carrinho): NovoPedidoItemInput[] {
  return c.itens.map((i) => ({
    itemId: i.itemId, quantidade: i.quantidade, observacao: i.observacao ?? '', complementos: i.complementos ?? [],
    tamanhoNome: i.tamanho, saborNome: i.sabores?.length ? i.sabores.join(' / ') : undefined, bordaNome: i.borda, massaNome: i.massa,
  }))
}

const ROTULO_PAGAMENTO: Record<FormaPagamento, string> = { pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão na entrega' }

/** Falha ao fechar o pedido com código (19/10): lib/agente-ia/falhas.ts transforma em texto humano para o cliente. */
export type CodigoFalhaPedido = 'fechada' | 'sem_entrega' | 'sem_retirada' | 'fora_da_area'
export class FalhaPedido extends Error {
  readonly codigo: CodigoFalhaPedido
  constructor(codigo: CodigoFalhaPedido, mensagem: string) { super(mensagem); this.name = 'FalhaPedido'; this.codigo = codigo }
}

/**
 * Calcula o pedido com as regras do checkout e monta o resumo (texto do servidor). Lança Error com a mensagem para o
 * cliente quando algo não pode (loja fechada, item indisponível, endereço fora da área...).
 */
export async function calcularPedido(ctx: ContextoPedido, c: Carrinho): Promise<ResumoPedido> {
  const { admin, restauranteId } = ctx
  const { data: loja } = await admin
    .from('restaurantes')
    .select('status_loja, horario_funcionamento, aceita_entrega, aceita_retirada, pizza_calculo_preco, frete_gratis_acima')
    .eq('id', restauranteId)
    .maybeSingle()
  const l = (loja ?? {}) as Record<string, unknown>
  if (!lojaEstaAberta({ statusLoja: ((l.status_loja as StatusLoja | null) ?? 'automatico'), horarioFuncionamento: (l.horario_funcionamento as HorarioFuncionamento | null) ?? null })) {
    throw new FalhaPedido('fechada', 'A loja está fechada agora; o pedido não pode ser feito.')
  }
  if (c.tipo === 'entrega' && l.aceita_entrega === false) throw new FalhaPedido('sem_entrega', 'A loja não está fazendo entregas agora.')
  if (c.tipo === 'retirada' && l.aceita_retirada !== true) throw new FalhaPedido('sem_retirada', 'A loja não está aceitando retirada agora.')
  const itens = linhasDoCarrinho(c)
  const linhas = await precificarLinhas(admin, restauranteId, { itens, origem: 'cardapio' }, { canal: canalDoPedido({ origem: 'cardapio' }), pizzaCalculoPreco: l.pizza_calculo_preco as string | null })
  const cent = (v: number) => Math.round(v * 100) / 100
  const subtotal = cent(linhas.reduce((s, x) => s + x.preco_unitario * x.quantidade, 0))
  let taxa = 0
  if (c.tipo === 'entrega' && c.endereco) {
    const f = await resolverFrete(admin, restauranteId, { rua: c.endereco.rua, numero: c.endereco.numero, bairro: c.endereco.bairro, cep: c.endereco.cep })
    if (!f.entregavel) throw new FalhaPedido('fora_da_area', f.motivo || 'A loja não entrega nesse endereço.')
    taxa = f.taxa
    const minimo = l.frete_gratis_acima === null || l.frete_gratis_acima === undefined ? null : Number(l.frete_gratis_acima)
    if (minimo !== null && minimo > 0 && subtotal >= minimo) taxa = 0
  }
  const total = cent(subtotal + taxa)
  const pixOnline = c.pagamento === 'pix' && ctx.pixOnlineAtivo
  const linhasTexto = linhas.map(linhasDoItemResumo)
  const pagamento = c.pagamento === 'dinheiro' && c.trocoPara ? `Dinheiro (troco para ${brl(c.trocoPara)})` : pixOnline ? 'Pix (envio o código depois de confirmar)' : ROTULO_PAGAMENTO[c.pagamento]
  const onde = c.tipo === 'entrega' && c.endereco
    ? `📍 Entrega: ${c.endereco.rua}, ${c.endereco.numero}${c.endereco.complemento ? ` (${c.endereco.complemento})` : ''} — ${c.endereco.bairro}`
    : '🏪 Retirada no balcão'
  const texto = [
    '🧾 Resumo do pedido',
    '',
    ...linhasTexto,
    '',
    `Subtotal: \`${brl(subtotal)}\``,
    ...(c.tipo === 'entrega' ? [`Entrega: \`${taxa > 0 ? brl(taxa) : 'Grátis'}\``] : []),
    `*Total:* \`${brl(total)}\``,
    '',
    onde,
    `💳 Pagamento: ${pagamento}`,
    `👤 Nome: ${c.nomeCliente}`,
    '',
    '> Está tudo certo? Responda *sim* para confirmar o pedido.',
  ].join('\n')
  return { texto, total, subtotal, taxa, hash: hashCarrinho(c), pixOnline }
}

/** Telefone do pedido como a vitrine grava: DDD + número (sem o 55). */
/**
 * Linhas de um item no resumo (12/10): emoji + nome em negrito + preço em cinza; depois tamanho, sabor, borda, massa e
 * complementos UM POR LINHA (com emoji; grátis sem preço) e a observação. Pura.
 */
export function linhasDoItemResumo(x: { quantidade: number; nome: string; preco_unitario: number; tamanho_nome?: string | null; sabor_nome?: string | null; borda_nome?: string | null; massa_nome?: string | null; complementos: { nome: string; preco: number }[]; observacao?: string | null }): string {
  const sub = [
    x.tamanho_nome ? `Tamanho: ${x.tamanho_nome}` : '',
    x.sabor_nome ? `Sabor: ${x.sabor_nome}` : '',
    x.borda_nome ? `Borda: ${x.borda_nome}` : '',
    x.massa_nome ? `Massa: ${x.massa_nome}` : '',
    ...x.complementos.map((o) => linhaComplemento(o.nome, Number(o.preco))),
    x.observacao ? `_Obs.: ${x.observacao}_` : '',
  ].filter(Boolean).map((l) => `   ${l}`)
  return [linhaItem(x.quantidade, x.nome, x.preco_unitario * x.quantidade), ...sub].join('\n')
}

export function telefoneDoPedido(telefoneWhatsapp: string): string {
  const d = telefoneWhatsapp.replace(/\D/g, '')
  return d.startsWith('55') && (d.length === 12 || d.length === 13) ? d.slice(2) : d
}

export const JANELA_DUPLICADO_MS = 10 * 60_000

export type ResultadoCriar =
  | { ok: true; id: string; numero: number; total: number; repetido: boolean; pixOnline: boolean }
  | { ok: false; erro: string }

/**
 * Cria o pedido confirmado. `confirmacao` é a mensagem do cliente que está sendo respondida agora (texto + quando chegou).
 * Toda regra é do servidor: a IA só pode pedir para criar.
 */
export async function criarPedidoDaConversa(ctx: ContextoPedido, confirmacao: { texto: string; em: string }, agora = new Date()): Promise<ResultadoCriar> {
  const { admin, restauranteId, conversaId } = ctx
  const { data: conv } = await admin.from('whatsapp_conversas').select('ia_carrinho, ia_resumo_em').eq('id', conversaId).eq('restaurante_id', restauranteId).maybeSingle()
  const salvo = (conv as { ia_carrinho?: { carrinho?: Carrinho; hash?: string } | null; ia_resumo_em?: string | null } | null) ?? null
  const carrinho = salvo?.ia_carrinho?.carrinho
  if (!carrinho || !salvo?.ia_resumo_em) return { ok: false, erro: 'Ainda não há pedido montado: use montar_pedido e mostre o resumo antes.' }
  if (!(Date.parse(confirmacao.em) > Date.parse(salvo.ia_resumo_em))) return { ok: false, erro: 'O cliente ainda não respondeu ao resumo. Espere a confirmação dele.' }
  if (!confirmouPedido(confirmacao.texto)) return { ok: false, erro: 'O cliente não confirmou claramente. Pergunte se pode confirmar o pedido.' }

  const hash = hashCarrinho(carrinho)
  const prefixo = `waia:${conversaId}:${hash}:`
  const { data: recentes } = await admin
    .from('pedidos')
    .select('id, numero, total, status')
    .eq('restaurante_id', restauranteId)
    .like('chave_idempotencia', `${prefixo}%`)
    .gte('criado_em', new Date(agora.getTime() - JANELA_DUPLICADO_MS).toISOString())
    .limit(5)
  // Cancelado não é duplicado (teste real 12/10: o mesmo carrinho depois de um pedido cancelado devolvia o cancelado #290).
  const doMesmo = (recentes ?? []) as { id: string; numero: number; total: number; status: string }[]
  const ja = doMesmo.find((x) => x.status !== 'cancelado')
  if (ja) return { ok: true, id: ja.id, numero: ja.numero, total: Number(ja.total), repetido: true, pixOnline: ja.status === 'aguardando_pagamento' }
  // A chave é única no banco: com um cancelado na mesma janela, a chave nova leva o instante.
  const sufixo = doMesmo.length ? `${Math.floor(agora.getTime() / JANELA_DUPLICADO_MS)}:${agora.getTime()}` : `${Math.floor(agora.getTime() / JANELA_DUPLICADO_MS)}`

  let resumo: ResumoPedido
  try {
    resumo = await calcularPedido(ctx, carrinho)
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
  try {
    const p = await criarPedido(admin, restauranteId, {
      tipo: carrinho.tipo,
      cliente: { nome: carrinho.nomeCliente, telefone: telefoneDoPedido(ctx.telefone) },
      endereco: carrinho.tipo === 'entrega' && carrinho.endereco
        ? { rua: carrinho.endereco.rua, numero: carrinho.endereco.numero, complemento: carrinho.endereco.complemento ?? '', bairro: carrinho.endereco.bairro, cep: carrinho.endereco.cep ?? '', referencia: carrinho.endereco.referencia ?? '' }
        : { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
      pagamento: carrinho.pagamento,
      pixOnline: resumo.pixOnline,
      trocoPara: carrinho.trocoPara ?? null,
      origem: 'cardapio',
      origemCanal: 'whatsapp_ia',
      origemDetalhe: { meio: 'agente_ia', conversa: conversaId },
      chaveIdempotencia: `${prefixo}${sufixo}`,
      itens: linhasDoCarrinho(carrinho),
    }, { telefoneConfirmado: true })
    return { ok: true, id: p.id, numero: p.numero, total: resumo.total, repetido: false, pixOnline: resumo.pixOnline }
  } catch (e) {
    // Mesma chave ao mesmo tempo (duas mensagens juntas): devolve o que a primeira criou.
    if ((e as { code?: string })?.code === '23505') {
      const { data } = await admin.from('pedidos').select('id, numero, total').eq('restaurante_id', restauranteId).like('chave_idempotencia', `${prefixo}%`).neq('status', 'cancelado').limit(1).maybeSingle()
      if (data) return { ok: true, id: data.id as string, numero: data.numero as number, total: Number(data.total), repetido: true, pixOnline: resumo.pixOnline }
    }
    return { ok: false, erro: (e as Error).message || 'Não foi possível criar o pedido.' }
  }
}
