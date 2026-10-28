import { getAdminSupabase } from '@/lib/supabase/admin'

/**
 * Batida e trava dos crons (28/10/2026, varredura Etapas 6 e 7).
 *  · baterCron: grava "rodei agora" em sistema_cron_batidas (0229) — o vigia avisa quando um cron para de rodar.
 *    Nunca derruba o cron (falha só vai para o log).
 *  · umaPorVez: se o Coolify disparar o mesmo cron de novo enquanto o anterior ainda roda (rodada lenta, banco lento),
 *    a segunda chamada sai sem fazer nada — sem isso, entregas/Pix/horário rodariam em dobro ao mesmo tempo.
 *    Em memória do processo: o app roda em um container só.
 */
export async function baterCron(nome: string): Promise<void> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return
  const { error } = await getAdminSupabase().from('sistema_cron_batidas').upsert({ nome, ultima_em: new Date().toISOString() })
  if (error) console.error(`[cron ${nome}] batida não gravada:`, error.message)
}

const rodando = new Set<string>()

export async function umaPorVez<T>(nome: string, fn: () => Promise<T>): Promise<T | { pulou: 'ainda rodando' }> {
  if (rodando.has(nome)) return { pulou: 'ainda rodando' }
  rodando.add(nome)
  try {
    return await fn()
  } finally {
    rodando.delete(nome)
  }
}
