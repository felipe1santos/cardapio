import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _zerarGuarda } from './guarda'
import { extensaoDoAudio, limparTranscricao, MODELO_AUDIO, TOKENS_AUDIO_SEM_USO, transcreverAudio } from './openai-audio'
import { custoMicroUsd } from './ia'

/** Banco falso (mesmo do anthropic.test): gasto do dia em ia_uso_dia, guarda liberada; registra os RPCs chamados. */
function banco(gastoLoja = 0, permitido = true) {
  const rpcs: { fn: string; args: Record<string, unknown> }[] = []
  const admin = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args })
      if (fn === 'api_uso_contar') return { data: { permitido: permitido || args.p_api !== 'audio', chamadas: 1, limite: 200 }, error: null }
      return { data: null, error: null }
    }),
    from: (t: string) => ({
      select: () => ({
        eq: () => ({
          eq: (_c: string, escopo: string) => ({
            limit: async () => ({ data: t === 'ia_uso_dia' ? [{ custo_micro_usd: escopo === 'total' ? 0 : gastoLoja }] : [], error: null }),
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      }),
      insert: async () => ({ error: null }),
      update: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({}) }) }) }),
    }),
  }
  return { admin: admin as never, rpcs }
}
const AUDIO = { base64: Buffer.from('ogg-fake-bytes').toString('base64'), mimetype: 'audio/ogg; codecs=opus' }
const resposta = (corpo: unknown, status = 200) => vi.fn(async () => ({ ok: status < 400, status, json: async () => corpo }))

describe('transcrição de áudio (OpenAI) — Regra nº 1', () => {
  beforeEach(() => { _zerarGuarda(); process.env.OPENAI_API_KEY = 'sk-teste' })
  afterEach(() => { delete process.env.OPENAI_API_KEY })

  it('sem OPENAI_API_KEY não chama nada e devolve sem_chave (o robô responde como antes)', async () => {
    delete process.env.OPENAI_API_KEY
    const f = resposta({ text: 'x' })
    expect(await transcreverAudio(banco().admin, { loja: 'L', conversa: 'c' }, AUDIO, { fetch: f as never })).toEqual({ ok: false, motivo: 'sem_chave' })
    expect(f).not.toHaveBeenCalled()
  })
  it('transcreve: multipart com modelo, pt e arquivo; custo pelos tokens; conta em "audio" E em "ia"', async () => {
    const f = resposta({ text: '  Quero   um x-tudo sem cebola  ', usage: { type: 'tokens', input_tokens: 300, output_tokens: 12 } })
    const b = banco()
    const r = await transcreverAudio(b.admin, { loja: 'L', conversa: 'c' }, AUDIO, { fetch: f as never })
    expect(r).toEqual({ ok: true, texto: 'Quero um x-tudo sem cebola', custoMicroUsd: custoMicroUsd(MODELO_AUDIO, { entrada: 300, saida: 12 }) })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-teste')
    const form = init.body as FormData
    expect(form.get('model')).toBe(MODELO_AUDIO)
    expect(form.get('language')).toBe('pt')
    expect((form.get('file') as File).name).toBe('audio.ogg')
    expect(b.rpcs.filter((x) => x.fn === 'api_uso_contar').map((x) => x.args.p_api)).toEqual(['audio', 'ia'])
    expect(b.rpcs.some((x) => x.fn === 'ia_uso_registrar' && x.args.p_modelo === MODELO_AUDIO)).toBe(true)
  })
  it('sem usage na resposta cobra como 2 minutos (nunca subestima)', async () => {
    const f = resposta({ text: 'oi' })
    const r = await transcreverAudio(banco().admin, { loja: 'L', conversa: 'c' }, AUDIO, { fetch: f as never })
    expect(r).toMatchObject({ ok: true, custoMicroUsd: custoMicroUsd(MODELO_AUDIO, { entrada: TOKENS_AUDIO_SEM_USO, saida: 0 }) })
  })
  it('teto em US$ da loja atingido → não chama (mesmo teto do Agente de IA)', async () => {
    const f = resposta({ text: 'oi' })
    expect(await transcreverAudio(banco(500_000).admin, { loja: 'L', conversa: 'c' }, AUDIO, { fetch: f as never })).toMatchObject({ ok: false, motivo: 'teto' })
    expect(f).not.toHaveBeenCalled()
  })
  it('LIMITE_AUDIO_DIA atingido → não chama', async () => {
    const f = resposta({ text: 'oi' })
    expect(await transcreverAudio(banco(0, false).admin, { loja: 'L', conversa: 'c' }, AUDIO, { fetch: f as never })).toMatchObject({ ok: false, motivo: 'limite' })
    expect(f).not.toHaveBeenCalled()
  })
  it('erro HTTP vira motivo erro sem vazar a chave; texto vazio vira "vazio"; áudio vazio/grande não sai', async () => {
    const f = resposta({ error: { type: 'invalid_request_error' } }, 400)
    const r = await transcreverAudio(banco().admin, { loja: 'L', conversa: 'c' }, AUDIO, { fetch: f as never })
    expect(r).toMatchObject({ ok: false, motivo: 'erro' })
    expect(JSON.stringify(r)).not.toContain('sk-teste')
    expect(await transcreverAudio(banco().admin, { loja: 'L', conversa: 'c2' }, AUDIO, { fetch: resposta({ text: '   ' }) as never })).toEqual({ ok: false, motivo: 'vazio' })
    expect(await transcreverAudio(banco().admin, { loja: 'L', conversa: 'c3' }, { base64: '' }, { fetch: f as never })).toEqual({ ok: false, motivo: 'vazio' })
    expect(await transcreverAudio(banco().admin, { loja: 'L', conversa: 'c4' }, { base64: Buffer.alloc(21 * 1024 * 1024).toString('base64') }, { fetch: f as never })).toEqual({ ok: false, motivo: 'grande' })
  })
  it('helpers puros: extensão pelo mimetype e limpeza a 990 caracteres', () => {
    expect(extensaoDoAudio('audio/ogg; codecs=opus')).toBe('ogg')
    expect(extensaoDoAudio('audio/mp4')).toBe('m4a')
    expect(extensaoDoAudio(null)).toBe('ogg')
    expect(limparTranscricao('a'.repeat(2000))).toHaveLength(990)
  })
})
