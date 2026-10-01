import type { SupabaseClient } from '@supabase/supabase-js'
import { avaliarTodasAsLojas, processarAvulsas, type ResumoAvaliacao } from './motor'
import { processarFilaPush, pushConfigurado, type ResumoFila } from './envio'

/** Um ciclo do push: avulsas vencidas → automações (trava de 10 min por loja) → fila. */
export async function cicloPush(admin: SupabaseClient, opcoes: { forcar?: boolean } = {}): Promise<{ avulsas: number; lojas: ResumoAvaliacao[]; fila: ResumoFila } | { desligado: true }> {
  if (!pushConfigurado() && process.env.PUSH_PROVEDOR !== 'simulado') return { desligado: true }
  const avulsas = await processarAvulsas(admin)
  const lojas = await avaliarTodasAsLojas(admin, opcoes)
  const fila = await processarFilaPush(admin, { limite: 300 })
  return { avulsas, lojas, fila }
}
