import type { SupabaseClient } from '@supabase/supabase-js'
import { ROTULO_RECORRENTE, TIPOS_RECORRENTES, hojeSaoPaulo, type TipoRecorrente } from '@/lib/mensageria/recorrentes'

/**
 * Cards de disparo recorrente (0245). Sempre pelo cliente da SESSÃO: a RLS (gestor da própria loja) é a permissão.
 * Desenho: docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md
 */

export interface Recorrente {
  id: string
  tipo: TipoRecorrente
  ativa: boolean
  mensagem: string
  incluirLink: boolean
  imagens: string[]
  imagemIndice: number
  diasSemana: number[]
  hora: string
  janelaFim: string
  pularAte: string | null
  proximoDisparoEm: string | null
  ultimaRodadaEm: string | null
  ultimaCampanhaId: string | null
  ultimaRodadaMotivo: 'ok' | 'sem_publico' | 'pulado' | 'atrasado' | null
  desligadoMotivo: string | null
  /** Números da última rodada (campanha gerada), quando houve. */
  ultimaRodada: { destinatarios: number; enviados: number; erros: number; status: string } | null
}

const SELECT = 'id, tipo, ativa, mensagem, incluir_link, imagens, imagem_indice, dias_semana, hora, janela_fim, pular_ate, proximo_disparo_em, ultima_rodada_em, ultima_campanha_id, ultima_rodada_motivo, desligado_motivo'

const hhmm = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : '')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRecorrente(row: any, rodada: Recorrente['ultimaRodada'] = null): Recorrente {
  return {
    id: row.id,
    tipo: row.tipo,
    ativa: row.ativa === true,
    mensagem: row.mensagem ?? '',
    incluirLink: row.incluir_link !== false,
    imagens: Array.isArray(row.imagens) ? row.imagens.filter((u: unknown) => typeof u === 'string') : [],
    imagemIndice: Number(row.imagem_indice ?? 0),
    diasSemana: Array.isArray(row.dias_semana) ? row.dias_semana.map(Number) : [],
    hora: hhmm(row.hora),
    janelaFim: hhmm(row.janela_fim),
    pularAte: row.pular_ate ?? null,
    proximoDisparoEm: row.proximo_disparo_em ?? null,
    ultimaRodadaEm: row.ultima_rodada_em ?? null,
    ultimaCampanhaId: row.ultima_campanha_id ?? null,
    ultimaRodadaMotivo: row.ultima_rodada_motivo ?? null,
    desligadoMotivo: row.desligado_motivo ?? null,
    ultimaRodada: rodada,
  }
}

const ordem = (t: TipoRecorrente) => TIPOS_RECORRENTES.indexOf(t)

/** Os 3 cards da loja, criando os que faltam (desligados, com a mensagem padrão). Nunca sobrescreve o que existe. */
export async function garantirRecorrentes(supabase: SupabaseClient, restauranteId: string): Promise<Recorrente[]> {
  const { error: errUp } = await supabase
    .from('campanha_recorrentes')
    .upsert(TIPOS_RECORRENTES.map((tipo) => ({ restaurante_id: restauranteId, tipo, mensagem: ROTULO_RECORRENTE[tipo].mensagemPadrao })), { onConflict: 'restaurante_id,tipo', ignoreDuplicates: true })
  if (errUp) throw errUp

  const { data, error } = await supabase.from('campanha_recorrentes').select(SELECT).eq('restaurante_id', restauranteId)
  if (error) throw error
  const linhas = ((data ?? []) as { tipo: TipoRecorrente; ultima_campanha_id: string | null }[]).sort((a, b) => ordem(a.tipo) - ordem(b.tipo))

  const ids = linhas.map((l) => l.ultima_campanha_id).filter((x): x is string => !!x)
  const rodadas = new Map<string, Recorrente['ultimaRodada']>()
  if (ids.length) {
    const { data: camps } = await supabase.from('campanhas').select('id, total_destinatarios, total_enviados, total_erros, status').in('id', ids)
    for (const c of (camps ?? []) as { id: string; total_destinatarios: number; total_enviados: number; total_erros: number; status: string }[]) {
      rodadas.set(c.id, { destinatarios: c.total_destinatarios ?? 0, enviados: c.total_enviados ?? 0, erros: c.total_erros ?? 0, status: c.status })
    }
  }
  return linhas.map((l) => mapRecorrente(l, l.ultima_campanha_id ? (rodadas.get(l.ultima_campanha_id) ?? null) : null))
}

/**
 * "Pular hoje" com a rodada de hoje já nascida: cancela o que ainda não saiu — só se a campanha for DESTA loja e DESTE
 * card (revisão 03/11: `ultima_campanha_id` é gravável pelo painel, nunca cancelar por id solto). Devolve se cancelou.
 */
export async function cancelarRodadaDeHoje(
  admin: SupabaseClient,
  restauranteId: string,
  card: { id: string; ultimaCampanhaId: string | null; ultimaRodadaEm: string | null },
  hoje: (d?: Date) => string = hojeSaoPaulo,
): Promise<boolean> {
  if (!card.ultimaCampanhaId || !card.ultimaRodadaEm) return false
  if (hoje(new Date(card.ultimaRodadaEm)) !== hoje()) return false
  const { data } = await admin.from('campanhas').select('id').eq('id', card.ultimaCampanhaId).eq('restaurante_id', restauranteId).eq('recorrente_id', card.id).maybeSingle()
  if (!data) return false
  const { error } = await admin.from('campanha_envios').update({ status: 'cancelado', erro: 'Campanha cancelada' }).eq('campanha_id', card.ultimaCampanhaId).eq('restaurante_id', restauranteId).eq('status', 'pendente')
  if (error) throw error
  return true
}

/** Grava o patch já validado (validarPatchRecorrente) e devolve o card atualizado. */
export async function atualizarRecorrente(supabase: SupabaseClient, restauranteId: string, tipo: TipoRecorrente, row: Record<string, unknown>): Promise<Recorrente | null> {
  const { data, error } = await supabase
    .from('campanha_recorrentes')
    .update(row)
    .eq('restaurante_id', restauranteId)
    .eq('tipo', tipo)
    .select(SELECT)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const [card] = await garantirRecorrentes(supabase, restauranteId).then((l) => l.filter((c) => c.tipo === tipo))
  return card ?? mapRecorrente(data)
}
