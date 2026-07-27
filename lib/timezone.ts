// Helpers de data/hora fixados em America/Sao_Paulo — todo o sistema roda nesse fuso,
// independente do fuso do servidor (Coolify/Vercel podem rodar em UTC).

export interface HorarioDia {
  abre: string // "HH:MM"
  fecha: string // "HH:MM"
}

/**
 * Grade semanal de funcionamento: chave = dia da semana (0=domingo..6=sábado), lista de
 * turnos do dia. `null` ou lista vazia = fechado nesse dia. Dois turnos permitem, por
 * exemplo, marmita no almoço e pizza à noite com a loja fechada no vão da tarde.
 *
 * Linhas antigas no banco guardam um objeto único em vez da lista — leia sempre por
 * `turnosDoDia`, nunca acessando `grade[dia]` direto.
 */
export type HorarioFuncionamento = Record<string, HorarioDia[] | null>

/**
 * Turnos de um dia, tolerando o formato legado (um único objeto `{abre, fecha}` por dia,
 * usado antes dos turnos múltiplos existirem).
 *
 * Essa tolerância é permanente e NÃO deve ser trocada por uma migration que converta o
 * dado. Uma conversão dessas coloca o schema à frente do código: o código antigo lê o
 * array como se fosse o intervalo, `abre`/`fecha` viram undefined e a loja passa a
 * aparecer fechada até o deploy chegar. Já aconteceu em produção — ler os dois formatos
 * sai de graça, converter o dado não traz nada.
 */
export function turnosDoDia(grade: HorarioFuncionamento | null, dia: number): HorarioDia[] {
  if (!grade) return []
  const valor = grade[String(dia)] as unknown
  if (!valor) return []
  const lista = Array.isArray(valor) ? valor : [valor as HorarioDia]
  return lista.filter((t): t is HorarioDia => Boolean(t?.abre && t?.fecha))
}

export type StatusLoja = 'automatico' | 'aberto_manual' | 'fechado_manual'

/** Dia da semana (0=dom..6=sáb) de um timestamp ISO, calculado em America/Sao_Paulo. */
export function diaSemanaSaoPaulo(isoDate: string): number {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(new Date(isoDate))
  const mapa: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return mapa[weekday] ?? new Date(isoDate).getDay()
}

/** Hora atual em America/Sao_Paulo, formato "HH:MM". */
export function horaAtualSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

/**
 * true se `hora` (HH:MM) cai dentro de [inicio, fim). `fim` menor que `inicio` significa
 * que o intervalo atravessa a meia-noite (ex: 18:00–02:00, pizzaria que vira a noite).
 * `inicio` igual a `fim` = 24 horas.
 */
export function horaDentroDoIntervalo(hora: string, inicio: string, fim: string): boolean {
  if (inicio === fim) return true
  if (inicio < fim) return hora >= inicio && hora < fim
  return hora >= inicio || hora < fim
}

/** Parte do turno que corre no próprio dia em que ele começa. */
function turnoCorrendoNoDiaDeInicio(hora: string, turno: HorarioDia): boolean {
  if (turno.abre < turno.fecha) return hora >= turno.abre && hora < turno.fecha
  return hora >= turno.abre // atravessa a meia-noite: daqui até 23:59 é o dia de início
}

/** Parte do turno que já virou o dia — só existe em turno que atravessa a meia-noite. */
function turnoCorrendoNoDiaSeguinte(hora: string, turno: HorarioDia): boolean {
  if (turno.abre < turno.fecha) return false
  return hora < turno.fecha
}

/**
 * Calcula se a loja está aberta agora, considerando o override manual (que prevalece
 * até ser revertido) e, no modo automático, a grade semanal de funcionamento.
 * Loja que nunca configurou grade nenhuma (`horarioFuncionamento` null) = sempre aberta —
 * preserva o comportamento de antes dessa feature existir (não pode fechar loja existente
 * sozinha assim que a migration for pro ar). Só um dia específico *dentro* de uma grade já
 * configurada, sem intervalo, é que conta como fechado nesse dia.
 */
export function lojaEstaAberta(restaurante: {
  statusLoja: StatusLoja
  horarioFuncionamento: HorarioFuncionamento | null
}): boolean {
  if (restaurante.statusLoja === 'aberto_manual') return true
  if (restaurante.statusLoja === 'fechado_manual') return false

  const grade = restaurante.horarioFuncionamento
  if (!grade) return true

  const hoje = diaSemanaSaoPaulo(new Date().toISOString())
  const hora = horaAtualSaoPaulo()

  if (turnosDoDia(grade, hoje).some((t) => turnoCorrendoNoDiaDeInicio(hora, t))) return true

  // Um turno de ontem que atravessa a meia-noite ainda pode estar correndo agora — sem
  // isso, uma loja aberta segunda 18:00–02:00 fecharia à meia-noite de segunda pra terça.
  const ontem = (hoje + 6) % 7
  return turnosDoDia(grade, ontem).some((t) => turnoCorrendoNoDiaSeguinte(hora, t))
}

/**
 * Próximo turno que ainda vai abrir, varrendo até 7 dias à frente. `null` = grade sem
 * nenhum turno configurado. Não considera o override manual: quem chama decide se faz
 * sentido mostrar (loja travada fechada não tem próxima abertura previsível).
 */
export function proximaAbertura(
  grade: HorarioFuncionamento | null
): { diaSemana: number; hora: string } | null {
  if (!grade) return null

  const hoje = diaSemanaSaoPaulo(new Date().toISOString())
  const agora = horaAtualSaoPaulo()

  for (let offset = 0; offset < 7; offset++) {
    const dia = (hoje + offset) % 7
    const turnos = [...turnosDoDia(grade, dia)].sort((a, b) => a.abre.localeCompare(b.abre))
    for (const turno of turnos) {
      if (offset > 0 || turno.abre > agora) return { diaSemana: dia, hora: turno.abre }
    }
  }
  return null
}

const DIAS_SEMANA_NOME = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

/**
 * Texto curto de próxima abertura para a vitrine ("abre às 18:00", "abre amanhã às
 * 11:00", "abre sábado às 11:00"). `null` quando não há previsão: loja travada fechada
 * pelo operador, ou grade sem nenhum turno.
 */
export function textoProximaAbertura(restaurante: {
  statusLoja: StatusLoja
  horarioFuncionamento: HorarioFuncionamento | null
}): string | null {
  if (restaurante.statusLoja === 'fechado_manual') return null

  const proxima = proximaAbertura(restaurante.horarioFuncionamento)
  if (!proxima) return null

  const hoje = diaSemanaSaoPaulo(new Date().toISOString())
  if (proxima.diaSemana === hoje) return `abre às ${proxima.hora}`
  if (proxima.diaSemana === (hoje + 1) % 7) return `abre amanhã às ${proxima.hora}`
  return `abre ${DIAS_SEMANA_NOME[proxima.diaSemana]} às ${proxima.hora}`
}

/** true se o grupo (categoria) está ativo agora — sem horário configurado = sempre ativo. */
export function grupoEstaAtivoAgora(grupo: { horarioAtivoInicio: string | null; horarioAtivoFim: string | null }): boolean {
  if (!grupo.horarioAtivoInicio || !grupo.horarioAtivoFim) return true
  return horaDentroDoIntervalo(horaAtualSaoPaulo(), grupo.horarioAtivoInicio, grupo.horarioAtivoFim)
}

/** true se o item está disponível no dia da semana atual (SP). Sem dias configurados = nunca disponível. */
export function itemDisponivelHoje(diasDisponiveis: number[]): boolean {
  return diasDisponiveis.includes(diaSemanaSaoPaulo(new Date().toISOString()))
}
