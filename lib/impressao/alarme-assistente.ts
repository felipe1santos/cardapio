/**
 * Alarme de pedido novo pelo Assistente (12/10/2026, pedido do dono): um alarme só.
 *  - Assistente dono da Cozinha ONLINE (sinal < 30 s) e numa versão com alarme (1.2.0+) → só ele toca, por cima de tudo,
 *    mesmo com o navegador fechado; o painel fica só visual.
 *  - Offline, sem Assistente, versão antiga ou Villa (1.1.0, travada) → o painel toca como sempre. Na dúvida, o painel toca.
 * O Assistente fica sabendo pela MESMA consulta de pedidos que já faz (campo `alarme` na resposta): nenhuma rede nova
 * no ciclo de impressão (docs/impressao/REGRA-CICLO-SEM-REDE.md).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { listarRecebidosParaAlarme } from '@/lib/queries/pedidos'
import { destinoCozinha, ONLINE_SEGUNDOS } from './servico'

export const VERSAO_MIN_ALARME: [number, number, number] = [1, 2, 0]

/** "1.2.0"+ (sem pré-lançamento). beta.x e 1.1.x não têm alarme. Puro. */
export function versaoTemAlarme(v: string | null | undefined): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v ?? '').trim())
  if (!m) return false
  const n = [Number(m[1]), Number(m[2]), Number(m[3])]
  for (let i = 0; i < 3; i++) if (n[i] !== VERSAO_MIN_ALARME[i]) return n[i] > VERSAO_MIN_ALARME[i]
  return true
}

export interface AgenteAlarme { versao: string | null; visto_em: string | null; revogado_em: string | null }

/** O Assistente toca (e o painel fica mudo)? Puro. */
export function assistenteTocaAlarme(a: AgenteAlarme | null, agora: Date): boolean {
  if (!a || a.revogado_em || !a.visto_em || !versaoTemAlarme(a.versao)) return false
  return agora.getTime() - Date.parse(a.visto_em) < ONLINE_SEGUNDOS * 1000
}

/** Atualização automática só nas janelas de pouco movimento (Brasília): 03:00–10:30 e 14:30–17:00. Puro. */
export function dentroDaJanelaDeAtualizacao(agora: Date): boolean {
  const [h, m] = agora.toLocaleTimeString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number)
  const min = h * 60 + m
  return (min >= 180 && min < 630) || (min >= 870 && min < 1020)
}

/** Pedidos esperando aceite (a MESMA regra do alarme do painel). */
/** `?alarme=N` do Assistente (1.2.0+): quantos pedidos ele sabe que esperam aceite; 0–999, senão null. */
export function alarmeSabido(bruto: string | null): number | null {
  return bruto !== null && /^\d{1,3}$/.test(bruto) ? Number(bruto) : null
}

export async function aguardandoAceite(admin: SupabaseClient, restauranteId: string): Promise<{ aguardando: number; numeros: number[] }> {
  const lista = await listarRecebidosParaAlarme(admin, restauranteId)
  return { aguardando: lista.length, numeros: lista.slice(0, 10).map((p) => p.numero) }
}

/** Painel: o Assistente desta loja está tocando o alarme? Erro → false (o painel toca). */
export async function alarmeNoAssistente(admin: SupabaseClient, restauranteId: string, agora = new Date()): Promise<boolean> {
  try {
    const rota = await destinoCozinha(admin, restauranteId)
    if (!rota.ativo || !rota.agenteId) return false
    const { data } = await admin.from('impressao_agentes').select('versao, visto_em, revogado_em').eq('id', rota.agenteId).eq('restaurante_id', restauranteId).maybeSingle()
    return assistenteTocaAlarme((data as AgenteAlarme | null) ?? null, agora)
  } catch {
    return false
  }
}
