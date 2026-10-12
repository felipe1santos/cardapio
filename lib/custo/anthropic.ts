import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarIa, type ResultadoIa } from './ia'

/**
 * Claude (Anthropic) — a ÚNICA requisição à API de IA do sistema (Regra nº 1, docs/REGRAS-DE-CUSTO.md). Sempre dentro de
 * `chamarIa()`: teto em dinheiro, trava de disparo, limite de chamadas e registro de tokens/custo. Sem SDK (só fetch).
 *
 * Configuração (11/10/2026, conferida na documentação oficial): Haiku mais recente, resposta de até 400 tokens, esforço
 * baixo e sem raciocínio (atendimento curto e rápido), sem temperature (o modelo recusa), cache de 5 min na parte fixa
 * do prompt (instruções + dados da loja + resumo do cardápio). Chave só em ANTHROPIC_API_KEY (Coolify, sem Build time).
 * Sem nova tentativa: falhou, quem chama usa o robô padrão.
 */
export const MODELO_IA = 'claude-haiku-5-5'
export const MAX_TOKENS_IA = 400
const URL_PADRAO = 'https://api.anthropic.com'

export interface BlocoTexto { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }
export interface BlocoImagem { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
export interface BlocoUsoFerramenta { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
export interface BlocoResultadoFerramenta { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
export type BlocoConteudo = BlocoTexto | BlocoImagem | BlocoUsoFerramenta | BlocoResultadoFerramenta
export interface MensagemClaude { role: 'user' | 'assistant'; content: string | BlocoConteudo[] }
export interface FerramentaClaude { name: string; description: string; input_schema: Record<string, unknown> }
export interface PedidoClaude {
  system: BlocoTexto[]
  messages: MensagemClaude[]
  tools?: FerramentaClaude[]
  /** 'none' força só texto (passou do limite de ferramentas). */
  toolChoice?: 'auto' | 'none'
}
export interface RespostaClaude { content: BlocoConteudo[]; stop_reason: string }
export type ResultadoClaude = { ok: true; resposta: RespostaClaude; custoMicroUsd: number } | { ok: false; motivo: 'sem_chave' | Exclude<ResultadoIa<never>, { ok: true }>['motivo']; erro?: string }

/** Base da API: a oficial; outra só se for servidor de teste local (e2e com API simulada). */
function baseDaApi(): string {
  const b = process.env.ANTHROPIC_BASE_URL?.trim()
  return b && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b) ? b : URL_PADRAO
}

export async function chamarClaude(
  admin: SupabaseClient,
  p: { loja: string | null; conversa: string; tetoLojaUsd?: number | null },
  pedido: PedidoClaude,
  opcoes: { timeoutMs: number; fetch?: typeof fetch },
): Promise<ResultadoClaude> {
  const chave = process.env.ANTHROPIC_API_KEY?.trim()
  if (!chave) return { ok: false, motivo: 'sem_chave' }
  const buscar = opcoes.fetch ?? fetch
  // Cache: quem chama marca o fim da parte fixa (cache_control); sem marca, o último bloco do system.
  const marcado = pedido.system.some((b) => b.cache_control)
  const system = marcado ? pedido.system : pedido.system.map((b, i) => (i === pedido.system.length - 1 ? { ...b, cache_control: { type: 'ephemeral' as const } } : b))
  const corpo = {
    model: MODELO_IA,
    max_tokens: MAX_TOKENS_IA,
    system,
    messages: pedido.messages,
    ...(pedido.tools?.length ? { tools: pedido.tools, tool_choice: { type: pedido.toolChoice ?? 'auto' } } : {}),
    output_config: { effort: 'low' },
    thinking: { type: 'disabled' },
  }
  const r = await chamarIa(admin, p, async () => {
    const res = await buscar(`${baseDaApi()}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(Math.max(1, opcoes.timeoutMs)),
    })
    const j = (await res.json().catch(() => null)) as {
      content?: BlocoConteudo[]; stop_reason?: string; model?: string; error?: { type?: string }
      usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
    } | null
    // Só o código e o tipo do erro (nunca o corpo do pedido nem a chave).
    if (!res.ok || !j) throw new Error(`HTTP ${res.status}${j?.error?.type ? ` ${j.error.type}` : ''}`)
    const u = j.usage ?? {}
    return {
      valor: { content: j.content ?? [], stop_reason: j.stop_reason ?? 'end_turn' },
      modelo: j.model || MODELO_IA,
      uso: { entrada: u.input_tokens ?? 0, saida: u.output_tokens ?? 0, cacheEscrita: u.cache_creation_input_tokens ?? 0, cacheLeitura: u.cache_read_input_tokens ?? 0 },
    }
  })
  if (!r.ok) return { ok: false, motivo: r.motivo, erro: r.erro?.replace(chave, '***') }
  return { ok: true, resposta: r.valor, custoMicroUsd: r.custoMicroUsd }
}
