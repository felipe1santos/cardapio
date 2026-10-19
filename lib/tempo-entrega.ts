import type { SupabaseClient } from '@supabase/supabase-js'
import { resumoEntrega } from '@/lib/dashboard-metricas'

/**
 * Tempo de entrega e de retirada que o robô e o Agente de IA dizem ao cliente (19/10/2026, auditoria da Ponto 400:
 * "qual o tempo médio?" → IA "não tenho essa informação"). Ordem: Perfil da loja (restaurantes.tempo_entrega/
 * tempo_retirada, 0203) → tempo do robô (whatsapp_robo_config.auto_tempo_entrega, legado) → média REAL dos pedidos
 * entregues nos últimos 30 dias (a mesma conta do Dashboard, lib/dashboard-metricas.ts) → nada (quem chama passa ao
 * atendente; nunca "não sei"). Puro, fora de `mediaTempoEntrega`.
 */
export interface TemposLoja { entrega: string | null; retirada: string | null; origemEntrega: 'perfil' | 'robo' | 'media' | null }

const AMOSTRA_MINIMA = 5
const limpo = (v: string | null | undefined) => (v ?? '').trim().slice(0, 60) || null

/** "em média 35 min" — arredondado de 5 em 5 min (mínimo 10); 90 min vira "1h30". */
export function textoDaMedia(segundos: number): string {
  const min = Math.max(10, Math.round(segundos / 60 / 5) * 5)
  if (min < 60) return `em média ${min} min`
  const h = Math.floor(min / 60), r = min % 60
  return `em média ${h}h${r ? String(r).padStart(2, '0') : ''}`
}

export function resolverTempos(p: { perfilEntrega: string | null | undefined; perfilRetirada: string | null | undefined; roboEntrega: string | null | undefined; mediaEntregaSeg: number | null; amostra: number }): TemposLoja {
  const retirada = limpo(p.perfilRetirada)
  const perfil = limpo(p.perfilEntrega)
  if (perfil) return { entrega: perfil, retirada, origemEntrega: 'perfil' }
  const robo = limpo(p.roboEntrega)
  if (robo) return { entrega: robo, retirada, origemEntrega: 'robo' }
  if (p.mediaEntregaSeg !== null && p.amostra >= AMOSTRA_MINIMA) return { entrega: textoDaMedia(p.mediaEntregaSeg), retirada, origemEntrega: 'media' }
  return { entrega: null, retirada, origemEntrega: null }
}

/** Frase pronta para o cliente, ou null quando não há dado (aí é o atendente que responde). */
export function fraseTempo(t: TemposLoja, tipo: 'entrega' | 'retirada'): string | null {
  if (tipo === 'retirada') return t.retirada ? `Para retirada, fica pronto em *${t.retirada}* (pode variar com o movimento).` : null
  if (!t.entrega) return null
  return t.origemEntrega === 'media'
    ? `Pelos últimos pedidos, a entrega leva *${t.entrega}* (pode variar com o movimento).`
    : `A entrega costuma levar *${t.entrega}* (pode variar com o movimento).`
}

/** Média real (segundos do pedido criado até entregue) dos últimos 30 dias, com a regra do Dashboard. */
export async function mediaTempoEntrega(admin: SupabaseClient, restauranteId: string, agora = new Date()): Promise<{ segundos: number | null; amostra: number }> {
  const inicio = agora.getTime() - 30 * 86_400_000
  const { data } = await admin.from('pedidos').select('criado_em, em_rota_em, entregue_em').eq('restaurante_id', restauranteId).eq('status', 'entregue')
    .eq('tipo', 'entrega').gte('entregue_em', new Date(inicio).toISOString()).not('em_rota_em', 'is', null).not('entregue_em', 'is', null).limit(2000)
  const tempos = ((data ?? []) as { criado_em: string; em_rota_em: string; entregue_em: string }[]).map((p) => ({ criadoEm: p.criado_em, emRotaEm: p.em_rota_em, entregueEm: p.entregue_em }))
  const r = resumoEntrega(tempos, { inicio, fim: agora.getTime() + 1 })
  return { segundos: r.total, amostra: r.amostra }
}
