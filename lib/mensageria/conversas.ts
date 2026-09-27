/**
 * Conversas do robô para o painel (Atendimento): as que estão com atendimento humano e
 * as que o robô atendeu nas últimas 24h (para pausar). Tudo da loja da SESSÃO — quem
 * chama passa o id vindo da sessão, nunca da tela.
 *
 * “Silenciada” no banco não basta: depois do tempo da loja sem mensagens ela volta
 * sozinha ao robô na próxima mensagem. Aqui ela só conta como “em atendimento humano”
 * enquanto esse tempo não passou.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { mascararTelefone } from './mascara'
import { variantesTelefone } from './robo'

export const TEMPOS_PADRAO = { boasVindasHoras: 12, retornoMinutos: 120 }
export const LIMITES = { boasVindasHoras: [1, 48] as const, retornoMinutos: [15, 1440] as const }

/** Inteiro dentro do limite, ou erro. Aceita número ou texto numérico. */
export function tempoValido(bruto: unknown, [min, max]: readonly [number, number]): number | null {
  const n = typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : bruto
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) return null
  return n
}

export interface ConversaPainel {
  id: string
  nome: string | null
  telefone: string
  motivo: 'cliente' | 'loja' | 'painel' | null
  silenciadaEm: string | null
  ultimaMensagemEm: string | null
  /** Quando o robô volta sozinho (silenciadas). */
  voltaEm: string | null
}

interface Linha {
  id: string
  telefone: string
  estado: string
  silenciada_em: string | null
  silenciada_motivo: string | null
  ultima_mensagem_em: string | null
  nome_contato: string | null
}

export async function temposDaLoja(admin: SupabaseClient, restauranteId: string) {
  const { data } = await admin.from('whatsapp_robo_config').select('boas_vindas_horas, retorno_minutos').eq('restaurante_id', restauranteId).maybeSingle()
  return {
    boasVindasHoras: (data?.boas_vindas_horas as number | undefined) ?? TEMPOS_PADRAO.boasVindasHoras,
    retornoMinutos: (data?.retorno_minutos as number | undefined) ?? TEMPOS_PADRAO.retornoMinutos,
  }
}

/** Momento em que a conversa silenciada volta ao robô (mesma regra do banco). */
export function voltaEm(c: { silenciada_em: string | null; ultima_mensagem_em: string | null }, retornoMinutos: number): number {
  const base = Math.max(c.ultima_mensagem_em ? Date.parse(c.ultima_mensagem_em) : 0, c.silenciada_em ? Date.parse(c.silenciada_em) : 0)
  return base + retornoMinutos * 60_000
}

async function nomesDosClientes(admin: SupabaseClient, restauranteId: string, telefones: string[]): Promise<Map<string, string>> {
  const mapa = new Map<string, string>()
  const variantes = new Map<string, string>()
  for (const t of telefones) for (const v of variantesTelefone(t)) variantes.set(v, t)
  if (!variantes.size) return mapa
  const { data } = await admin.from('clientes').select('telefone, nome').eq('restaurante_id', restauranteId).in('telefone', [...variantes.keys()])
  for (const c of (data ?? []) as { telefone: string; nome: string | null }[]) {
    const dono = variantes.get(c.telefone)
    if (dono && c.nome?.trim()) mapa.set(dono, c.nome.trim())
  }
  return mapa
}

export async function listarConversasPainel(admin: SupabaseClient, restauranteId: string, agora = Date.now()) {
  const tempos = await temposDaLoja(admin, restauranteId)
  const desde = new Date(agora - 24 * 3600_000).toISOString()
  const [{ data: silenciadasBrutas }, { data: recentes }] = await Promise.all([
    admin.from('whatsapp_conversas').select('id, telefone, estado, silenciada_em, silenciada_motivo, ultima_mensagem_em, nome_contato')
      .eq('restaurante_id', restauranteId).eq('estado', 'silenciada').order('silenciada_em', { ascending: false }).limit(200),
    admin.from('whatsapp_conversas').select('id, telefone, estado, silenciada_em, silenciada_motivo, ultima_mensagem_em, nome_contato')
      .eq('restaurante_id', restauranteId).gte('ultima_mensagem_em', desde).order('ultima_mensagem_em', { ascending: false }).limit(200),
  ])
  const emAtendimento = ((silenciadasBrutas ?? []) as Linha[]).filter((c) => voltaEm(c, tempos.retornoMinutos) > agora)
  const idsEmAtendimento = new Set(emAtendimento.map((c) => c.id))
  const comRobo = ((recentes ?? []) as Linha[]).filter((c) => !idsEmAtendimento.has(c.id)).slice(0, 50)
  const nomes = await nomesDosClientes(admin, restauranteId, [...emAtendimento, ...comRobo].map((c) => c.telefone))
  const mapear = (c: Linha, silenciada: boolean): ConversaPainel => ({
    id: c.id,
    nome: nomes.get(c.telefone) ?? c.nome_contato ?? null,
    telefone: mascararTelefone(c.telefone),
    motivo: silenciada ? ((c.silenciada_motivo as ConversaPainel['motivo']) ?? null) : null,
    silenciadaEm: silenciada ? c.silenciada_em : null,
    ultimaMensagemEm: c.ultima_mensagem_em,
    voltaEm: silenciada ? new Date(voltaEm(c, tempos.retornoMinutos)).toISOString() : null,
  })
  return {
    tempos,
    emAtendimento: emAtendimento.map((c) => mapear(c, true)),
    comRobo: comRobo.map((c) => mapear(c, false)),
  }
}

export async function contarEmAtendimento(admin: SupabaseClient, restauranteId: string, agora = Date.now()): Promise<number> {
  const tempos = await temposDaLoja(admin, restauranteId)
  const { data } = await admin.from('whatsapp_conversas').select('silenciada_em, ultima_mensagem_em')
    .eq('restaurante_id', restauranteId).eq('estado', 'silenciada').limit(500)
  return ((data ?? []) as { silenciada_em: string | null; ultima_mensagem_em: string | null }[]).filter((c) => voltaEm(c, tempos.retornoMinutos) > agora).length
}
