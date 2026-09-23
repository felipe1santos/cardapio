import type { PedidoDashboard, StatusPedido } from '@/lib/queries/pedidos'

/**
 * Contas do Dashboard.
 *
 * Fica fora do componente porque é aqui que mora o que pode dar errado: o
 * recorte do período, a comparação com o período anterior, quem é cliente novo
 * e por onde o pedido passou. A tela só desenha o que estas funções devolvem.
 *
 * Tudo trabalha em milissegundos (`Date.now()`), e o intervalo é SEMPRE fechado
 * no início e aberto no fim (`inicio <= t < fim`) — assim dois períodos
 * seguidos nunca contam o mesmo pedido duas vezes.
 */

export type PresetPeriodo = 'hoje' | 'ontem' | '7d' | '15d' | '30d' | '3m' | '6m' | '1a' | 'tudo'

export interface Intervalo {
  inicio: number
  /** Exclusivo: um pedido exatamente em `fim` pertence ao período seguinte. */
  fim: number
}

export const PRESETS: { id: PresetPeriodo; label: string }[] = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7d', label: '7 dias' },
  { id: '15d', label: '15 dias' },
  { id: '30d', label: '30 dias' },
  { id: '3m', label: '3 meses' },
  { id: '6m', label: '6 meses' },
  { id: '1a', label: '1 ano' },
  { id: 'tudo', label: 'Tudo' },
]

const DIA = 86_400_000

/** Meia-noite local do dia em que `ms` cai. */
export function inicioDoDia(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * O intervalo de um atalho de período.
 *
 * "7 dias" é a semana corrente contando HOJE — sete dias cheios terminando no
 * fim de hoje, e não "168 horas atrás". Quem olha o painel às 9h da manhã
 * espera ver a semana, não um pedaço dela.
 */
export function intervaloDoPreset(preset: PresetPeriodo, agora: number): Intervalo {
  const hoje = inicioDoDia(agora)
  const amanha = hoje + DIA
  switch (preset) {
    case 'hoje':
      return { inicio: hoje, fim: amanha }
    case 'ontem':
      return { inicio: hoje - DIA, fim: hoje }
    case '7d':
      return { inicio: hoje - 6 * DIA, fim: amanha }
    case '15d':
      return { inicio: hoje - 14 * DIA, fim: amanha }
    case '30d':
      return { inicio: hoje - 29 * DIA, fim: amanha }
    case '3m':
      return { inicio: hoje - 89 * DIA, fim: amanha }
    case '6m':
      return { inicio: hoje - 179 * DIA, fim: amanha }
    case '1a':
      return { inicio: hoje - 364 * DIA, fim: amanha }
    case 'tudo':
      return { inicio: 0, fim: amanha }
  }
}

/**
 * O período imediatamente anterior, do mesmo tamanho — é contra ele que as
 * variações são medidas. "Tudo" não tem anterior: comparar com o vazio daria
 * sempre "+100%".
 */
export function intervaloAnterior(intervalo: Intervalo): Intervalo | null {
  if (intervalo.inicio <= 0) return null
  const duracao = intervalo.fim - intervalo.inicio
  return { inicio: intervalo.inicio - duracao, fim: intervalo.inicio }
}

export function dentroDoIntervalo(criadoEm: string, intervalo: Intervalo): boolean {
  const t = new Date(criadoEm).getTime()
  return t >= intervalo.inicio && t < intervalo.fim
}

export function filtrarPorIntervalo<T extends { criadoEm: string }>(pedidos: T[], intervalo: Intervalo): T[] {
  return pedidos.filter((p) => dentroDoIntervalo(p.criadoEm, intervalo))
}

/**
 * Variação percentual contra o período anterior.
 *
 * Devolve `null` quando não há base de comparação (anterior zerado): "+∞%" não
 * informa nada, e mostrar "+100%" quando se saiu de zero é mentira estatística.
 */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null
  return ((atual - anterior) / anterior) * 100
}

/** Texto curto da variação, já com o sinal. */
export function textoVariacao(pct: number | null): string | null {
  if (pct === null) return null
  const sinal = pct > 0 ? '+' : ''
  return `${sinal}${pct.toFixed(pct % 1 === 0 ? 0 : 2).replace('.', ',')}%`
}

/* ── Funil ──────────────────────────────────────────────────────────────── */

/**
 * A ordem por onde um pedido caminha. O banco guarda só o estado ATUAL, então
 * "chegou até a etapa X" é lido da posição: um pedido entregue passou por
 * preparando e pronto, mesmo sem registro de cada passagem.
 */
const ORDEM_STATUS: StatusPedido[] = ['recebido', 'preparando', 'pronto', 'em_rota', 'entregue']

export interface EtapaFunil {
  id: string
  rotulo: string
  descricao: string
  qtd: number
  /** Participação sobre a primeira etapa — é o que desenha o funil. */
  pct: number
  variacao: number | null
}

const ETAPAS: { id: StatusPedido; rotulo: string; descricao: string }[] = [
  { id: 'recebido', rotulo: 'Pedidos', descricao: 'chegaram no período' },
  { id: 'preparando', rotulo: 'Aceitos', descricao: 'entraram na cozinha' },
  { id: 'pronto', rotulo: 'Prontos', descricao: 'saíram da cozinha' },
  { id: 'em_rota', rotulo: 'Em rota', descricao: 'saíram para entrega' },
  { id: 'entregue', rotulo: 'Entregues', descricao: 'concluíram o pedido' },
]

function alcancou(status: StatusPedido, etapa: StatusPedido): boolean {
  const i = ORDEM_STATUS.indexOf(status)
  const alvo = ORDEM_STATUS.indexOf(etapa)
  if (i < 0 || alvo < 0) return false
  return i >= alvo
}

/**
 * Quantos pedidos chegaram a cada etapa, com a variação contra o período
 * anterior. Pedido cancelado não entra — ele não é uma etapa, é uma saída, e
 * misturá-lo faria o funil "crescer" no meio.
 */
export function funilDePedidos(pedidos: PedidoDashboard[], anteriores: PedidoDashboard[] = []): EtapaFunil[] {
  const conta = (lista: PedidoDashboard[], etapa: StatusPedido) =>
    lista.filter((p) => p.status !== 'cancelado' && alcancou(p.status, etapa)).length
  const base = conta(pedidos, 'recebido')
  return ETAPAS.map((e) => {
    const qtd = conta(pedidos, e.id)
    return {
      id: e.id,
      rotulo: e.rotulo,
      descricao: e.descricao,
      qtd,
      pct: base ? Math.round((qtd / base) * 100) : 0,
      variacao: variacao(qtd, conta(anteriores, e.id)),
    }
  })
}

/* ── Clientes novos × recorrentes ───────────────────────────────────────── */

export interface RecorteDeClientes {
  total: number
  novos: number
  recorrentes: number
  /** Percentual de novos sobre o total, arredondado. */
  pctNovos: number
  pctRecorrentes: number
}

/**
 * Quem é novo e quem já voltou.
 *
 * "Novo" é quem fez o PRIMEIRO pedido da vida dentro do período — por isso a
 * função precisa do histórico inteiro, não só da janela. Sem isso, todo cliente
 * pareceria novo em qualquer recorte curto.
 *
 * Pedido sem cliente identificado (balcão, mesa sem cadastro) não vira cliente:
 * seria contado como um cliente novo diferente a cada pedido.
 */
export function recorteDeClientes(pedidos: PedidoDashboard[], historico: PedidoDashboard[], intervalo: Intervalo): RecorteDeClientes {
  const primeiroPedido = new Map<string, number>()
  for (const p of historico) {
    if (!p.clienteChave) continue
    const t = new Date(p.criadoEm).getTime()
    const atual = primeiroPedido.get(p.clienteChave)
    if (atual === undefined || t < atual) primeiroPedido.set(p.clienteChave, t)
  }

  const noPeriodo = new Set<string>()
  for (const p of pedidos) if (p.clienteChave) noPeriodo.add(p.clienteChave)

  let novos = 0
  for (const id of noPeriodo) {
    const primeiro = primeiroPedido.get(id)
    if (primeiro !== undefined && primeiro >= intervalo.inicio && primeiro < intervalo.fim) novos++
  }
  const total = noPeriodo.size
  const recorrentes = total - novos
  return {
    total,
    novos,
    recorrentes,
    pctNovos: total ? Math.round((novos / total) * 100) : 0,
    pctRecorrentes: total ? Math.round((recorrentes / total) * 100) : 0,
  }
}

/* ── Série temporal ─────────────────────────────────────────────────────── */

export interface PontoSerie {
  /** Início do balde, em ms — é dele que sai o rótulo do eixo. */
  ms: number
  total: number
  novos: number
  recorrentes: number
  receita: number
}

/**
 * A série que alimenta o gráfico de linhas, um ponto por dia.
 *
 * Períodos longos viram baldes maiores para a linha não virar um pente: acima
 * de 60 dias o passo é semanal. O eixo continua honesto porque cada ponto
 * carrega o instante em que o balde começa.
 */
export function serieDePedidos(
  pedidos: PedidoDashboard[],
  historico: PedidoDashboard[],
  intervalo: Intervalo,
  agora: number,
): PontoSerie[] {
  const inicio = intervalo.inicio > 0 ? inicioDoDia(intervalo.inicio) : menorData(pedidos, agora)
  const fim = Math.min(intervalo.fim, inicioDoDia(agora) + DIA)
  const dias = Math.max(1, Math.ceil((fim - inicio) / DIA))
  const passo = dias > 60 ? 7 * DIA : DIA
  const baldes = Math.max(1, Math.ceil((fim - inicio) / passo))

  const primeiroPedido = new Map<string, number>()
  for (const p of historico) {
    if (!p.clienteChave) continue
    const t = new Date(p.criadoEm).getTime()
    const atual = primeiroPedido.get(p.clienteChave)
    if (atual === undefined || t < atual) primeiroPedido.set(p.clienteChave, t)
  }

  const pontos: PontoSerie[] = Array.from({ length: baldes }, (_, i) => ({
    ms: inicio + i * passo,
    total: 0,
    novos: 0,
    recorrentes: 0,
    receita: 0,
  }))

  for (const p of pedidos) {
    const t = new Date(p.criadoEm).getTime()
    const idx = Math.min(baldes - 1, Math.max(0, Math.floor((t - inicio) / passo)))
    const ponto = pontos[idx]
    ponto.total++
    ponto.receita += p.total
    if (!p.clienteChave) continue
    const primeiro = primeiroPedido.get(p.clienteChave)
    if (primeiro !== undefined && primeiro >= intervalo.inicio && primeiro < intervalo.fim) ponto.novos++
    else ponto.recorrentes++
  }

  return pontos
}

function menorData(pedidos: { criadoEm: string }[], agora: number): number {
  if (!pedidos.length) return inicioDoDia(agora)
  return inicioDoDia(Math.min(...pedidos.map((p) => new Date(p.criadoEm).getTime())))
}

/* ── Rótulos ────────────────────────────────────────────────────────────── */

const DATA_HORA = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * O texto do filtro, no formato da referência: "20/09/2026 00:00 ~ 26/09/2026
 * 23:59". O fim é exclusivo por dentro, mas quem lê espera ver o último minuto
 * do último dia — daí o `-1`.
 */
export function rotuloDoIntervalo(intervalo: Intervalo, agora: number): string {
  const inicio = intervalo.inicio > 0 ? intervalo.inicio : agora
  return `${DATA_HORA.format(new Date(inicio)).replace(',', '')} ~ ${DATA_HORA.format(new Date(intervalo.fim - 60_000)).replace(',', '')}`
}

/** `yyyy-mm-dd` em hora local — é o que o `<input type="date">` entende. */
export function paraCampoData(ms: number): string {
  const d = new Date(ms)
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mes}-${dia}`
}

/** Lê `yyyy-mm-dd` como meia-noite LOCAL (o construtor de Date leria como UTC). */
export function deCampoData(valor: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(d.getTime()) ? null : d.getTime()
}

/**
 * Intervalo a partir dos dois campos de data, com o fim empurrado para o fim do
 * dia escolhido. Datas invertidas são trocadas em vez de devolverem período
 * vazio — é erro de digitação, não intenção.
 */
export function intervaloDeCampos(de: string, ate: string): Intervalo | null {
  const a = deCampoData(de)
  const b = deCampoData(ate)
  if (a === null || b === null) return null
  const [inicio, fim] = a <= b ? [a, b] : [b, a]
  return { inicio, fim: fim + DIA }
}

/* ── Funil da vitrine ───────────────────────────────────────────────────── */

export interface EtapaFunilVitrine extends EtapaFunil {
  /** Participação da etapa SEGUINTE — é onde a rampa do bloco termina. */
  pctProxima: number
  /** Participação da mesma etapa no período anterior, para o rodapé. */
  pctAnterior: number | null
  /** Visitantes por dia, para o minigráfico. */
  serie: number[]
}

const ETAPAS_VITRINE_ROTULO: { id: 'visita' | 'visualizacao' | 'sacola' | 'checkout' | 'pedido'; rotulo: string; descricao: string }[] = [
  { id: 'visita', rotulo: 'Visitas', descricao: 'visitaram seu cardápio' },
  { id: 'visualizacao', rotulo: 'Visualizações', descricao: 'abriram algum item' },
  { id: 'sacola', rotulo: 'Sacola', descricao: 'adicionaram itens na sacola' },
  { id: 'checkout', rotulo: 'Checkout', descricao: 'iniciaram o checkout' },
  { id: 'pedido', rotulo: 'Pedidos', descricao: 'concluíram o pedido' },
]

/**
 * Dias do intervalo, como chaves `yyyy-mm-dd` locais. "Tudo" começa no dia
 * mais antigo com dado; o futuro não entra (a linha cairia a zero no fim).
 */
export function diasDoIntervalo(intervalo: Intervalo, agora: number, maisAntigo?: string): string[] {
  const inicio = intervalo.inicio > 0 ? inicioDoDia(intervalo.inicio) : maisAntigo ? deCampoData(maisAntigo) ?? inicioDoDia(agora) : inicioDoDia(agora)
  const fim = Math.min(intervalo.fim, inicioDoDia(agora) + DIA)
  const dias: string[] = []
  // Passo por data, não por +24h: o horário de verão deixaria um dia com 23h.
  const d = new Date(inicio)
  while (d.getTime() < fim && dias.length < 800) {
    dias.push(paraCampoData(d.getTime()))
    d.setDate(d.getDate() + 1)
  }
  return dias.length ? dias : [paraCampoData(inicioDoDia(agora))]
}

export function funilDaVitrine(
  dados: {
    funil: Record<string, number>
    funilAnterior: Record<string, number>
    porDia: { dia: string; tipo: string; qtd: number }[]
  },
  dias: string[],
): EtapaFunilVitrine[] {
  const base = dados.funil.visita || 0
  const baseAnt = dados.funilAnterior.visita || 0
  const pct = (q: number, b: number) => (b ? Math.round((q / b) * 100) : 0)
  return ETAPAS_VITRINE_ROTULO.map((e, i) => {
    const qtd = dados.funil[e.id] || 0
    const ant = dados.funilAnterior[e.id] || 0
    const proxima = ETAPAS_VITRINE_ROTULO[i + 1]
    const porDia = new Map(dados.porDia.filter((p) => p.tipo === e.id).map((p) => [p.dia, p.qtd]))
    return {
      id: e.id,
      rotulo: e.rotulo,
      descricao: e.descricao,
      qtd,
      pct: i === 0 ? (qtd ? 100 : 0) : pct(qtd, base),
      pctProxima: proxima ? pct(dados.funil[proxima.id] || 0, base) : pct(qtd, base),
      pctAnterior: baseAnt ? (i === 0 ? 100 : pct(ant, baseAnt)) : null,
      variacao: variacao(qtd, ant),
      serie: dias.map((d) => porDia.get(d) ?? 0),
    }
  })
}

/** "45s", "1min 24s", "38min", "1h 05min". */
export function formatarDuracao(segundos: number | null): string {
  if (segundos === null || !Number.isFinite(segundos)) return '—'
  const s = Math.max(0, Math.round(segundos))
  if (s < 60) return `${s}s`
  const min = Math.floor(s / 60)
  if (min < 10) return `${min}min ${s % 60}s`
  if (min < 60) return `${min}min`
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min`
}

/* ── Tempo de entrega ───────────────────────────────────────────────────── */

export interface ResumoEntrega {
  /** Da saída do motoboy até a entrega, em segundos. */
  rota: number | null
  /** Do pedido feito até a entrega, em segundos. */
  total: number | null
  amostra: number
}

/**
 * Tempos médios de entrega dos pedidos ENTREGUES dentro do intervalo. Rotas
 * acima de 4h são pedido esquecido "em rota" e baixado no dia seguinte — não
 * são entrega, e uma só puxaria a média para cima. Abaixo de 1 min também não
 * conta (saída sem entregador fecha o pedido na hora).
 */
export function resumoEntrega(
  tempos: { criadoEm: string; emRotaEm: string; entregueEm: string }[],
  intervalo: Intervalo,
): ResumoEntrega {
  let rota = 0
  let total = 0
  let n = 0
  for (const t of tempos) {
    const fim = new Date(t.entregueEm).getTime()
    if (fim < intervalo.inicio || fim >= intervalo.fim) continue
    const r = (fim - new Date(t.emRotaEm).getTime()) / 1000
    const tot = (fim - new Date(t.criadoEm).getTime()) / 1000
    // Menos de 1 min não é entrega: é a loja sem entregador (0079), que fecha o
    // pedido no mesmo toque da saída — contaria como entrega de segundos.
    if (r < 60 || r > 4 * 3600) continue
    rota += r
    total += Math.max(r, tot)
    n++
  }
  return { rota: n ? rota / n : null, total: n ? total / n : null, amostra: n }
}
