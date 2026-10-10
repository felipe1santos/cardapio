import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Proteção da impressão da loja (09/10, Villa): o único computador que imprime não é desconectado sem
 * confirmação, e um segundo computador (outro PC com o login da loja) não assume Cozinha ou Caixa em
 * silêncio. O servidor responde 409 com a pergunta; o painel pergunta e só repete com `confirmar: true`.
 */
const ATIVO_MS = 10 * 60_000

export interface AgenteSinal { id: string; nome: string; vistoEm: string | null; revogado: boolean }

const ativo = (a: AgenteSinal, agora: number) => !a.revogado && !!a.vistoEm && agora - Date.parse(a.vistoEm) < ATIVO_MS

/** Desconectar `alvoId` deixa a loja sem nenhum computador ativo? (puro) */
export function ehOUnicoAtivo(agentes: AgenteSinal[], alvoId: string, agora = Date.now()): boolean {
  const alvo = agentes.find((a) => a.id === alvoId)
  if (!alvo || !ativo(alvo, agora)) return false
  return !agentes.some((a) => a.id !== alvoId && ativo(a, agora))
}

/** Passar a função para um dispositivo de OUTRO computador enquanto o atual está ativo? Devolve o nome do atual. (puro) */
export function computadorAtualAtivo(atual: AgenteSinal | null, novoAgenteId: string | null, agora = Date.now()): string | null {
  if (!atual || !novoAgenteId || atual.id === novoAgenteId) return null
  return ativo(atual, agora) ? atual.nome : null
}

async function agentesDaLoja(admin: SupabaseClient, loja: string): Promise<AgenteSinal[]> {
  const { data } = await admin.from('impressao_agentes').select('id, nome, visto_em, revogado_em').eq('restaurante_id', loja)
  return ((data ?? []) as { id: string; nome: string; visto_em: string | null; revogado_em: string | null }[])
    .map((a) => ({ id: a.id, nome: a.nome, vistoEm: a.visto_em, revogado: !!a.revogado_em }))
}

export async function perguntaAoDesconectar(admin: SupabaseClient, loja: string, agenteId: string): Promise<string | null> {
  const agentes = await agentesDaLoja(admin, loja)
  if (!ehOUnicoAtivo(agentes, agenteId)) return null
  return 'Este é o único computador que imprime os pedidos da loja. Se desconectar, nenhum pedido vai sair. Tem certeza?'
}

export async function perguntaAoTrocar(admin: SupabaseClient, loja: string, funcao: string, dispositivoId: string): Promise<{ pergunta: string; de: string } | null> {
  const [{ data: f }, { data: novo }] = await Promise.all([
    admin.from('impressao_funcoes').select('dispositivo_id, impressao_dispositivos ( agente_id )').eq('restaurante_id', loja).eq('funcao', funcao).maybeSingle(),
    admin.from('impressao_dispositivos').select('agente_id').eq('id', dispositivoId).eq('restaurante_id', loja).maybeSingle(),
  ])
  const atualAgente = (f as { impressao_dispositivos?: { agente_id?: string } | null } | null)?.impressao_dispositivos?.agente_id ?? null
  if (!atualAgente) return null
  const agentes = await agentesDaLoja(admin, loja)
  const nome = computadorAtualAtivo(agentes.find((a) => a.id === atualAgente) ?? null, (novo?.agente_id as string | null) ?? null)
  return nome ? { pergunta: `Esta loja já imprime no computador ${nome}. Usar este computador no lugar dele?`, de: nome } : null
}
