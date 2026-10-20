import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from './guarda'
import { chamarIa, type ResultadoIa } from './ia'

/**
 * TRANSCRIÇÃO DE ÁUDIO (OpenAI gpt-4o-mini-transcribe — aprovado pelo dono em 20/10/2026, Etapa 5 do modo autônomo).
 * A ÚNICA requisição à OpenAI do sistema (Regra nº 1, docs/REGRAS-DE-CUSTO.md). Duas guardas, uma dentro da outra:
 *   1. `chamarApiPaga` api 'audio': trava de disparo + LIMITE_AUDIO_DIA por loja/sistema (padrão 200 áudios/dia);
 *   2. `chamarIa`: teto em US$ do dia (sistema e loja — o MESMO teto do Agente de IA) e registro do custo em ia_uso_dia,
 *      com o modelo 'gpt-4o-mini-transcribe' (preço em lib/custo/ia.ts › PRECOS_IA).
 * Chave só em OPENAI_API_KEY (Coolify, sem Build time). Sem chave → { ok: false, motivo: 'sem_chave' } e o robô
 * responde como antes ("não consigo ouvir áudio"). Sem SDK (só fetch, multipart). Sem nova tentativa.
 * Custo: ≈ US$ 0,003/min (≈ R$ 0,008 por áudio de 30 s). Áudio acima de 20 MB não é enviado.
 */
export const MODELO_AUDIO = 'gpt-4o-mini-transcribe'
export const TAMANHO_MAX_AUDIO_BYTES = 20 * 1024 * 1024
/** Sem `usage` na resposta: cobra como 2 minutos de áudio (≈ 2.000 tokens de áudio) — nunca subestima. */
export const TOKENS_AUDIO_SEM_USO = 2000
const URL_PADRAO = 'https://api.openai.com'

export type ResultadoTranscricao =
  | { ok: true; texto: string; custoMicroUsd: number }
  | { ok: false; motivo: 'sem_chave' | 'grande' | 'vazio' | Exclude<ResultadoIa<never>, { ok: true }>['motivo']; erro?: string }

/** Base da API: a oficial; outra só se for servidor de teste local (e2e com API simulada). */
function baseDaApi(): string {
  const b = process.env.OPENAI_BASE_URL?.trim()
  return b && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(b) ? b : URL_PADRAO
}

/** Extensão do arquivo pelo mimetype do WhatsApp (ogg/opus é o padrão da Evolution). Pura. */
export function extensaoDoAudio(mimetype: string | null | undefined): string {
  const m = (mimetype ?? '').toLowerCase()
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'm4a'
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3'
  if (m.includes('wav')) return 'wav'
  if (m.includes('webm')) return 'webm'
  return 'ogg'
}

/** Texto final: sem espaços sobrando e no máximo 1.000 caracteres (limite da coluna whatsapp_mensagens.texto). Pura. */
export function limparTranscricao(texto: unknown): string {
  return String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, 990)
}

export async function transcreverAudio(
  admin: SupabaseClient,
  p: { loja: string | null; conversa: string; tetoLojaUsd?: number | null },
  audio: { base64: string; mimetype?: string | null },
  opcoes: { timeoutMs?: number; fetch?: typeof fetch } = {},
): Promise<ResultadoTranscricao> {
  const chave = process.env.OPENAI_API_KEY?.trim()
  if (!chave) return { ok: false, motivo: 'sem_chave' }
  const bytes = Buffer.from(audio.base64, 'base64')
  if (bytes.length === 0) return { ok: false, motivo: 'vazio' }
  if (bytes.length > TAMANHO_MAX_AUDIO_BYTES) return { ok: false, motivo: 'grande' }
  const buscar = opcoes.fetch ?? fetch
  const timeout = Math.max(1, opcoes.timeoutMs ?? 20_000)

  // Guarda 1: contagem de áudios por dia (LIMITE_AUDIO_DIA). Guarda 2 (dentro): teto em dinheiro + custo real.
  const g = await chamarApiPaga(admin, { api: 'audio', chave: `conversa:${p.conversa}`, loja: p.loja }, () =>
    chamarIa<string>(admin, p, async () => {
      const form = new FormData()
      form.append('model', MODELO_AUDIO)
      form.append('language', 'pt')
      form.append('response_format', 'json')
      form.append('file', new Blob([bytes], { type: audio.mimetype ?? 'audio/ogg' }), `audio.${extensaoDoAudio(audio.mimetype)}`)
      const res = await buscar(`${baseDaApi()}/v1/audio/transcriptions`, {
        method: 'POST', headers: { authorization: `Bearer ${chave}` }, body: form, signal: AbortSignal.timeout(timeout),
      })
      const j = (await res.json().catch(() => null)) as {
        text?: string; error?: { type?: string; code?: string }
        usage?: { type?: string; input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number; text_tokens?: number } }
      } | null
      // Só o código e o tipo do erro (nunca o áudio nem a chave).
      if (!res.ok || !j) throw new Error(`HTTP ${res.status}${j?.error?.type ? ` ${j.error.type}` : ''}`)
      const u = j.usage
      const entrada = u && Number.isFinite(Number(u.input_tokens)) ? Number(u.input_tokens) : TOKENS_AUDIO_SEM_USO
      return { valor: limparTranscricao(j.text), modelo: MODELO_AUDIO, uso: { entrada, saida: Number(u?.output_tokens ?? 0) || 0 } }
    }),
  )
  if (!g.ok) return { ok: false, motivo: g.motivo, erro: g.erro?.replace(chave, '***') }
  const r = g.valor
  if (!r.ok) return { ok: false, motivo: r.motivo, erro: r.erro?.replace(chave, '***') }
  if (!r.valor) return { ok: false, motivo: 'vazio' }
  return { ok: true, texto: r.valor, custoMicroUsd: r.custoMicroUsd }
}
