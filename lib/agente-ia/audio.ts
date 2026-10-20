import type { SupabaseClient } from '@supabase/supabase-js'
import { provedorAtual } from '@/lib/mensageria/provedor'
import { transcreverAudio } from '@/lib/custo/openai-audio'

/**
 * Áudio do cliente no WhatsApp (20/10/2026, aprovado pelo dono): com o Agente de IA ligado na loja, o áudio é baixado da
 * Evolution e transcrito pela OpenAI (lib/custo/openai-audio.ts: LIMITE_AUDIO_DIA + teto em US$ da IA). O texto volta
 * para o motor como se o cliente tivesse ESCRITO — robô e IA tratam igual — e fica gravado na mensagem ("🎤 …") para a
 * central de atendimento. Qualquer falha (sem chave, teto, mídia indisponível) devolve ok=false e o robô responde como
 * antes ("não consigo ouvir áudio"). Nunca lança.
 */
export type ResultadoAudio = { ok: true; texto: string; custoMicroUsd: number } | { ok: false; motivo: string }

export async function transcreverAudioDoCliente(
  admin: SupabaseClient,
  p: { restauranteId: string; conversaId: string; mensagemId: string | null; instancia: string; waId: string; tetoLojaUsd?: number | string | null },
): Promise<ResultadoAudio> {
  try {
    if (!process.env.OPENAI_API_KEY?.trim()) return { ok: false, motivo: 'sem_chave' }
    const bruto = await provedorAtual().baixarAudio(p.instancia, p.waId).catch(() => null)
    if (!bruto) return { ok: false, motivo: 'sem_midia' }
    const teto = p.tetoLojaUsd === null || p.tetoLojaUsd === undefined || p.tetoLojaUsd === '' ? null : Number(p.tetoLojaUsd)
    const r = await transcreverAudio(admin, { loja: p.restauranteId, conversa: p.conversaId, tetoLojaUsd: Number.isFinite(teto as number) ? teto : null }, bruto)
    if (!r.ok) {
      if (r.motivo !== 'sem_chave') console.error(`[audio] transcrição falhou (${r.motivo})${r.erro ? `: ${r.erro}` : ''}`)
      return { ok: false, motivo: r.motivo }
    }
    // A transcrição fica na mensagem: a central mostra o que o cliente disse e o histórico da IA lê o texto.
    if (p.mensagemId) {
      await admin.from('whatsapp_mensagens').update({ texto: `🎤 ${r.texto}`.slice(0, 1000) }).eq('id', p.mensagemId).eq('restaurante_id', p.restauranteId).then(() => {}, () => {})
    }
    return r
  } catch (e) {
    console.error('[audio] transcrição:', (e as Error).message?.slice(0, 160))
    return { ok: false, motivo: 'erro' }
  }
}
