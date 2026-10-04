import { turnosDoDia, type HorarioFuncionamento, type StatusLoja } from '@/lib/timezone'

/**
 * Vigia do financeiro (Fase 6): regras puras dos alertas por varredura (cron).
 */

/** Minutos desde que a loja abriu no turno corrente da grade (null = fechada agora, sem grade ou status manual). */
export function minutosDesdeAbertura(p: { statusLoja: StatusLoja; grade: HorarioFuncionamento | null; dia: number; hora: string }): number | null {
  if (p.statusLoja !== 'automatico' || !p.grade) return null
  const min = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5))
  const agora = min(p.hora)
  for (const t of turnosDoDia(p.grade, p.dia)) {
    const a = min(t.abre), f = min(t.fecha)
    if (a < f ? agora >= a && agora < f : agora >= a) return agora - a
  }
  const ontem = (p.dia + 6) % 7
  for (const t of turnosDoDia(p.grade, ontem)) {
    const a = min(t.abre), f = min(t.fecha)
    if (a >= f && agora < f) return 24 * 60 - a + agora
  }
  return null
}

/** Desconto da conta passa do limite da loja (percentual OU valor)? */
export function descontoAlto(p: { descontoCentavos: number; subtotalCentavos: number; limitePct: number; limiteCentavos: number }): boolean {
  if (p.descontoCentavos <= 0) return false
  const pct = p.subtotalCentavos > 0 ? (p.descontoCentavos / p.subtotalCentavos) * 100 : 100
  return pct > p.limitePct || p.descontoCentavos > p.limiteCentavos
}

/** Horas desde um instante. */
export function horasDesde(iso: string, agora = Date.now()): number {
  return (agora - Date.parse(iso)) / 3_600_000
}
