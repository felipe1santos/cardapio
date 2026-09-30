/**
 * Webhook do WhatsApp da loja na Evolution — registrado pelo servidor sempre que a loja
 * conecta ou reconecta. Sem ele o "SAIR", a central de atendimento e as métricas de
 * entrega/leitura das campanhas não recebem nada.
 *
 * Regras:
 *   - a loja e a instância vêm do banco (restaurantes.evolution_instance, só o servidor
 *     grava — 0111); o segredo da URL é o de whatsapp_robo_config (criado se faltar);
 *   - webhook de OUTRO uso (outro host) não é sobrescrito: devolve 'outro_uso';
 *   - já certo (nosso host, segredo e os dois eventos): não mexe ('ja_estava');
 *   - registrar não desconecta nem mexe na sessão do WhatsApp.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { BASE_PUBLICA } from './robo'

export const EVENTOS_WEBHOOK = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE'] as const

export type ResultadoWebhook = 'registrado' | 'ja_estava' | 'outro_uso' | 'sem_instancia' | 'simulado' | 'sem_evolution' | 'erro'

export interface WebhookAtual { url?: string | null; enabled?: boolean; events?: string[] | null }

/** O que fazer com o webhook que está na instância hoje. */
export function decidirWebhook(atual: WebhookAtual | null, urlNossa: string): 'ja_estava' | 'outro_uso' | 'registrar' {
  const url = atual?.url?.trim() ?? ''
  if (!url) return 'registrar'
  let hostAtual = ''
  try { hostAtual = new URL(url).host } catch { return 'registrar' }
  if (hostAtual !== new URL(urlNossa).host) return atual?.enabled === false ? 'registrar' : 'outro_uso'
  const eventos = new Set((atual?.events ?? []).map((e) => String(e).toUpperCase()))
  const completo = url === urlNossa && atual?.enabled !== false && EVENTOS_WEBHOOK.every((e) => eventos.has(e))
  return completo ? 'ja_estava' : 'registrar'
}

export function corpoWebhook(urlNossa: string) {
  return { webhook: { enabled: true, url: urlNossa, byEvents: false, base64: false, events: [...EVENTOS_WEBHOOK] } }
}

async function segredoDaLoja(admin: SupabaseClient, restauranteId: string): Promise<string | null> {
  const { data } = await admin.from('whatsapp_robo_config').select('webhook_segredo').eq('restaurante_id', restauranteId).maybeSingle()
  if (data?.webhook_segredo) return data.webhook_segredo as string
  // Loja sem configuração do robô ainda: cria (robô desligado; o segredo nasce no banco).
  const { data: nova } = await admin
    .from('whatsapp_robo_config')
    .upsert({ restaurante_id: restauranteId }, { onConflict: 'restaurante_id', ignoreDuplicates: true })
    .select('webhook_segredo')
    .maybeSingle()
  if (nova?.webhook_segredo) return nova.webhook_segredo as string
  const { data: denovo } = await admin.from('whatsapp_robo_config').select('webhook_segredo').eq('restaurante_id', restauranteId).maybeSingle()
  return (denovo?.webhook_segredo as string | undefined) ?? null
}

export async function garantirWebhookDaLoja(admin: SupabaseClient, restauranteId: string, fetchImpl: typeof fetch = fetch): Promise<ResultadoWebhook> {
  if (process.env.WHATSAPP_PROVEDOR === 'simulado') return 'simulado'
  const base = process.env.EVOLUTION_API_URL?.replace(/\/$/, '')
  const chave = process.env.EVOLUTION_API_KEY
  if (!base || !chave) return 'sem_evolution'
  try {
    const { data: loja } = await admin.from('restaurantes').select('evolution_instance').eq('id', restauranteId).maybeSingle()
    const instancia = (loja?.evolution_instance as string | null) ?? null
    if (!instancia) return 'sem_instancia'
    const segredo = await segredoDaLoja(admin, restauranteId)
    if (!segredo) return 'erro'
    const urlNossa = `${BASE_PUBLICA()}/api/whatsapp/webhook/${segredo}`
    const inst = encodeURIComponent(instancia)
    const achado = await fetchImpl(`${base}/webhook/find/${inst}`, { headers: { apikey: chave } })
    const atual = achado.ok ? ((await achado.json().catch(() => null)) as WebhookAtual | null) : null
    const decisao = decidirWebhook(atual, urlNossa)
    if (decisao !== 'registrar') return decisao
    const r = await fetchImpl(`${base}/webhook/set/${inst}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: chave },
      body: JSON.stringify(corpoWebhook(urlNossa)),
    })
    return r.ok ? 'registrado' : 'erro'
  } catch (err) {
    console.error('[whatsapp] webhook da loja:', (err as Error).message?.slice(0, 120))
    return 'erro'
  }
}

/** Evita perguntar à Evolution a cada consulta de status (a tela consulta de tempos em tempos). */
const ultimaGarantia = new Map<string, number>()
export async function garantirWebhookDeTempoEmTempo(admin: SupabaseClient, restauranteId: string, intervaloMs = 10 * 60_000): Promise<ResultadoWebhook | 'recente'> {
  const agora = Date.now()
  if (agora - (ultimaGarantia.get(restauranteId) ?? 0) < intervaloMs) return 'recente'
  ultimaGarantia.set(restauranteId, agora)
  return garantirWebhookDaLoja(admin, restauranteId)
}
