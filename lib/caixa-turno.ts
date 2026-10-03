/**
 * Turno de caixa (0114) — regras puras, sem banco.
 *
 * O período do fechamento é o TURNO: da abertura até o fechamento, mesmo passando da
 * meia-noite. Todo pedido e todo pagamento pertence ao turno que estava aberto no
 * instante em que aconteceu (entrega do pedido; registro do pagamento). O que aconteceu
 * com o caixa fechado fica "fora de turno" — aparece, nunca some.
 *
 * Antes: o fechamento do entregador somava TODO o histórico (não zerava depois de
 * registrar) e contava a nota do cliente (`troco_para`) como troco levado.
 */
import { trocoALevar } from './troco'

export interface Turno {
  id: string
  abertoEm: string
  fechadoEm: string | null
}

export interface PedidoCaixa {
  id: string
  entregadorId: string | null
  entregadorNome?: string
  total: number
  trocoPara: number | null
  formaPagamento: string
  status: string
  /** Quando foi entregue (o dinheiro entra na mão do entregador). */
  entregueEm: string | null
}

export interface FechamentoEntregador {
  entregadorId: string
  turnoId: string | null
  fechadoEm: string
  valorEsperado: number
  valorDeclarado: number
}

export interface PagamentoCaixa {
  forma: string
  valor: number
  criadoEm: string
  estornado: boolean
}

const ms = (iso: string) => Date.parse(iso)
const centavos = (v: number) => Math.round(v * 100) / 100

/** Turno aberto no instante (aberto_em ≤ t < fechado_em). */
export function turnoDoInstante<T extends Turno>(turnos: T[], instante: string | null | undefined): T | null {
  if (!instante) return null
  const t = ms(instante)
  return turnos.find((x) => ms(x.abertoEm) <= t && (x.fechadoEm === null || t < ms(x.fechadoEm))) ?? null
}

export interface LinhaEntregador {
  entregadorId: string
  nome: string
  /** Dinheiro que o entregador tem que devolver: soma dos totais em dinheiro entregues. */
  valorEsperado: number
  /** Troco que ele precisou levar para esses pedidos (nota do cliente − total). */
  trocoLevado: number
  pedidos: number
  /** Pedidos em dinheiro ainda em rota (o dinheiro ainda não entrou). */
  emRota: number
  /** Entrega mais antiga ainda sem acerto (para o alerta de "dinheiro a acertar"). */
  maisAntigaEm?: string | null
}

/**
 * O que cada entregador tem para acertar NESTE turno: pedidos em dinheiro entregues
 * dentro do turno e depois do último fechamento dele no mesmo turno (fechou no meio do
 * turno e continuou rodando: o segundo fechamento só pega o que veio depois).
 */
export function acertoDosEntregadores(turno: Turno, pedidos: PedidoCaixa[], fechamentos: FechamentoEntregador[]): LinhaEntregador[] {
  const mapa = new Map<string, LinhaEntregador>()
  const linha = (p: PedidoCaixa) => {
    const id = p.entregadorId as string
    const atual = mapa.get(id) ?? { entregadorId: id, nome: p.entregadorNome ?? 'Entregador', valorEsperado: 0, trocoLevado: 0, pedidos: 0, emRota: 0 }
    mapa.set(id, atual)
    return atual
  }
  const ultimoFechamento = (entregadorId: string) =>
    fechamentos
      .filter((f) => f.entregadorId === entregadorId && f.turnoId === turno.id)
      .reduce<number | null>((m, f) => (m === null || ms(f.fechadoEm) > m ? ms(f.fechadoEm) : m), null)

  for (const p of pedidos) {
    if (!p.entregadorId || p.formaPagamento !== 'dinheiro') continue
    if (p.status === 'em_rota') {
      linha(p).emRota += 1
      continue
    }
    if (p.status !== 'entregue' || turnoDoInstante([turno], p.entregueEm)?.id !== turno.id) continue
    const corte = ultimoFechamento(p.entregadorId)
    if (corte !== null && ms(p.entregueEm as string) <= corte) continue
    const l = linha(p)
    l.valorEsperado = centavos(l.valorEsperado + Number(p.total))
    l.trocoLevado = centavos(l.trocoLevado + trocoALevar(Number(p.total), p.trocoPara))
    l.pedidos += 1
  }
  return [...mapa.values()].filter((l) => l.pedidos > 0 || l.emRota > 0)
}

export interface ResumoTurno {
  turnoId: string
  abertoEm: string
  fechadoEm: string | null
  entregasEmDinheiro: number
  dinheiroEsperado: number
  dinheiroDeclarado: number
  diferenca: number
  pagamentosPorForma: Record<string, number>
}

/** Totais de um turno: entregas em dinheiro, fechamentos registrados e pagamentos do salão/balcão. */
export function resumoDoTurno(turno: Turno, pedidos: PedidoCaixa[], fechamentos: FechamentoEntregador[], pagamentos: PagamentoCaixa[]): ResumoTurno {
  const dentro = (iso: string | null) => turnoDoInstante([turno], iso)?.id === turno.id
  const entregas = pedidos.filter((p) => p.formaPagamento === 'dinheiro' && p.status === 'entregue' && p.entregadorId && dentro(p.entregueEm))
  const fech = fechamentos.filter((f) => f.turnoId === turno.id)
  const pagamentosPorForma: Record<string, number> = {}
  for (const pg of pagamentos) {
    if (pg.estornado || !dentro(pg.criadoEm)) continue
    pagamentosPorForma[pg.forma] = centavos((pagamentosPorForma[pg.forma] ?? 0) + Number(pg.valor))
  }
  const dinheiroDeclarado = centavos(fech.reduce((s, f) => s + Number(f.valorDeclarado), 0))
  const esperadoFechado = centavos(fech.reduce((s, f) => s + Number(f.valorEsperado), 0))
  return {
    turnoId: turno.id,
    abertoEm: turno.abertoEm,
    fechadoEm: turno.fechadoEm,
    entregasEmDinheiro: entregas.length,
    dinheiroEsperado: centavos(entregas.reduce((s, p) => s + Number(p.total), 0)),
    dinheiroDeclarado,
    diferenca: centavos(dinheiroDeclarado - esperadoFechado),
    pagamentosPorForma,
  }
}

/** Dia (America/Sao_Paulo, "AAAA-MM-DD") de um instante. */
export function diaSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

export interface ResumoDiario {
  dia: string
  turnos: ResumoTurno[]
  entregasEmDinheiro: number
  dinheiroEsperado: number
  dinheiroDeclarado: number
  diferenca: number
  pagamentosPorForma: Record<string, number>
  /** Entregas em dinheiro do dia que aconteceram com o caixa fechado. */
  foraDeTurno: number
}

/**
 * Resumo do dia = soma dos turnos ABERTOS naquele dia (em São Paulo). O turno que começa
 * às 18h e fecha às 2h conta inteiro no dia em que abriu — não é partido na meia-noite.
 */
export function resumoDoDia(dia: string, turnos: Turno[], pedidos: PedidoCaixa[], fechamentos: FechamentoEntregador[], pagamentos: PagamentoCaixa[]): ResumoDiario {
  const doDia = turnos.filter((t) => diaSaoPaulo(t.abertoEm) === dia).sort((a, b) => ms(a.abertoEm) - ms(b.abertoEm))
  const resumos = doDia.map((t) => resumoDoTurno(t, pedidos, fechamentos, pagamentos))
  const pagamentosPorForma: Record<string, number> = {}
  for (const r of resumos) for (const [f, v] of Object.entries(r.pagamentosPorForma)) pagamentosPorForma[f] = centavos((pagamentosPorForma[f] ?? 0) + v)
  const foraDeTurno = pedidos.filter((p) =>
    p.formaPagamento === 'dinheiro' && p.status === 'entregue' && p.entregadorId && p.entregueEm
    && diaSaoPaulo(p.entregueEm) === dia && !turnoDoInstante(turnos, p.entregueEm)).length
  const soma = (k: 'entregasEmDinheiro' | 'dinheiroEsperado' | 'dinheiroDeclarado' | 'diferenca') => centavos(resumos.reduce((s, r) => s + r[k], 0))
  return {
    dia,
    turnos: resumos,
    entregasEmDinheiro: soma('entregasEmDinheiro'),
    dinheiroEsperado: soma('dinheiroEsperado'),
    dinheiroDeclarado: soma('dinheiroDeclarado'),
    diferenca: soma('diferenca'),
    pagamentosPorForma,
    foraDeTurno,
  }
}

/**
 * Financeiro ligado (0135): o dinheiro "a acertar" de cada motoboy NÃO depende de caixa aberto.
 * Vale toda entrega em dinheiro dele depois do ÚLTIMO acerto (de qualquer turno). Quem abrir o caixa
 * vê tudo e o acerto entra no turno de quem acertar.
 */
export function acertoPendente(pedidos: PedidoCaixa[], fechamentos: FechamentoEntregador[]): LinhaEntregador[] {
  const mapa = new Map<string, LinhaEntregador>()
  const corte = new Map<string, number>()
  for (const f of fechamentos) corte.set(f.entregadorId, Math.max(corte.get(f.entregadorId) ?? 0, ms(f.fechadoEm)))
  for (const p of pedidos) {
    if (!p.entregadorId || p.formaPagamento !== 'dinheiro') continue
    const l = mapa.get(p.entregadorId) ?? { entregadorId: p.entregadorId, nome: p.entregadorNome ?? 'Entregador', valorEsperado: 0, trocoLevado: 0, pedidos: 0, emRota: 0, maisAntigaEm: null }
    mapa.set(p.entregadorId, l)
    if (p.status === 'em_rota') { l.emRota += 1; continue }
    if (p.status !== 'entregue' || !p.entregueEm) continue
    if (ms(p.entregueEm) <= (corte.get(p.entregadorId) ?? 0)) continue
    l.valorEsperado = centavos(l.valorEsperado + Number(p.total))
    l.trocoLevado = centavos(l.trocoLevado + trocoALevar(Number(p.total), p.trocoPara))
    l.pedidos += 1
    if (!l.maisAntigaEm || ms(p.entregueEm) < ms(l.maisAntigaEm)) l.maisAntigaEm = p.entregueEm
  }
  return [...mapa.values()].filter((l) => l.pedidos > 0 || l.emRota > 0)
}
