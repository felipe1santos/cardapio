/**
 * Resend — e-mail transacional da Menuzia (02/11/2026). ÚNICO arquivo que fala com api.resend.com.
 *
 * Primeiro uso: "acesso liberado" da assinatura (docs/ASSINATURA-ASAAS.md). Passa por `chamarApiPaga` (api 'email',
 * LIMITE_EMAIL_DIA, 200/dia). Sem `RESEND_API_KEY` o envio é pulado com aviso no log — e-mail nunca derruba o fluxo
 * que o chamou (o acesso já foi liberado no banco). Remetente em `EMAIL_REMETENTE` (ex.: Menuzia <nao-responda@menuzia.com.br>).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { chamarApiPaga } from './guarda'

const TIMEOUT_MS = 10_000

export interface EmailParaEnviar { para: string; assunto: string; html: string; texto: string }
export type ResultadoEmail = { ok: true; id: string | null } | { ok: false; motivo: 'sem_chave' | 'guarda' | 'erro'; erro?: string }

export function emailConfigurado(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.RESEND_API_KEY && !!env.EMAIL_REMETENTE
}

export async function enviarEmail(admin: SupabaseClient, e: EmailParaEnviar): Promise<ResultadoEmail> {
  const chave = process.env.RESEND_API_KEY
  const de = process.env.EMAIL_REMETENTE
  if (!chave || !de) {
    console.warn('[email] RESEND_API_KEY/EMAIL_REMETENTE ausentes — e-mail não enviado:', e.assunto)
    return { ok: false, motivo: 'sem_chave' }
  }
  const r = await chamarApiPaga(admin, { api: 'email', chave: `${e.para}:${e.assunto}`.slice(0, 120) }, async () => {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: de, to: [e.para], subject: e.assunto, html: e.html, text: e.texto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const texto = await res.text()
    if (!res.ok) {
      console.error(`[email] ${res.status} ${texto.slice(0, 200)}`)
      throw new Error(`resend ${res.status}`)
    }
    try { return (JSON.parse(texto) as { id?: string }).id ?? null } catch { return null }
  })
  if (r.ok) return { ok: true, id: r.valor }
  return { ok: false, motivo: r.motivo === 'erro' ? 'erro' : 'guarda', erro: r.erro }
}
