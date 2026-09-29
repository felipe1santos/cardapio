/**
 * Central de atendimento do WhatsApp (0107) — leitura e ações para o painel.
 * A loja vem SEMPRE da sessão (quem chama passa o id); nada aqui confia no corpo.
 * Paginação por cursor (última atividade + id); nunca carrega histórico inteiro.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { variantesTelefone, roboLiberadoNoServidor } from './robo'
import { formatarNumeroWhatsapp } from '@/lib/evolution'
import { fotosGuardadas, type FotoGuardada } from './fotos'

export type EstadoAtendimento = 'robo' | 'aguardando' | 'humano' | 'encerrada'
export type OrigemMensagem = 'cliente' | 'atendente' | 'robo' | 'automatico' | 'disparo' | 'loja'
export type FiltroConversas = 'aguardando' | 'humano' | 'todas'

export interface ConversaCentral {
  id: string
  telefone: string
  telefoneExibido: string
  nome: string | null
  atendimento: EstadoAtendimento
  atendenteNome: string | null
  naoLidas: number
  previa: string | null
  ultimaOrigem: OrigemMensagem | null
  ultimaAtividadeEm: string | null
  tags: string[]
  /** Link da foto de perfil guardado (0108); null = sem foto ou ainda não buscada. */
  foto: string | null
  /** Quando a foto foi buscada; null = nunca (o navegador pede quando a linha aparece). */
  fotoEm: string | null
}

export interface MensagemCentral {
  id: string
  direcao: 'entrada' | 'loja'
  origem: OrigemMensagem
  tipo: string
  texto: string | null
  autorNome: string | null
  statusEnvio: 'enviando' | 'enviado' | 'falhou' | null
  erro: string | null
  midiaUrl: string | null
  temMidia: boolean
  criadoEm: string
}

export const POR_PAGINA_CONVERSAS = 30
export const POR_PAGINA_MENSAGENS = 40

/** Cursor opaco: "<iso>|<id>". */
export function lerCursor(bruto: string | null): { em: string; id: string } | null {
  if (!bruto) return null
  const [em, id] = bruto.split('|')
  if (!em || !id || Number.isNaN(Date.parse(em)) || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return { em: new Date(em).toISOString(), id }
}

/** Busca livre só com letras, números, espaço e @.-+ (vai dentro de um filtro do PostgREST). */
export function limparBusca(q: string | null): string {
  return (q ?? '').replace(/[^\p{L}\p{N} @.+-]/gu, '').trim().slice(0, 40)
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

interface LinhaConversa {
  id: string
  telefone: string
  nome_contato: string | null
  atendimento: EstadoAtendimento
  atendente_nome: string | null
  nao_lidas: number
  ultima_previa: string | null
  ultima_origem: OrigemMensagem | null
  ultima_atividade_em: string | null
  whatsapp_conversa_tags?: { tag_id: string }[]
}

const COLUNAS_CONVERSA = 'id, telefone, nome_contato, atendimento, atendente_nome, nao_lidas, ultima_previa, ultima_origem, ultima_atividade_em'

async function mapearConversas(admin: SupabaseClient, restauranteId: string, linhas: LinhaConversa[]): Promise<ConversaCentral[]> {
  const [nomes, fotos] = await Promise.all([
    nomesDosClientes(admin, restauranteId, linhas.map((l) => l.telefone)),
    fotosGuardadas(admin, restauranteId, linhas.map((l) => l.telefone)).catch(() => new Map<string, FotoGuardada>()),
  ])
  return linhas.map((l) => ({
    id: l.id,
    telefone: l.telefone,
    telefoneExibido: formatarNumeroWhatsapp(l.telefone) ?? l.telefone,
    nome: nomes.get(l.telefone) ?? l.nome_contato ?? null,
    atendimento: l.atendimento,
    atendenteNome: l.atendente_nome,
    naoLidas: l.nao_lidas,
    previa: l.ultima_previa,
    ultimaOrigem: l.ultima_origem,
    ultimaAtividadeEm: l.ultima_atividade_em,
    tags: (l.whatsapp_conversa_tags ?? []).map((t) => t.tag_id),
    foto: fotos.get(l.telefone)?.url ?? null,
    fotoEm: fotos.get(l.telefone)?.buscadaEm ?? null,
  }))
}

export async function listarConversas(
  admin: SupabaseClient,
  restauranteId: string,
  o: { filtro: FiltroConversas; tagId?: string | null; busca?: string | null; cursor?: string | null },
): Promise<{ conversas: ConversaCentral[]; proximo: string | null }> {
  const tag = o.tagId && /^[0-9a-f-]{36}$/i.test(o.tagId) ? o.tagId : null
  let q = admin
    .from('whatsapp_conversas')
    .select(`${COLUNAS_CONVERSA}, whatsapp_conversa_tags${tag ? '!inner' : ''}(tag_id)`)
    .eq('restaurante_id', restauranteId)
    .not('ultima_atividade_em', 'is', null)
  if (o.filtro === 'aguardando') q = q.eq('atendimento', 'aguardando')
  else if (o.filtro === 'humano') q = q.eq('atendimento', 'humano')
  if (tag) q = q.eq('whatsapp_conversa_tags.tag_id', tag)
  const busca = limparBusca(o.busca ?? null)
  if (busca) {
    const digitos = busca.replace(/\D/g, '')
    q = digitos.length >= 3
      ? q.or(`telefone.ilike.%${digitos}%,nome_contato.ilike.%${busca}%`)
      : q.ilike('nome_contato', `%${busca}%`)
  }
  const c = lerCursor(o.cursor ?? null)
  if (c) q = q.or(`ultima_atividade_em.lt.${c.em},and(ultima_atividade_em.eq.${c.em},id.lt.${c.id})`)
  const { data, error } = await q.order('ultima_atividade_em', { ascending: false }).order('id', { ascending: false }).limit(POR_PAGINA_CONVERSAS + 1)
  if (error) throw error
  const linhas = (data ?? []) as unknown as LinhaConversa[]
  const mais = linhas.length > POR_PAGINA_CONVERSAS
  const pagina = linhas.slice(0, POR_PAGINA_CONVERSAS)
  // Com filtro por tag o join traz só aquela tag: as tags da conversa vêm à parte.
  if (tag && pagina.length) {
    const { data: todas } = await admin.from('whatsapp_conversa_tags').select('conversa_id, tag_id').eq('restaurante_id', restauranteId).in('conversa_id', pagina.map((l) => l.id))
    const por = new Map<string, { tag_id: string }[]>()
    for (const t of (todas ?? []) as { conversa_id: string; tag_id: string }[]) por.set(t.conversa_id, [...(por.get(t.conversa_id) ?? []), { tag_id: t.tag_id }])
    for (const l of pagina) l.whatsapp_conversa_tags = por.get(l.id) ?? []
  }
  const ultima = pagina[pagina.length - 1]
  return { conversas: await mapearConversas(admin, restauranteId, pagina), proximo: mais && ultima ? `${ultima.ultima_atividade_em}|${ultima.id}` : null }
}

export async function buscarConversa(admin: SupabaseClient, restauranteId: string, id: string): Promise<ConversaCentral | null> {
  const { data } = await admin.from('whatsapp_conversas').select(`${COLUNAS_CONVERSA}, whatsapp_conversa_tags(tag_id)`).eq('restaurante_id', restauranteId).eq('id', id).maybeSingle()
  if (!data) return null
  return (await mapearConversas(admin, restauranteId, [data as unknown as LinhaConversa]))[0]
}

export async function listarMensagens(admin: SupabaseClient, restauranteId: string, conversaId: string, cursor: string | null): Promise<{ mensagens: MensagemCentral[]; anteriores: string | null }> {
  let q = admin
    .from('whatsapp_mensagens')
    .select('id, direcao, origem, tipo, texto, autor_nome, status_envio, erro, midia_url, criado_em')
    .eq('restaurante_id', restauranteId)
    .eq('conversa_id', conversaId)
  const c = lerCursor(cursor)
  if (c) q = q.or(`criado_em.lt.${c.em},and(criado_em.eq.${c.em},id.lt.${c.id})`)
  const { data, error } = await q.order('criado_em', { ascending: false }).order('id', { ascending: false }).limit(POR_PAGINA_MENSAGENS + 1)
  if (error) throw error
  const linhas = (data ?? []) as {
    id: string; direcao: 'entrada' | 'loja'; origem: OrigemMensagem; tipo: string; texto: string | null; autor_nome: string | null
    status_envio: MensagemCentral['statusEnvio']; erro: string | null; midia_url: string | null; criado_em: string
  }[]
  const mais = linhas.length > POR_PAGINA_MENSAGENS
  const pagina = linhas.slice(0, POR_PAGINA_MENSAGENS)
  const ultima = pagina[pagina.length - 1]
  return {
    // Mais antiga primeiro (a tela desenha de cima para baixo).
    mensagens: pagina.reverse().map((m) => ({
      id: m.id, direcao: m.direcao, origem: m.origem, tipo: m.tipo, texto: m.texto, autorNome: m.autor_nome, statusEnvio: m.status_envio,
      erro: m.erro, midiaUrl: m.midia_url, temMidia: m.direcao === 'entrada' && m.tipo === 'imagem', criadoEm: m.criado_em,
    })),
    anteriores: mais && ultima ? `${ultima.criado_em}|${ultima.id}` : null,
  }
}

/**
 * Número do botão flutuante, em CONVERSAS (não em mensagens): as que aguardam atendente +
 * as já em atendimento com mensagem nova do cliente.
 */
export async function resumoCentral(admin: SupabaseClient, restauranteId: string): Promise<{ aguardando: number; naoLidas: number }> {
  const { data, error } = await admin.from('whatsapp_conversas').select('atendimento, nao_lidas').eq('restaurante_id', restauranteId).in('atendimento', ['aguardando', 'humano']).limit(1000)
  if (error) throw error
  let aguardando = 0
  let naoLidas = 0
  for (const c of (data ?? []) as { atendimento: string; nao_lidas: number }[]) {
    if (c.atendimento === 'aguardando') aguardando++
    else if ((c.nao_lidas ?? 0) > 0) naoLidas++
  }
  return { aguardando, naoLidas }
}

/** O robô desta loja está respondendo? (servidor liberado + interruptor ligado) */
export async function roboDaLojaAtivo(admin: SupabaseClient, restauranteId: string): Promise<boolean> {
  if (!roboLiberadoNoServidor()) return false
  const { data } = await admin.from('whatsapp_robo_config').select('robo_ativo').eq('restaurante_id', restauranteId).maybeSingle()
  return data?.robo_ativo === true
}

/** Aba do cliente: últimos pedidos com este número nesta loja. */
export async function pedidosDoCliente(admin: SupabaseClient, restauranteId: string, telefone: string) {
  const variantes = variantesTelefone(telefone)
  if (!variantes.length) return []
  const { data } = await admin.from('pedidos').select('id, numero, status, total, criado_em, tipo')
    .eq('restaurante_id', restauranteId).in('cliente_telefone', variantes).order('criado_em', { ascending: false }).limit(5)
  return ((data ?? []) as { id: string; numero: number; status: string; total: number; criado_em: string; tipo: string }[])
    .map((p) => ({ id: p.id, numero: p.numero, status: p.status, total: Number(p.total), criadoEm: p.criado_em, tipo: p.tipo }))
}
