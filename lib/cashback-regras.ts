// Regras puras do CASHBACK (Etapa 7, 20/10/2026) — sem IO (sem banco, sem fetch, sem Date.now()).
// O dono escolhe um item → quanto de cashback dá (R$ por unidade ou % do valor) → por quantos dias vale.
// O crédito nasce quando o pedido é ENTREGUE, expira sozinho e é usado automaticamente no próximo pedido
// (vitrine e IA), abatendo só do subtotal — nunca do frete. Tudo que decide "quanto dá", "quanto usa"
// e "de qual crédito tira" mora aqui, testável sem Supabase.

export interface RegraCashback {
  id: string
  itemId: string
  tipo: 'valor' | 'percentual'
  valor: number
  validadeDias: number
  ativo: boolean
}

export interface LinhaParaCashback {
  itemId: string | null
  nome: string
  quantidade: number
  precoUnitario: number
}

export interface CreditoNovo {
  regraId: string
  itemNome: string
  valor: number
  expiraEm: string
}

export interface CreditoDisponivel {
  id: string
  saldo: number
  expiraEm: string
}

const DIA_MS = 24 * 3600_000

export function round2(valor: number): number {
  return Math.round(valor * 100) / 100
}

/** "R$ 1.234,56" na mão (mesma convenção de lib/fidelidade-regras.ts: sem toLocaleString por causa do ICU do Node). */
export function brl(valor: number): string {
  const v = round2(valor)
  const [inteiro, decimal] = Math.abs(v).toFixed(2).split('.')
  return `${v < 0 ? '-' : ''}R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimal}`
}

/** "15/11" no horário de Brasília (dia de expiração nas mensagens). */
export function diaMesSaoPaulo(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }).format(d)
}

/**
 * Créditos que um pedido ENTREGUE gera: uma linha do pedido com regra ativa → um crédito.
 * `valor` por unidade × quantidade; `percentual` sobre (preço × quantidade). Linha R$ 0 (item grátis de
 * prêmio) não gera nada. Expira `validadeDias` depois de `entregueEm`.
 */
export function calcularCreditosDoPedido(regras: RegraCashback[], linhas: LinhaParaCashback[], entregueEm: Date): CreditoNovo[] {
  const porItem = new Map(regras.filter((r) => r.ativo && r.valor > 0).map((r) => [r.itemId, r]))
  const creditos: CreditoNovo[] = []
  for (const l of linhas) {
    if (!l.itemId || l.quantidade <= 0 || l.precoUnitario <= 0) continue
    const r = porItem.get(l.itemId)
    if (!r) continue
    const base = l.precoUnitario * l.quantidade
    const bruto = r.tipo === 'valor' ? r.valor * l.quantidade : (base * r.valor) / 100
    // Nunca mais que o próprio valor da linha (cashback de 100 % no máximo).
    const valor = round2(Math.min(bruto, base))
    if (valor <= 0) continue
    creditos.push({ regraId: r.id, itemNome: l.nome, valor, expiraEm: new Date(entregueEm.getTime() + r.validadeDias * DIA_MS).toISOString() })
  }
  return creditos
}

/** Soma do que ainda vale agora (expira depois de `agora`) e a próxima expiração. */
export function saldoDisponivel(creditos: CreditoDisponivel[], agora: Date): { saldo: number; proximaExpiracao: string | null } {
  const validos = creditos.filter((c) => c.saldo > 0 && Date.parse(c.expiraEm) > agora.getTime())
  const saldo = round2(validos.reduce((s, c) => s + c.saldo, 0))
  const proxima = validos.map((c) => c.expiraEm).sort()[0] ?? null
  return { saldo, proximaExpiracao: proxima }
}

/** Quanto do saldo entra no pedido: limitado ao que sobrou do subtotal depois dos outros descontos (nunca o frete). */
export function valorCashbackAplicavel(saldo: number, subtotal: number, descontoAnterior: number): number {
  const restante = Math.max(0, subtotal - descontoAnterior)
  return round2(Math.max(0, Math.min(saldo, restante)))
}

/**
 * De quais créditos tirar `valorNecessario`: os que expiram primeiro saem primeiro (FIFO por expiração).
 * Retorna o plano (id → quanto usar) e o total coberto (pode ser menor que o pedido se o saldo não chegar).
 */
export function planejarConsumo(creditos: CreditoDisponivel[], valorNecessario: number, agora: Date): { usos: { id: string; usar: number; saldoAntes: number }[]; total: number } {
  const validos = creditos
    .filter((c) => c.saldo > 0 && Date.parse(c.expiraEm) > agora.getTime())
    .sort((a, b) => a.expiraEm.localeCompare(b.expiraEm))
  const usos: { id: string; usar: number; saldoAntes: number }[] = []
  let falta = round2(valorNecessario)
  for (const c of validos) {
    if (falta <= 0) break
    const usar = round2(Math.min(c.saldo, falta))
    if (usar <= 0) continue
    usos.push({ id: c.id, usar, saldoAntes: c.saldo })
    falta = round2(falta - usar)
  }
  return { usos, total: round2(valorNecessario - falta) }
}

// ─── Mensagens ao cliente ─────────────────────────────────────────────────────

export interface CashbackParaMensagem {
  saldo: number
  proximaExpiracao: string | null
}

/** Linha do bloco "cashback" na mensagem de pedido entregue. `null` quando o pedido não gerou cashback. */
export function montarBlocoCashbackGanho(creditos: { valor: number; expiraEm: string }[], saldoTotal: number): string | null {
  if (creditos.length === 0) return null
  const ganho = round2(creditos.reduce((s, c) => s + c.valor, 0))
  if (ganho <= 0) return null
  const expira = creditos.map((c) => c.expiraEm).sort()[0]
  const linhas = [`💰 Você ganhou *${brl(ganho)} de cashback* neste pedido!`, `Use até ${diaMesSaoPaulo(expira)} — é descontado sozinho no seu próximo pedido.`]
  if (round2(saldoTotal) > ganho) linhas.push(`Saldo total disponível: *${brl(saldoTotal)}*.`)
  return linhas.join('\n')
}

export interface ProgressoParaCliente {
  nomeLoja: string
  nomeCliente?: string | null
  cashback: CashbackParaMensagem | null
  /** Campanhas em andamento: "Faltam R$ 40,00" + prêmio. */
  campanhas: { faltaTexto: string; premioLabel: string; percentual: number }[]
  /** Prêmios já ganhos e ainda não resgatados. */
  recompensas: { premioLabel: string; podeResgatarHoje: boolean }[]
  /** Cupons públicos da loja válidos hoje. */
  cupons: { codigo: string; descricao: string }[]
  linkCardapio: string
}

/** Barra de progresso em texto (10 blocos), sem depender de fonte: ▰▰▰▱▱▱▱▱▱▱ 30%. */
export function barraProgresso(percentual: number): string {
  const p = Math.max(0, Math.min(100, Math.round(percentual)))
  const cheios = Math.round(p / 10)
  return `${'▰'.repeat(cheios)}${'▱'.repeat(10 - cheios)} ${p}%`
}

/**
 * Mensagem "Ver meu progresso" (robô opção 4 / IA): cashback disponível + validade, prêmios prontos, missões em
 * andamento e cupons da loja. Profissional, curta, no estilo das outras mensagens do robô. Sempre devolve texto.
 */
export function montarMensagemProgresso(p: ProgressoParaCliente): string {
  const nome = p.nomeCliente?.trim().split(/\s+/)[0]
  const blocos: string[] = [`*🎁 SEU PROGRESSO NA ${p.nomeLoja.toUpperCase()}*`]
  if (nome) blocos.push('', `Olá, _${nome}_! Veja o que você já tem por aqui:`)

  if (p.cashback && p.cashback.saldo > 0) {
    const validade = p.cashback.proximaExpiracao ? ` (use até ${diaMesSaoPaulo(p.cashback.proximaExpiracao)})` : ''
    blocos.push('', `*💰 Cashback disponível:* \`${brl(p.cashback.saldo)}\`${validade}`, '> É descontado sozinho no seu próximo pedido.')
  }
  if (p.recompensas.length > 0) {
    blocos.push('', '*🏆 Prêmios prontos para resgatar:*', ...p.recompensas.map((r) => `- ${r.premioLabel}${r.podeResgatarHoje ? '' : ' (não vale hoje)'}`))
  }
  if (p.campanhas.length > 0) {
    blocos.push('', '*🎯 Suas missões:*', ...p.campanhas.map((c) => `- ${c.faltaTexto} para ganhar ${c.premioLabel}\n  ${barraProgresso(c.percentual)}`))
  }
  if (p.cupons.length > 0) {
    blocos.push('', '*🏷️ Cupons da loja:*', ...p.cupons.map((c) => `- \`${c.codigo}\`${c.descricao ? ` — ${c.descricao}` : ''}`))
  }
  const temAlgo = (p.cashback?.saldo ?? 0) > 0 || p.recompensas.length > 0 || p.campanhas.length > 0 || p.cupons.length > 0
  if (!temAlgo) blocos.push('', 'Você ainda não tem cashback, prêmios ou cupons por aqui. Cada pedido entregue conta! 😊')
  blocos.push('', `*Fazer um pedido:* ${p.linkCardapio}`)
  return blocos.join('\n')
}
