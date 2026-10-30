/**
 * Base do card Requisições do Super Admin (30/10/2026): em cada um dos últimos 7 dias COMPLETOS, a média da hora mais
 * movimentada; depois a média desses picos. É a referência do que é normal no horário forte. Pura.
 */
const LEITURAS_MINIMAS_POR_HORA = 3
const JANELA_DIAS = 7

const partes = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((x) => [x.type, x.value]))
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: p.hour }
}

export function picoMedioDiario(leituras: { em: string; req: number | null }[], agora = new Date()): { media: number; dias: number } | null {
  const hoje = partes(agora).dia
  const inicio = partes(new Date(Date.parse(`${hoje}T12:00:00Z`) - JANELA_DIAS * 86_400_000)).dia
  const porHora = new Map<string, { dia: string; soma: number; n: number }>()
  for (const l of leituras) {
    const v = Number(l.req)
    if (l.req == null || !Number.isFinite(v)) continue
    const { dia, hora } = partes(new Date(l.em))
    if (dia >= hoje || dia < inicio) continue
    const chave = `${dia} ${hora}`
    const h = porHora.get(chave) ?? { dia, soma: 0, n: 0 }
    h.soma += v; h.n += 1
    porHora.set(chave, h)
  }
  const picoDoDia = new Map<string, number>()
  for (const h of porHora.values()) {
    if (h.n < LEITURAS_MINIMAS_POR_HORA) continue
    picoDoDia.set(h.dia, Math.max(picoDoDia.get(h.dia) ?? 0, h.soma / h.n))
  }
  if (!picoDoDia.size) return null
  return { media: [...picoDoDia.values()].reduce((s, v) => s + v, 0) / picoDoDia.size, dias: picoDoDia.size }
}
