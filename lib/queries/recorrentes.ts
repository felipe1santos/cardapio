import type { SupabaseClient } from '@supabase/supabase-js'
import { ROTULO_RECORRENTE, TIPOS_RECORRENTES, type Anuncio, type ImagemCard, type TipoRecorrente } from '@/lib/mensageria/recorrentes'

/**
 * Cards de disparo recorrente (0245) e anúncios (0248). Sempre pelo cliente da SESSÃO: a RLS (gestor da própria loja)
 * é a permissão. Desenho: docs/superpowers/specs/2026-11-03-disparos-recorrentes-design.md
 */

type Motivo = 'ok' | 'sem_publico' | 'atrasado' | 'limite_dia' | null

/** Anúncio como a tela usa (Promoções e Disparo personalizado). */
export interface AnuncioSalvo extends Anuncio {
  id: string
  imagemIndice: number
  proximoDisparoEm: string | null
  ultimaRodadaEm: string | null
  ultimaRodadaMotivo: Motivo
}

export interface Recorrente {
  id: string
  tipo: TipoRecorrente
  ativa: boolean
  mensagem: string
  /** Recuperação (0248): copies em rodízio. */
  mensagens: string[]
  mensagemIndice: number
  incluirLink: boolean
  imagens: ImagemCard[]
  imagemIndice: number
  diasSemana: number[]
  hora: string
  janelaFim: string
  proximoDisparoEm: string | null
  ultimaRodadaEm: string | null
  ultimaCampanhaId: string | null
  ultimaRodadaMotivo: Motivo
  desligadoMotivo: string | null
  /** Números da última rodada (campanha gerada), quando houve. */
  ultimaRodada: { destinatarios: number; enviados: number; erros: number; status: string } | null
  /** Promoções e Disparo personalizado (0248). Vazio na Recuperação. */
  anuncios: AnuncioSalvo[]
}

const SELECT = 'id, tipo, ativa, mensagem, mensagens, mensagem_indice, incluir_link, imagens, imagem_indice, dias_semana, hora, janela_fim, proximo_disparo_em, ultima_rodada_em, ultima_campanha_id, ultima_rodada_motivo, desligado_motivo'
const SELECT_ANUNCIO = 'id, recorrente_id, ordem, nome, cor, mensagem, imagens, imagem_indice, dias_semana, hora, janela_fim, publicos, proximo_disparo_em, ultima_rodada_em, ultima_rodada_motivo'

const hhmm = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : '')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapAnuncio(row: any): AnuncioSalvo {
  return {
    id: row.id,
    nome: row.nome ?? '',
    cor: row.cor ?? '#1d4ed8',
    mensagem: row.mensagem ?? '',
    imagens: Array.isArray(row.imagens) ? row.imagens.filter((u: unknown) => typeof u === 'string') : [],
    diasSemana: Array.isArray(row.dias_semana) ? row.dias_semana.map(Number) : [],
    hora: hhmm(row.hora),
    janelaFim: hhmm(row.janela_fim),
    publicos: Array.isArray(row.publicos) ? row.publicos.map(String) : [],
    imagemIndice: Number(row.imagem_indice ?? 0),
    proximoDisparoEm: row.proximo_disparo_em ?? null,
    ultimaRodadaEm: row.ultima_rodada_em ?? null,
    ultimaRodadaMotivo: row.ultima_rodada_motivo ?? null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapRecorrente(row: any, rodada: Recorrente['ultimaRodada'] = null, anuncios: AnuncioSalvo[] = []): Recorrente {
  return {
    id: row.id,
    tipo: row.tipo,
    ativa: row.ativa === true,
    mensagem: row.mensagem ?? '',
    mensagens: Array.isArray(row.mensagens) ? row.mensagens.filter((m: unknown) => typeof m === 'string') : [],
    mensagemIndice: Number(row.mensagem_indice ?? 0),
    incluirLink: row.incluir_link !== false,
    imagens: Array.isArray(row.imagens)
      ? row.imagens
          .map((x: unknown) => (typeof x === 'string' ? { url: x, mensagem: '' } : { url: String((x as { url?: unknown })?.url ?? ''), mensagem: String((x as { mensagem?: unknown })?.mensagem ?? '') }))
          .filter((x: ImagemCard) => x.url !== '')
      : [],
    imagemIndice: Number(row.imagem_indice ?? 0),
    diasSemana: Array.isArray(row.dias_semana) ? row.dias_semana.map(Number) : [],
    hora: hhmm(row.hora),
    janelaFim: hhmm(row.janela_fim),
    proximoDisparoEm: row.proximo_disparo_em ?? null,
    ultimaRodadaEm: row.ultima_rodada_em ?? null,
    ultimaCampanhaId: row.ultima_campanha_id ?? null,
    ultimaRodadaMotivo: row.ultima_rodada_motivo ?? null,
    desligadoMotivo: row.desligado_motivo ?? null,
    ultimaRodada: rodada,
    anuncios,
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
  const linhas = ((data ?? []) as { id: string; tipo: TipoRecorrente; ultima_campanha_id: string | null }[]).sort((a, b) => ordem(a.tipo) - ordem(b.tipo))

  // Anúncios dos cards Promoções e Personalizado: uma consulta para os dois.
  const porCard = new Map<string, AnuncioSalvo[]>()
  if (linhas.length) {
    const { data: anuncios, error: errAn } = await supabase.from('campanha_recorrente_anuncios').select(SELECT_ANUNCIO).eq('restaurante_id', restauranteId).order('ordem')
    if (errAn) throw errAn
    for (const a of (anuncios ?? []) as { recorrente_id: string }[]) {
      if (!porCard.has(a.recorrente_id)) porCard.set(a.recorrente_id, [])
      porCard.get(a.recorrente_id)!.push(mapAnuncio(a))
    }
  }

  const ids = linhas.map((l) => l.ultima_campanha_id).filter((x): x is string => !!x)
  const rodadas = new Map<string, Recorrente['ultimaRodada']>()
  if (ids.length) {
    const { data: camps } = await supabase.from('campanhas').select('id, total_destinatarios, total_enviados, total_erros, status').in('id', ids)
    for (const c of (camps ?? []) as { id: string; total_destinatarios: number; total_enviados: number; total_erros: number; status: string }[]) {
      rodadas.set(c.id, { destinatarios: c.total_destinatarios ?? 0, enviados: c.total_enviados ?? 0, erros: c.total_erros ?? 0, status: c.status })
    }
  }
  return linhas.map((l) => mapRecorrente(l, l.ultima_campanha_id ? (rodadas.get(l.ultima_campanha_id) ?? null) : null, porCard.get(l.id) ?? []))
}

/** Grava o patch já validado (validarPatchRecorrente) e devolve o card atualizado. */
export async function atualizarRecorrente(supabase: SupabaseClient, restauranteId: string, tipo: TipoRecorrente, row: Record<string, unknown>): Promise<Recorrente | null> {
  const { data, error } = await supabase
    .from('campanha_recorrentes')
    .update(row)
    .eq('restaurante_id', restauranteId)
    .eq('tipo', tipo)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const [card] = await garantirRecorrentes(supabase, restauranteId).then((l) => l.filter((c) => c.tipo === tipo))
  return card ?? null
}

/**
 * Troca a lista de anúncios do card pela lista validada (validarAnuncios): apaga os que saíram, atualiza os que ficaram
 * (só as colunas que o painel pode gravar) e cria os novos. A agenda de cada um é a trigger do banco que calcula.
 */
export async function salvarAnuncios(supabase: SupabaseClient, restauranteId: string, tipo: TipoRecorrente, rows: Record<string, unknown>[]): Promise<Recorrente | null> {
  const { data: card, error: errCard } = await supabase.from('campanha_recorrentes').select('id').eq('restaurante_id', restauranteId).eq('tipo', tipo).maybeSingle()
  if (errCard) throw errCard
  if (!card) return null
  const { data: atuais, error: errAtuais } = await supabase.from('campanha_recorrente_anuncios').select('id').eq('recorrente_id', card.id)
  if (errAtuais) throw errAtuais
  const ficam = new Set(rows.map((r) => r.id).filter((x): x is string => typeof x === 'string'))
  const sair = ((atuais ?? []) as { id: string }[]).map((a) => a.id).filter((id) => !ficam.has(id))
  if (sair.length) {
    const { error } = await supabase.from('campanha_recorrente_anuncios').delete().in('id', sair).eq('recorrente_id', card.id)
    if (error) throw error
  }
  const existentes = new Set(((atuais ?? []) as { id: string }[]).map((a) => a.id))
  for (const r of rows) {
    const { id, ...campos } = r as { id?: string } & Record<string, unknown>
    if (id && existentes.has(id)) {
      const { error } = await supabase.from('campanha_recorrente_anuncios').update(campos).eq('id', id).eq('recorrente_id', card.id)
      if (error) throw error
    } else {
      const { error } = await supabase.from('campanha_recorrente_anuncios').insert({ ...campos, recorrente_id: card.id, restaurante_id: restauranteId })
      if (error) throw error
    }
  }
  const [atualizado] = await garantirRecorrentes(supabase, restauranteId).then((l) => l.filter((c) => c.tipo === tipo))
  return atualizado ?? null
}
