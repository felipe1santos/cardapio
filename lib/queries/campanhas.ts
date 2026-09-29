import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTelefone } from './clientes'
import { otimizarImagem, CACHE_CONTROL_SEGUNDOS } from '@/lib/imagem'
import { deduplicarDestinatarios, telefoneChave } from '@/lib/mensageria/campanhas'
import { diaSemanaSaoPaulo } from '@/lib/timezone'
import { lerTodas } from './ler-todas'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TipoMensagem = 'texto' | 'imagem' | 'audio'
export type StatusCampanha = 'rascunho' | 'agendada' | 'enviando' | 'pausada' | 'concluida' | 'cancelada'
export type FiltroTipo = 'todos' | 'inativos' | 'frequentes' | 'recentes' | 'dias_semana' | 'valor_minimo'

export interface FiltroCampanha {
  tipo: FiltroTipo
  dias_inativo?: number        // inativos: sem compra há X+ dias (padrão 7)
  compras_por_semana?: number  // frequentes: mínimo N compras/semana (padrão 2)
  ultimos_dias?: number        // recentes: comprou nos últimos X dias (padrão 1)
  dias_semana?: number[]       // dias_semana: costuma comprar nesses dias (0=dom..6=sáb)
  valor_minimo?: number        // valor_minimo: ticket médio >= R$ X
}

export interface Campanha {
  id: string
  restauranteId: string
  nome: string
  status: StatusCampanha
  tipoMensagem: TipoMensagem
  mensagem: string
  imagemUrl: string | null
  audioUrl: string | null
  filtro: FiltroCampanha
  agendadoEm: string | null
  totalDestinatarios: number
  totalEnviados: number
  totalErros: number
  criadoEm: string
  /** Link rastreável do cardápio no fim da mensagem (ou no lugar de {link}). */
  incluirLink: boolean
  duplicadosBloqueados: number
  /** Rodapé "Para não receber mais, responda SAIR." (0112). */
  incluirDescadastro: boolean
  /** Pausada porque o WhatsApp da loja caiu (0112). */
  pausadaEm: string | null
  pausaMotivo: string | null
}

// ─── Mapeamento ───────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCampanha(row: any): Campanha {
  return {
    id: row.id,
    restauranteId: row.restaurante_id,
    nome: row.nome,
    status: row.status,
    tipoMensagem: row.tipo_mensagem,
    mensagem: row.mensagem,
    imagemUrl: row.imagem_url,
    audioUrl: row.audio_url,
    filtro: (row.filtro ?? { tipo: 'todos' }) as FiltroCampanha,
    agendadoEm: row.agendado_em,
    totalDestinatarios: row.total_destinatarios,
    totalEnviados: row.total_enviados,
    totalErros: row.total_erros,
    criadoEm: row.criado_em,
    incluirLink: row.incluir_link === true,
    duplicadosBloqueados: row.duplicados_bloqueados ?? 0,
    incluirDescadastro: row.incluir_descadastro === true,
    pausadaEm: row.pausada_em ?? null,
    pausaMotivo: row.pausa_motivo ?? null,
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

const CAMPANHA_SELECT = 'id, restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, audio_url, filtro, agendado_em, total_destinatarios, total_enviados, total_erros, criado_em, incluir_link, duplicados_bloqueados, incluir_descadastro, pausada_em, pausa_motivo'

export async function listarCampanhas(supabase: SupabaseClient, restauranteId: string): Promise<Campanha[]> {
  const { data, error } = await supabase
    .from('campanhas')
    .select(CAMPANHA_SELECT)
    .eq('restaurante_id', restauranteId)
    .order('criado_em', { ascending: false })
  if (error) throw error
  return (data ?? []).map(mapCampanha)
}

export interface CampanhaInput {
  nome: string
  tipoMensagem: TipoMensagem
  mensagem: string
  imagemUrl?: string | null
  audioUrl?: string | null
  filtro: FiltroCampanha
  agendadoEm?: string | null
  incluirLink?: boolean
  incluirDescadastro?: boolean
}

export async function criarCampanha(supabase: SupabaseClient, restauranteId: string, input: CampanhaInput): Promise<Campanha> {
  const { data, error } = await supabase
    .from('campanhas')
    .insert({
      restaurante_id: restauranteId,
      nome: input.nome,
      tipo_mensagem: input.tipoMensagem,
      mensagem: input.mensagem,
      imagem_url: input.imagemUrl ?? null,
      audio_url: input.audioUrl ?? null,
      filtro: input.filtro,
      agendado_em: input.agendadoEm ?? null,
      incluir_link: input.incluirLink === true,
      incluir_descadastro: input.incluirDescadastro === true,
      status: input.agendadoEm ? 'agendada' : 'rascunho',
    })
    .select(CAMPANHA_SELECT)
    .single()
  if (error) throw error
  return mapCampanha(data)
}

export async function atualizarCampanha(supabase: SupabaseClient, restauranteId: string, id: string, patch: Partial<CampanhaInput> & { status?: StatusCampanha }): Promise<Campanha> {
  const row: Record<string, unknown> = { atualizado_em: new Date().toISOString() }
  if (patch.nome !== undefined) row.nome = patch.nome
  if (patch.tipoMensagem !== undefined) row.tipo_mensagem = patch.tipoMensagem
  if (patch.mensagem !== undefined) row.mensagem = patch.mensagem
  if ('imagemUrl' in patch) row.imagem_url = patch.imagemUrl ?? null
  if ('audioUrl' in patch) row.audio_url = patch.audioUrl ?? null
  if (patch.filtro !== undefined) row.filtro = patch.filtro
  if (patch.incluirLink !== undefined) row.incluir_link = patch.incluirLink === true
  if (patch.incluirDescadastro !== undefined) row.incluir_descadastro = patch.incluirDescadastro === true
  if ('agendadoEm' in patch) {
    row.agendado_em = patch.agendadoEm ?? null
    if (!patch.status) row.status = patch.agendadoEm ? 'agendada' : 'rascunho'
  }
  if (patch.status !== undefined) row.status = patch.status

  const { data, error } = await supabase
    .from('campanhas')
    .update(row)
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
    .select(CAMPANHA_SELECT)
    .single()
  if (error) throw error
  return mapCampanha(data)
}

export async function excluirCampanha(supabase: SupabaseClient, restauranteId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('campanhas')
    .delete()
    .eq('id', id)
    .eq('restaurante_id', restauranteId)
  if (error) throw error
}

// ─── Upload de mídia ──────────────────────────────────────────────────────────

export async function uploadMidiaCampanha(supabase: SupabaseClient, restauranteId: string, file: File, tipo: 'imagem' | 'audio'): Promise<string> {
  // Áudio passa intacto; imagem de campanha é enviada pelo WhatsApp, então o
  // perfil `produto` (1200 px) é o teto útil.
  const midia = tipo === 'imagem' ? await otimizarImagem(file, 'produto') : file
  const ext = midia.name.split('.').pop() ?? (tipo === 'audio' ? 'mp3' : 'jpg')
  const caminho = `${restauranteId}/campanhas/${tipo}-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('cardapio').upload(caminho, midia, { cacheControl: CACHE_CONTROL_SEGUNDOS, upsert: false })
  if (error) throw error
  const { data } = supabase.storage.from('cardapio').getPublicUrl(caminho)
  return data.publicUrl
}

// ─── Filtros e destinatários ─────────────────────────────────────────────────

const MS_DIA = 86_400_000
const MS_SEMANA = 7 * MS_DIA

export async function resolverDestinatarios(
  admin: SupabaseClient,
  restauranteId: string,
  filtro: FiltroCampanha,
): Promise<{ telefone: string; nome: string }[]> {
  const clientes = await lerTodas<{ telefone: string; nome: string | null }>((de, ate) => admin
    .from('clientes')
    .select('telefone, nome')
    .eq('restaurante_id', restauranteId)
    // Mais antigo primeiro (como o select sem ordem devolvia): entre dois cadastros do
    // mesmo telefone, a deduplicação fica com o primeiro.
    .order('criado_em', { ascending: true })
    .order('id', { ascending: true })
    .range(de, ate))
  if (!clientes.length) return []

  // Quem respondeu SAIR (0112) nunca entra no público — em nenhum filtro.
  const saiu = new Set((await lerTodas<{ telefone_chave: string }>((de, ate) => admin
    .from('whatsapp_descadastros')
    .select('telefone_chave')
    .eq('restaurante_id', restauranteId)
    .order('telefone_chave', { ascending: true })
    .range(de, ate))).map((d) => d.telefone_chave))
  if (saiu.size) {
    const ficam = clientes.filter((c) => !saiu.has(telefoneChave(c.telefone) ?? ''))
    clientes.length = 0
    clientes.push(...ficam)
    if (!clientes.length) return []
  }

  if (filtro.tipo === 'todos') return clientes.map((c) => ({ telefone: c.telefone, nome: c.nome ?? '' }))

  const pedidos = await lerTodas<{ cliente_telefone: string; criado_em: string; total: number }>((de, ate) => admin
    .from('pedidos')
    .select('cliente_telefone, criado_em, total')
    .eq('restaurante_id', restauranteId)
    .neq('status', 'cancelado')
    .order('criado_em', { ascending: true })
    .order('id', { ascending: true })
    .range(de, ate))

  const pedidosPorTelefone = new Map<string, { criado_em: string; total: number }[]>()
  for (const p of pedidos) {
    const tel = normalizarTelefone(p.cliente_telefone)
    const lista = pedidosPorTelefone.get(tel)
    if (lista) lista.push(p)
    else pedidosPorTelefone.set(tel, [p])
  }

  const agora = Date.now()

  return clientes
    .filter((c) => {
      const tel = normalizarTelefone(c.telefone)
      const ordens = pedidosPorTelefone.get(tel) ?? []

      switch (filtro.tipo) {
        case 'inativos': {
          if (!ordens.length) return true
          const ultima = new Date(ordens[ordens.length - 1].criado_em).getTime()
          return agora - ultima >= (filtro.dias_inativo ?? 7) * MS_DIA
        }
        case 'frequentes': {
          if (!ordens.length) return false
          const primeiraTs = new Date(ordens[0].criado_em).getTime()
          const semanas = Math.max(1, (agora - primeiraTs) / MS_SEMANA)
          return ordens.length / semanas >= (filtro.compras_por_semana ?? 2)
        }
        case 'recentes': {
          const dias = filtro.ultimos_dias ?? 1
          return ordens.some((p) => agora - new Date(p.criado_em).getTime() <= dias * MS_DIA)
        }
        case 'dias_semana': {
          const diasAlvo = new Set(filtro.dias_semana ?? [])
          // Dia de São Paulo: o servidor roda em UTC e o pedido de domingo 21h (00h UTC
          // de segunda) contava como segunda.
          return ordens.some((p) => diasAlvo.has(diaSemanaSaoPaulo(p.criado_em)))
        }
        case 'valor_minimo': {
          if (!ordens.length) return false
          const totalValor = ordens.reduce((s, p) => s + Number(p.total), 0)
          return totalValor / ordens.length >= (filtro.valor_minimo ?? 0)
        }
        default:
          return true
      }
    })
    .map((c) => ({ telefone: c.telefone, nome: c.nome ?? '' }))
}

// ─── Fila de envios ──────────────────────────────────────────────────────────

export async function popularFilaCampanha(
  admin: SupabaseClient,
  campanhaId: string,
  restauranteId: string,
  destinatarios: { telefone: string; nome: string }[],
): Promise<void> {
  if (!destinatarios.length) return
  // Um envio por telefone (com/sem 55, com/sem o 9): o banco também recusa repetido.
  const { unicos, repetidos } = deduplicarDestinatarios(destinatarios)
  const rows = unicos.map((d) => ({
    campanha_id: campanhaId,
    restaurante_id: restauranteId,
    telefone: d.telefone,
    nome_cliente: d.nome,
  }))
  const { error } = await admin.from('campanha_envios').insert(rows)
  if (error) throw error

  const { error: errCount } = await admin
    .from('campanhas')
    .update({ total_destinatarios: unicos.length, duplicados_bloqueados: repetidos, status: 'agendada', atualizado_em: new Date().toISOString() })
    .eq('id', campanhaId)
  if (errCount) throw errCount
}

/** A fila ainda pode ser refeita? Só antes de qualquer envio sair ou ser reservado. */
export async function filaIntocada(admin: SupabaseClient, campanhaId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('campanha_envios')
    .select('id')
    .eq('campanha_id', campanhaId)
    .neq('status', 'pendente')
    .limit(1)
  if (error) throw error
  return (data ?? []).length === 0
}

/** Cancelar: o que ainda não saiu vira 'cancelado' (o cron não pega campanha cancelada). */
export async function cancelarFila(admin: SupabaseClient, campanhaId: string): Promise<void> {
  const { error } = await admin
    .from('campanha_envios')
    .update({ status: 'cancelado', erro: 'Campanha cancelada' })
    .eq('campanha_id', campanhaId)
    .eq('status', 'pendente')
  if (error) throw error
}
