/**
 * Agenda da promoção (0130). Quando o preço promocional do item vale.
 *
 * Tudo vazio = vale sempre (comportamento de antes). Datas (início/fim, inclusive), dias
 * da semana e faixa de horário se somam: precisa cumprir todos os que estiverem
 * preenchidos. Faixa que passa da meia-noite (18:00–02:00) vale; nesse caso o dia da
 * semana é o do começo da faixa. Horário da loja: America/Sao_Paulo.
 */
export interface AgendaPromocao {
  promocaoInicio?: string | null // 'YYYY-MM-DD'
  promocaoFim?: string | null
  promocaoDias?: number[] | null // 0 = domingo
  promocaoHoraInicio?: string | null // 'HH:MM' ou 'HH:MM:SS'
  promocaoHoraFim?: string | null
}

const TZ = 'America/Sao_Paulo'

function partesSP(agora: Date) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(agora).map((x) => [x.type, x.value]))
  const dias: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { data: `${p.year}-${p.month}-${p.day}`, minutos: Number(p.hour) * 60 + Number(p.minute), dia: dias[p.weekday as string] ?? 0 }
}

function minutos(h: string): number {
  const [a, b] = h.split(':').map(Number)
  return (a || 0) * 60 + (b || 0)
}

function diaAnterior(data: string): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export function temAgenda(a: AgendaPromocao): boolean {
  return !!(a.promocaoInicio || a.promocaoFim || (a.promocaoDias && a.promocaoDias.length) || (a.promocaoHoraInicio && a.promocaoHoraFim))
}

export function promocaoVigente(a: AgendaPromocao, agora: Date = new Date()): boolean {
  if (!temAgenda(a)) return true
  const sp = partesSP(agora)
  let data = sp.data
  let dia = sp.dia
  if (a.promocaoHoraInicio && a.promocaoHoraFim) {
    const ini = minutos(a.promocaoHoraInicio)
    const fim = minutos(a.promocaoHoraFim)
    if (ini < fim) {
      if (sp.minutos < ini || sp.minutos >= fim) return false
    } else {
      // Passa da meia-noite: depois do início (hoje) ou antes do fim (conta como ontem).
      if (sp.minutos >= ini) { /* hoje */ } else if (sp.minutos < fim) { data = diaAnterior(sp.data); dia = (sp.dia + 6) % 7 } else return false
    }
  }
  if (a.promocaoDias && a.promocaoDias.length && !a.promocaoDias.includes(dia)) return false
  if (a.promocaoInicio && data < a.promocaoInicio) return false
  if (a.promocaoFim && data > a.promocaoFim) return false
  return true
}

/** Resumo curto para a tela ("Sex e Sáb, 18:00–23:00, até 31/10"). */
export function resumoAgenda(a: AgendaPromocao): string {
  if (!temAgenda(a)) return 'Sempre'
  const N = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
  const partes: string[] = []
  if (a.promocaoDias && a.promocaoDias.length && a.promocaoDias.length < 7) partes.push([...a.promocaoDias].sort().map((d) => N[d]).join(', '))
  if (a.promocaoHoraInicio && a.promocaoHoraFim) partes.push(`${a.promocaoHoraInicio.slice(0, 5)}–${a.promocaoHoraFim.slice(0, 5)}`)
  const br = (s: string) => s.split('-').reverse().slice(0, 2).join('/')
  if (a.promocaoInicio && a.promocaoFim) partes.push(`de ${br(a.promocaoInicio)} a ${br(a.promocaoFim)}`)
  else if (a.promocaoInicio) partes.push(`a partir de ${br(a.promocaoInicio)}`)
  else if (a.promocaoFim) partes.push(`até ${br(a.promocaoFim)}`)
  return partes.join(', ')
}

/** Agenda da promoção como vem do banco (0130). */
export function agendaDaLinha(row: { promocao_inicio?: string | null; promocao_fim?: string | null; promocao_dias?: number[] | null; promocao_hora_inicio?: string | null; promocao_hora_fim?: string | null }): AgendaPromocao {
  return {
    promocaoInicio: row.promocao_inicio ?? null,
    promocaoFim: row.promocao_fim ?? null,
    promocaoDias: row.promocao_dias ?? null,
    promocaoHoraInicio: row.promocao_hora_inicio ?? null,
    promocaoHoraFim: row.promocao_hora_fim ?? null,
  }
}
