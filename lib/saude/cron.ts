import { getAdminSupabase } from '@/lib/supabase/admin'

/**
 * Batida e trava dos crons (28/10/2026, varredura Etapas 6 e 7).
 *  · baterCron: grava "rodei" em sistema_cron_batidas (0229) — o vigia avisa quando um cron para de rodar. No máximo 1
 *    gravação a cada 5 min por cron (auditoria 28/10: 1 por minuto em 9 crons eram 540 gravações/h). Nunca derruba o cron.
 *  · umaPorVez: se o Coolify disparar o mesmo cron de novo enquanto o anterior ainda roda, a segunda sai sem fazer nada.
 *    Rodada que trava (chamada externa que nunca responde) solta a trava sozinha depois de 10 min — antes ficava presa até
 *    reiniciar o app e o Pix/entregas paravam. Em memória do processo: o app roda em um container só.
 */
export const BATIDA_INTERVALO_MS = 5 * 60_000
const ultimaBatida = new Map<string, number>()

/** Está na hora de gravar a batida deste cron? Registra a de agora. Pura sobre o mapa. */
export function batidaDevida(mapa: Map<string, number>, nome: string, agora: number): boolean {
  const antes = mapa.get(nome)
  if (antes !== undefined && agora - antes < BATIDA_INTERVALO_MS) return false
  mapa.set(nome, agora)
  return true
}

export async function baterCron(nome: string): Promise<void> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return
  if (!batidaDevida(ultimaBatida, nome, Date.now())) return
  const { error } = await getAdminSupabase().from('sistema_cron_batidas').upsert({ nome, ultima_em: new Date().toISOString() })
  if (error) console.error(`[cron ${nome}] batida não gravada:`, error.message)
}

export const TRAVA_MAX_MS = 10 * 60_000
const rodando = new Map<string, { desde: number; id: symbol }>()

export async function umaPorVez<T>(nome: string, fn: () => Promise<T>, relogio: () => number = Date.now): Promise<T | { pulou: 'ainda rodando' }> {
  const agora = relogio()
  const atual = rodando.get(nome)
  if (atual && agora - atual.desde < TRAVA_MAX_MS) return { pulou: 'ainda rodando' }
  if (atual) console.error(`[cron ${nome}] rodada anterior travada há ${Math.round((agora - atual.desde) / 60_000)} min — liberando`)
  const id = Symbol(nome)
  rodando.set(nome, { desde: agora, id })
  try {
    return await fn()
  } finally {
    // Só solta a própria trava: uma rodada travada que termina tarde não solta a da rodada nova.
    if (rodando.get(nome)?.id === id) rodando.delete(nome)
  }
}
