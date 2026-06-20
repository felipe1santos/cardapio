import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizarTelefone } from './clientes'

// ─── Types ────────────────────────────────────────────────────────────────────

export type TipoMensagem = 'texto' | 'imagem' | 'audio'
export type StatusCampanha = 'rascunho' | 'agendada' | 'enviando' | 'concluida' | 'cancelada'
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
}

export interface CampanhaEnvio {
  id: string
  campanhaId: string
  restauranteId: string
  telefone: string
  nomeCliente: string
  status: 'pendente' | 'enviado' | 'erro'
  erro: string | null
  enviadoEm: string | null
  // joined
  tipoMensagem?: TipoMensagem
  mensagem?: string
  imagemUrl?: string | null
  audioUrl?: string | null
  evolutionInstance?: string | null
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
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

const CAMPANHA_SELECT = 'id, restaurante_id, nome, status, tipo_mensagem, mensagem, imagem_url, audio_url, filtro, agendado_em, total_destinatarios, total_enviados, total_erros, criado_em'

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
  const ext = file.name.split('.').pop() ?? (tipo === 'audio' ? 'mp3' : 'jpg')
  const caminho = `${restauranteId}/campanhas/${tipo}-${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from('cardapio').upload(caminho, file, { cacheControl: '3600', upsert: false })
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
  const { data: clientes, error: errClientes } = await admin
    .from('clientes')
    .select('telefone, nome')
    .eq('restaurante_id', restauranteId)
  if (errClientes) throw errClientes
  if (!clientes?.length) return []

  if (filtro.tipo === 'todos') return clientes.map((c) => ({ telefone: c.telefone, nome: c.nome ?? '' }))

  const { data: pedidos, error: errPedidos } = await admin
    .from('pedidos')
    .select('cliente_telefone, criado_em, total')
    .eq('restaurante_id', restauranteId)
    .neq('status', 'cancelado')
    .order('criado_em', { ascending: true })
  if (errPedidos) throw errPedidos

  const pedidosPorTelefone = new Map<string, { criado_em: string; total: number }[]>()
  for (const p of pedidos ?? []) {
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
          return ordens.some((p) => diasAlvo.has(new Date(p.criado_em).getDay()))
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
  const rows = destinatarios.map((d) => ({
    campanha_id: campanhaId,
    restaurante_id: restauranteId,
    telefone: d.telefone,
    nome_cliente: d.nome,
  }))
  const { error } = await admin.from('campanha_envios').insert(rows)
  if (error) throw error

  const { error: errCount } = await admin
    .from('campanhas')
    .update({ total_destinatarios: destinatarios.length, status: 'agendada', atualizado_em: new Date().toISOString() })
    .eq('id', campanhaId)
  if (errCount) throw errCount
}

export async function buscarProximoEnvio(admin: SupabaseClient): Promise<CampanhaEnvio | null> {
  // Busca o próximo envio pendente de campanha cujo agendamento já chegou,
  // junto dos dados da campanha e da instância WhatsApp do restaurante.
  const { data, error } = await admin
    .from('campanha_envios')
    .select(`
      id, campanha_id, restaurante_id, telefone, nome_cliente, status, erro, enviado_em,
      campanhas!inner (
        tipo_mensagem, mensagem, imagem_url, audio_url, agendado_em, status,
        restaurantes!inner ( evolution_instance )
      )
    `)
    .eq('status', 'pendente')
    .eq('campanhas.status', 'agendada')
    .lte('campanhas.agendado_em', new Date().toISOString())
    .order('criado_em', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (data as any).campanhas
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = c?.restaurantes as any

  return {
    id: data.id,
    campanhaId: data.campanha_id,
    restauranteId: data.restaurante_id,
    telefone: data.telefone,
    nomeCliente: data.nome_cliente,
    status: data.status,
    erro: data.erro,
    enviadoEm: data.enviado_em,
    tipoMensagem: c?.tipo_mensagem,
    mensagem: c?.mensagem,
    imagemUrl: c?.imagem_url,
    audioUrl: c?.audio_url,
    evolutionInstance: r?.evolution_instance ?? null,
  }
}

export async function marcarEnvioSucesso(admin: SupabaseClient, envioId: string, campanhaId: string): Promise<void> {
  const agora = new Date().toISOString()
  await admin.from('campanha_envios').update({ status: 'enviado', enviado_em: agora }).eq('id', envioId)
  await admin.rpc('campanha_incrementar_enviados', { p_campanha_id: campanhaId })
}

export async function marcarEnvioErro(admin: SupabaseClient, envioId: string, campanhaId: string, erro: string): Promise<void> {
  await admin.from('campanha_envios').update({ status: 'erro', erro }).eq('id', envioId)
  await admin.rpc('campanha_incrementar_erros', { p_campanha_id: campanhaId })
}

export async function verificarConclusaoCampanha(admin: SupabaseClient, campanhaId: string): Promise<void> {
  const { data } = await admin
    .from('campanha_envios')
    .select('id')
    .eq('campanha_id', campanhaId)
    .eq('status', 'pendente')
    .limit(1)
    .maybeSingle()
  if (!data) {
    await admin.from('campanhas').update({ status: 'concluida', atualizado_em: new Date().toISOString() }).eq('id', campanhaId)
  }
}
