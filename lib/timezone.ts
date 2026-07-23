// Helpers de data/hora fixados em America/Sao_Paulo — todo o sistema roda nesse fuso,
// independente do fuso do servidor (Coolify/Vercel podem rodar em UTC).

export interface HorarioDia {
  abre: string // "HH:MM"
  fecha: string // "HH:MM"
}

/** Grade semanal de funcionamento: chave = dia da semana (0=domingo..6=sábado), null = fechado nesse dia. */
export type HorarioFuncionamento = Record<string, HorarioDia | null>

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

/** true se `hora` (HH:MM) cai dentro de [inicio, fim), sem suporte a intervalo que cruza a meia-noite. */
export function horaDentroDoIntervalo(hora: string, inicio: string, fim: string): boolean {
  return hora >= inicio && hora < fim
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

  const dia = diaSemanaSaoPaulo(new Date().toISOString())
  const intervalo = grade[String(dia)]
  if (!intervalo) return false

  return horaDentroDoIntervalo(horaAtualSaoPaulo(), intervalo.abre, intervalo.fecha)
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
