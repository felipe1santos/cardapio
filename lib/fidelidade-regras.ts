// Regras puras do Fidelidade+Cupons — sem IO (sem banco, sem fetch, sem Date.now()).
// Tudo que decide "esse pedido conta?", "quanto falta?", "esse cupom vale?" mora aqui,
// isolado, pra ser testável sem mockar Supabase e reutilizável tanto no servidor
// (endpoints/criarPedido) quanto em telas do admin que só querem simular um cenário.

export interface CampanhaFidelidade {
  id: string
  nome: string
  descricao: string
  ativa: boolean
  tipoMeta: 'valor_gasto' | 'qtd_pedidos' | 'qtd_itens'
  metaValor: number | null
  metaQuantidade: number | null
  diasSemanaContam: number[]
  diasSemanaResgate: number[]
  premioTipo: 'item_gratis' | 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis'
  premioItemId: string | null
  premioValor: number | null
  repetivel: boolean
}

export interface ProgressoCliente {
  progressoValor: number
  progressoQtd: number
  ciclosCompletados: number
}

/** Arredonda pra 2 casas decimais (dinheiro nunca deve carregar erro de ponto flutuante). */
function round2(valor: number): number {
  return Math.round(valor * 100) / 100
}

/**
 * Formata em "R$ 1.234,56" na mão (sem toLocaleString) porque o separador que o ICU do
 * Node usa pra pt-BR mudou entre versões (espaço normal vs. non-breaking space), o que
 * quebraria comparação exata de texto nos testes e nas mensagens mandadas pro WhatsApp.
 */
function brl(valor: number): string {
  const v = round2(valor)
  const negativo = v < 0
  const [inteiro, decimal] = Math.abs(v).toFixed(2).split('.')
  const inteiroComMilhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negativo ? '-' : ''}R$ ${inteiroComMilhar},${decimal}`
}

/** Percentual 0-100 (arredondado), sem dividir por zero quando a meta não está definida. */
function calcularPercentual(progresso: number, meta: number | null): number {
  if (!meta || meta <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((progresso / meta) * 100)))
}

/** Pedido entregue conta pra campanha? (dia da semana + campanha ativa + repetição) */
export function pedidoContaParaCampanha(c: CampanhaFidelidade, p: ProgressoCliente, diaSemanaPedido: number): boolean {
  if (!c.ativa) return false
  // repetivel=false: depois de completar um ciclo, a campanha "aposentou" pra esse cliente.
  if (!c.repetivel && p.ciclosCompletados >= 1) return false
  // diasSemanaContam vazio = qualquer dia conta (mesma convenção de diasSemanaResgate).
  if (c.diasSemanaContam.length > 0 && !c.diasSemanaContam.includes(diaSemanaPedido)) return false
  return true
}

/**
 * Aplica um pedido ao progresso. Assume que o chamador já checou
 * `pedidoContaParaCampanha` antes (essa função não repete a checagem de dia da semana,
 * pois não recebe diaSemanaPedido — só reforça, defensivamente, a regra de repetição).
 * Retorna novo progresso + se completou a meta agora.
 */
export function aplicarPedidoAoProgresso(
  c: CampanhaFidelidade,
  p: ProgressoCliente,
  pedido: { subtotal: number; qtdItens: number }
): { novo: ProgressoCliente; completou: boolean } {
  if (!c.repetivel && p.ciclosCompletados >= 1) {
    return { novo: p, completou: false }
  }

  let progressoValor = p.progressoValor
  let progressoQtd = p.progressoQtd

  if (c.tipoMeta === 'valor_gasto') {
    progressoValor = round2(progressoValor + pedido.subtotal)
  } else if (c.tipoMeta === 'qtd_pedidos') {
    progressoQtd += 1
  } else {
    progressoQtd += pedido.qtdItens
  }

  const completou =
    c.tipoMeta === 'valor_gasto'
      ? c.metaValor != null && progressoValor >= c.metaValor
      : c.metaQuantidade != null && progressoQtd >= c.metaQuantidade

  if (completou) {
    // Excedente não transborda pro próximo ciclo — zera tudo, mesmo que tenha passado da meta.
    return { novo: { progressoValor: 0, progressoQtd: 0, ciclosCompletados: p.ciclosCompletados + 1 }, completou: true }
  }

  return { novo: { progressoValor, progressoQtd, ciclosCompletados: p.ciclosCompletados }, completou: false }
}

/** Quanto falta (texto pro WhatsApp/vitrine): {faltaTexto, percentual} */
export function resumoProgresso(c: CampanhaFidelidade, p: ProgressoCliente): { faltaTexto: string; percentual: number } {
  if (c.tipoMeta === 'valor_gasto') {
    const meta = c.metaValor ?? 0
    const falta = round2(Math.max(0, meta - p.progressoValor))
    return {
      faltaTexto: falta <= 0 ? 'Meta atingida!' : `Faltam ${brl(falta)}`,
      percentual: calcularPercentual(p.progressoValor, c.metaValor),
    }
  }

  const meta = c.metaQuantidade ?? 0
  const falta = Math.max(0, meta - p.progressoQtd)
  const unidade = c.tipoMeta === 'qtd_pedidos' ? 'pedido' : 'item'
  const unidadePlural = c.tipoMeta === 'qtd_pedidos' ? 'pedidos' : 'itens'
  const faltaTexto = falta <= 0 ? 'Meta atingida!' : falta === 1 ? `Falta 1 ${unidade}` : `Faltam ${falta} ${unidadePlural}`
  return { faltaTexto, percentual: calcularPercentual(p.progressoQtd, c.metaQuantidade) }
}

/** Hoje pode resgatar? (dias_semana_resgate) */
export function podeResgatarHoje(diasSemanaResgate: number[], diaSemanaHoje: number): boolean {
  if (diasSemanaResgate.length === 0) return true
  return diasSemanaResgate.includes(diaSemanaHoje)
}

/**
 * Fração "X/Y" pro texto de progresso (ex.: "8/10"), só faz sentido pra metas em quantidade —
 * `valor_gasto` progride em dinheiro, não em unidades discretas, então não tem fração.
 */
export function fracaoProgresso(c: CampanhaFidelidade, p: ProgressoCliente): string | null {
  if (c.tipoMeta === 'valor_gasto') return null
  return `${p.progressoQtd}/${c.metaQuantidade ?? 0}`
}

/** Texto do prêmio de uma campanha, usado nas mensagens de WhatsApp do motor de fidelidade. */
export function premioLabelCampanha(
  c: Pick<CampanhaFidelidade, 'premioTipo' | 'premioValor'>,
  premioItemNome?: string | null
): string {
  switch (c.premioTipo) {
    case 'item_gratis':
      return `${premioItemNome ?? 'item'} grátis`
    case 'desconto_percentual':
      return `${c.premioValor ?? 0}% de desconto`
    case 'desconto_valor':
      return `${brl(c.premioValor ?? 0)} de desconto`
    case 'entrega_gratis':
      return 'entrega grátis'
  }
}

export interface ProgressoParaMensagem {
  faltaTexto: string
  premioLabel: string
  fracao: string | null
}

export interface RecompensaParaMensagem {
  premioLabel: string
  diasSemanaResgate: number[]
}

/** Uma linha "• Faltam X para ganhar Y (N/M)" do bloco de progresso da mensagem de WhatsApp. */
export function montarLinhaProgresso(p: ProgressoParaMensagem): string {
  const fracaoTexto = p.fracao ? ` (${p.fracao})` : ''
  return `• ${p.faltaTexto} para ganhar ${p.premioLabel}${fracaoTexto}`
}

/** Bloco "🎉 PRÊMIO DESBLOQUEADO: ..." + instrução de resgate, pra cada recompensa nova ganha no pedido. */
export function montarBlocoRecompensa(r: RecompensaParaMensagem): string {
  const diasTexto = diasSemanaTexto(r.diasSemanaResgate)
  const validoTexto = diasTexto ? ` (válido ${diasTexto})` : ''
  return `🎉 PRÊMIO DESBLOQUEADO: ${r.premioLabel}!\nResgate na aba Cupons do cardápio${validoTexto}.`
}

/**
 * Monta a mensagem única de WhatsApp mandada quando um pedido é entregue (no máx. 1 mensagem
 * por pedido, mesmo que várias campanhas tenham progredido/completado). `null` quando não há
 * nada a notificar (nenhuma campanha progrediu nem foi completada por esse pedido).
 */
export function montarMensagemFidelidade(
  progressos: ProgressoParaMensagem[],
  recompensasNovas: RecompensaParaMensagem[],
  nomeLoja: string
): string | null {
  if (progressos.length === 0 && recompensasNovas.length === 0) return null

  const blocos: string[] = ['Pedido entregue! ✅']
  if (progressos.length > 0) {
    blocos.push('', `Seu progresso de fidelidade na ${nomeLoja}:`, progressos.map(montarLinhaProgresso).join('\n'))
  }
  if (recompensasNovas.length > 0) {
    blocos.push('', recompensasNovas.map(montarBlocoRecompensa).join('\n\n'))
  }
  return blocos.join('\n')
}

/**
 * Motivo lançado por `criarPedido` quando um cupom segmentado (primeira_compra/recompra)
 * chega com um telefone sem cadastro de cliente no tenant — a vitrine logada sempre tem o
 * cliente na tabela `clientes` (criado no login por código), então esse erro só aparece
 * pra quem chama a API direta com telefone forjado.
 */
export const MOTIVO_CUPOM_EXIGE_LOGIN_PEDIDO = 'Entre com seu telefone no cardápio para usar este cupom.'

export interface CupomRegra {
  ativo: boolean
  tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis'
  valor: number | null
  publico: 'todos' | 'primeira_compra' | 'recompra'
  diasInatividade: number | null
  diasSemana: number[]
  validadeInicio: string | null
  validadeFim: string | null
  valorMinimoPedido: number | null
  usoUnicoPorCliente: boolean
  maxUsos: number | null
  usos: number
}

export interface HistoricoCliente {
  totalPedidosEntregues: number
  ultimoPedidoEm: string | null
  jaUsouEsteCupom: boolean
}

// Artigo correto em pt-BR: dias com "-feira" (segunda..sexta) são femininos ("às"),
// domingo e sábado são masculinos ("aos"). Usado só pra montar a mensagem de recusa.
const DIA_SEMANA_LABEL: Record<number, string> = {
  0: 'aos domingos',
  1: 'às segundas',
  2: 'às terças',
  3: 'às quartas',
  4: 'às quintas',
  5: 'às sextas',
  6: 'aos sábados',
}

/** "às segundas, às quartas e aos sábados" — usado em mensagens de recusa (cupom e resgate de prêmio). */
export function diasSemanaTexto(dias: number[]): string {
  const labels = dias.map((d) => DIA_SEMANA_LABEL[d]).filter((l): l is string => Boolean(l))
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`
}

/** Valida cupom pro cliente/momento. Retorna {ok:true} ou {ok:false, motivo}. */
export function validarCupom(
  cupom: CupomRegra,
  hist: HistoricoCliente,
  ctx: { subtotal: number; diaSemana: number; hojeISO: string }
): { ok: true } | { ok: false; motivo: string } {
  if (!cupom.ativo) {
    return { ok: false, motivo: 'Este cupom não está mais ativo.' }
  }

  if (cupom.diasSemana.length > 0 && !cupom.diasSemana.includes(ctx.diaSemana)) {
    return { ok: false, motivo: `Este cupom vale só ${diasSemanaTexto(cupom.diasSemana)}.` }
  }

  // Comparação de string funciona porque validadeInicio/Fim/hojeISO seguem 'YYYY-MM-DD'
  // (ordem lexicográfica = ordem cronológica nesse formato).
  if (cupom.validadeInicio && ctx.hojeISO < cupom.validadeInicio) {
    return { ok: false, motivo: 'Este cupom ainda não está disponível.' }
  }
  if (cupom.validadeFim && ctx.hojeISO > cupom.validadeFim) {
    return { ok: false, motivo: 'Este cupom expirou.' }
  }

  if (cupom.valorMinimoPedido != null && ctx.subtotal < cupom.valorMinimoPedido) {
    return { ok: false, motivo: `Pedido mínimo de ${brl(cupom.valorMinimoPedido)} para usar este cupom.` }
  }

  if (cupom.publico === 'primeira_compra' && hist.totalPedidosEntregues > 0) {
    return { ok: false, motivo: 'Este cupom é exclusivo para o primeiro pedido.' }
  }

  if (cupom.publico === 'recompra') {
    // "Recompra" mira quem só fez 0-1 pedido (nunca repetiu) ou sumiu há tempo — não
    // é pra cliente ativo e recorrente.
    const poucosPedidos = hist.totalPedidosEntregues <= 1
    let inativoOSuficiente = false
    if (cupom.diasInatividade != null && hist.ultimoPedidoEm) {
      const dias = Math.floor((Date.parse(ctx.hojeISO) - Date.parse(hist.ultimoPedidoEm)) / 86400000)
      inativoOSuficiente = dias >= cupom.diasInatividade
    }
    if (!poucosPedidos && !inativoOSuficiente) {
      return { ok: false, motivo: 'Este cupom é para clientes que ainda não voltaram a pedir.' }
    }
  }

  if (cupom.usoUnicoPorCliente && hist.jaUsouEsteCupom) {
    return { ok: false, motivo: 'Você já usou este cupom.' }
  }

  if (cupom.maxUsos != null && cupom.usos >= cupom.maxUsos) {
    return { ok: false, motivo: 'Este cupom atingiu o limite de usos.' }
  }

  return { ok: true }
}

/** Desconto em R$ de um cupom/prêmio sobre subtotal+frete. Nunca negativo, nunca > subtotal. */
export function calcularDesconto(
  tipo: 'desconto_percentual' | 'desconto_valor' | 'entrega_gratis' | 'item_gratis',
  valor: number | null,
  subtotal: number,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- faz parte da assinatura pública; entrega_gratis usa via zeraFrete
  taxaEntrega: number
): { descontoSubtotal: number; zeraFrete: boolean } {
  if (tipo === 'entrega_gratis') {
    return { descontoSubtotal: 0, zeraFrete: true }
  }
  if (tipo === 'item_gratis') {
    // O item grátis vira uma linha R$ 0 no pedido (fora do escopo desta função) — não é
    // um desconto em cima do subtotal.
    return { descontoSubtotal: 0, zeraFrete: false }
  }
  if (tipo === 'desconto_percentual') {
    const pct = Math.max(0, valor ?? 0)
    const bruto = round2(subtotal * (pct / 100))
    return { descontoSubtotal: Math.min(Math.max(0, bruto), subtotal), zeraFrete: false }
  }
  // desconto_valor: trava no subtotal — nunca "desconta" mais do que o pedido vale.
  const bruto = Math.max(0, valor ?? 0)
  return { descontoSubtotal: round2(Math.min(bruto, subtotal)), zeraFrete: false }
}
