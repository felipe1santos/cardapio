/**
 * Agendamento de pedidos (Fase 7, 2026-09-30) — regras puras, usadas pela vitrine (que
 * mostra os horários) e pelo servidor (que confere tudo de novo ao criar o pedido).
 *
 * Fuso: tudo em America/Sao_Paulo. O Brasil não tem horário de verão desde 2019, então o
 * horário escolhido vira instante com o deslocamento fixo -03:00.
 *
 * Desligado por padrão (0121). Com a loja aberta e `quando = 'fechada'`, nada muda: o
 * cliente pede para agora, como sempre.
 */
import { diaSemanaSaoPaulo, turnosDoDia, type HorarioFuncionamento } from './timezone'

export interface ConfigAgendamento {
  ativo: boolean
  /** 'fechada' = só aceita agendado com a loja fechada; 'sempre' = também com ela aberta. */
  quando: 'fechada' | 'sempre'
  dias: number
  antecedenciaMin: number
  intervaloMin: number
  /** Pedidos por horário. Null = sem limite. */
  limite: number | null
  entrega: boolean
  retirada: boolean
  /** Minutos antes do horário em que o pedido entra no Kanban/cozinha/impressão. */
  liberaMin: number
}

export const AGENDAMENTO_PADRAO: ConfigAgendamento = {
  ativo: false, quando: 'fechada', dias: 7, antecedenciaMin: 60, intervaloMin: 30, limite: null, entrega: true, retirada: true, liberaMin: 30,
}

export const INTERVALOS_AGENDAMENTO = [10, 15, 20, 30, 45, 60] as const

export const COLUNAS_AGENDAMENTO =
  'agendamento_ativo, agendamento_quando, agendamento_dias, agendamento_antecedencia_min, agendamento_intervalo_min, agendamento_limite, agendamento_entrega, agendamento_retirada, agendamento_libera_min'

/** Linha do banco → config. Coluna ausente (migration ainda não aplicada) = desligado. */
export function configAgendamento(row: Record<string, unknown> | null | undefined): ConfigAgendamento {
  if (!row || row.agendamento_ativo === undefined) return { ...AGENDAMENTO_PADRAO }
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    ativo: row.agendamento_ativo === true,
    quando: row.agendamento_quando === 'sempre' ? 'sempre' : 'fechada',
    dias: n(row.agendamento_dias, 7),
    antecedenciaMin: n(row.agendamento_antecedencia_min, 60),
    intervaloMin: n(row.agendamento_intervalo_min, 30),
    limite: typeof row.agendamento_limite === 'number' ? row.agendamento_limite : null,
    entrega: row.agendamento_entrega !== false,
    retirada: row.agendamento_retirada !== false,
    liberaMin: n(row.agendamento_libera_min, 30),
  }
}

/** Config → colunas do banco (Ajustes). */
export function colunasAgendamento(c: ConfigAgendamento): Record<string, unknown> {
  return {
    agendamento_ativo: c.ativo,
    agendamento_quando: c.quando,
    agendamento_dias: c.dias,
    agendamento_antecedencia_min: c.antecedenciaMin,
    agendamento_intervalo_min: c.intervaloMin,
    agendamento_limite: c.limite,
    agendamento_entrega: c.entrega,
    agendamento_retirada: c.retirada,
    agendamento_libera_min: c.liberaMin,
  }
}

/** Confere o que vem da tela de Ajustes. Devolve a mensagem de erro ou null. */
export function validarConfigAgendamento(c: ConfigAgendamento): string | null {
  if (!Number.isInteger(c.dias) || c.dias < 1 || c.dias > 30) return 'Dias à frente: de 1 a 30.'
  if (!Number.isInteger(c.antecedenciaMin) || c.antecedenciaMin < 0 || c.antecedenciaMin > 1440) return 'Antecedência mínima: de 0 a 1440 minutos.'
  if (!(INTERVALOS_AGENDAMENTO as readonly number[]).includes(c.intervaloMin)) return 'Intervalo entre horários inválido.'
  if (c.limite !== null && (!Number.isInteger(c.limite) || c.limite < 1 || c.limite > 999)) return 'Limite por horário: de 1 a 999 (ou vazio para sem limite).'
  if (!Number.isInteger(c.liberaMin) || c.liberaMin < 0 || c.liberaMin > 240) return 'Entrar no painel: de 0 a 240 minutos antes.'
  if (c.ativo && !c.entrega && !c.retirada) return 'Escolha entrega, retirada ou os dois.'
  return null
}

const SP_OFFSET = '-03:00'
const DIAS_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/** Data local de São Paulo ("2026-10-01") de um instante. */
export function dataSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Hora local de São Paulo ("19:30") de um instante. */
export function horaSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

/** Data + hora locais → instante ISO (UTC). */
export function instanteDoHorario(data: string, hora: string): string {
  return new Date(`${data}T${hora}:00${SP_OFFSET}`).toISOString()
}

function somaDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00${SP_OFFSET}`)
  d.setUTCDate(d.getUTCDate() + n)
  return dataSaoPaulo(d)
}

const paraMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
const paraHora = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/**
 * Janelas (em minutos do dia, [ini, fim)) em que a loja funciona numa data. Inclui a
 * "cauda" de um turno de ontem que atravessou a meia-noite. Sem grade = o dia todo.
 */
function janelasDoDia(grade: HorarioFuncionamento | null, data: string): [number, number][] {
  if (!grade) return [[0, 24 * 60]]
  const dia = diaSemanaSaoPaulo(`${data}T12:00:00${SP_OFFSET}`)
  const ontem = (dia + 6) % 7
  const out: [number, number][] = []
  for (const t of turnosDoDia(grade, dia)) {
    const a = paraMin(t.abre), f = paraMin(t.fecha)
    if (a === f) out.push([0, 24 * 60])
    else if (a < f) out.push([a, f])
    else out.push([a, 24 * 60])
  }
  for (const t of turnosDoDia(grade, ontem)) {
    const a = paraMin(t.abre), f = paraMin(t.fecha)
    if (a > f && f > 0) out.push([0, f])
  }
  return out
}

export interface DiaAgendamento {
  data: string // YYYY-MM-DD (São Paulo)
  rotulo: string // "Hoje", "Amanhã", "Sábado, 03/10"
  horarios: string[] // "19:30"
}

/**
 * Horários que o cliente pode escolher: dentro do funcionamento, a partir de agora +
 * antecedência, de `intervaloMin` em `intervaloMin` (alinhados ao início do turno), por
 * `dias` dias. `ocupacao` (instante ISO → pedidos) tira os horários lotados.
 */
export function horariosAgendamento(
  config: ConfigAgendamento,
  grade: HorarioFuncionamento | null,
  agora: Date = new Date(),
  ocupacao: Map<string, number> = new Map(),
): DiaAgendamento[] {
  const minimo = agora.getTime() + config.antecedenciaMin * 60_000
  const hoje = dataSaoPaulo(agora)
  const dias: DiaAgendamento[] = []
  for (let i = 0; i < config.dias; i++) {
    const data = somaDias(hoje, i)
    const set = new Set<string>()
    for (const [ini, fim] of janelasDoDia(grade, data)) {
      for (let m = ini; m < fim; m += config.intervaloMin) {
        const hora = paraHora(m)
        const iso = instanteDoHorario(data, hora)
        if (new Date(iso).getTime() < minimo) continue
        if (config.limite !== null && (ocupacao.get(iso) ?? 0) >= config.limite) continue
        set.add(hora)
      }
    }
    const horarios = [...set].sort()
    if (horarios.length) dias.push({ data, rotulo: rotuloDia(data, hoje), horarios })
  }
  return dias
}

function rotuloDia(data: string, hoje: string): string {
  if (data === hoje) return 'Hoje'
  if (data === somaDias(hoje, 1)) return 'Amanhã'
  const dia = diaSemanaSaoPaulo(`${data}T12:00:00${SP_OFFSET}`)
  const nome = DIAS_NOME[dia]
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${data.slice(8, 10)}/${data.slice(5, 7)}`
}

/** A vitrine oferece "Agendar"? (com a loja aberta só no modo 'sempre') */
export function podeAgendar(config: ConfigAgendamento, lojaAberta: boolean): boolean {
  return config.ativo && (config.entrega || config.retirada) && (!lojaAberta || config.quando === 'sempre')
}

/** Loja fechada mas aceitando agendado: a vitrine vende, só para depois. */
export function somenteAgendado(config: ConfigAgendamento, lojaAberta: boolean): boolean {
  return !lojaAberta && podeAgendar(config, lojaAberta)
}

/**
 * Confere no servidor o horário pedido. `canal` = 'entrega' | 'retirada'. Devolve a
 * mensagem para o cliente ou null (ok).
 */
export function motivoAgendamentoInvalido(
  config: ConfigAgendamento,
  grade: HorarioFuncionamento | null,
  agendadoPara: string,
  canal: 'entrega' | 'retirada',
  lojaAberta: boolean,
  agora: Date = new Date(),
  ocupacao: Map<string, number> = new Map(),
): string | null {
  if (!podeAgendar(config, lojaAberta)) return 'Esta loja não está aceitando pedidos agendados agora.'
  if (canal === 'entrega' && !config.entrega) return 'Agendamento não vale para entrega nesta loja.'
  if (canal === 'retirada' && !config.retirada) return 'Agendamento não vale para retirada nesta loja.'
  const t = new Date(agendadoPara)
  if (Number.isNaN(t.getTime())) return 'Horário de agendamento inválido.'
  const iso = t.toISOString()
  const data = dataSaoPaulo(t), hora = horaSaoPaulo(t)
  const dia = horariosAgendamento(config, grade, agora, ocupacao).find((d) => d.data === data)
  if (dia?.horarios.includes(hora) && instanteDoHorario(data, hora) === iso) return null
  if (config.limite !== null && (ocupacao.get(iso) ?? 0) >= config.limite) return 'Esse horário lotou. Escolha outro.'
  return 'Esse horário não está disponível. Escolha outro.'
}

/** O pedido agendado já entrou no fluxo (Kanban, cozinha, impressão)? Sem agendamento: sim. */
export function pedidoLiberado(agendadoPara: string | null | undefined, liberaMin: number, agora: Date = new Date()): boolean {
  if (!agendadoPara) return true
  return new Date(agendadoPara).getTime() - liberaMin * 60_000 <= agora.getTime()
}

/** "quinta, 02/10 às 19:30" */
export function textoAgendado(iso: string, agora: Date = new Date()): string {
  const t = new Date(iso)
  const data = dataSaoPaulo(t), hoje = dataSaoPaulo(agora)
  const hora = horaSaoPaulo(t)
  if (data === hoje) return `hoje às ${hora}`
  if (data === somaDias(hoje, 1)) return `amanhã às ${hora}`
  const dia = DIAS_NOME[diaSemanaSaoPaulo(iso)]
  return `${dia}, ${data.slice(8, 10)}/${data.slice(5, 7)} às ${hora}`
}

/**
 * Próxima abertura no formato do cartão da loja: "Abrimos hoje (domingo) às 13:00",
 * "Abrimos amanhã (segunda) às 11:00", "Abrimos sábado às 18:00". Null sem previsão.
 */
export function textoAbrimos(prox: { diaSemana: number; hora: string } | null, agora: Date = new Date()): string | null {
  if (!prox) return null
  const hoje = diaSemanaSaoPaulo(agora.toISOString())
  const nome = DIAS_NOME[prox.diaSemana]
  if (prox.diaSemana === hoje) return `Abrimos hoje (${nome}) às ${prox.hora}`
  if (prox.diaSemana === (hoje + 1) % 7) return `Abrimos amanhã (${nome}) às ${prox.hora}`
  return `Abrimos ${nome} às ${prox.hora}`
}
