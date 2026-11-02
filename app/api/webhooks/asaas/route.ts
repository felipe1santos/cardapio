import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarCobrancaAsaas } from '@/lib/custo/asaas'
import { enviarEmail } from '@/lib/custo/resend'
import { emailAcessoLiberado } from '@/lib/assinatura/email'
import { repoSupabase } from '@/lib/assinatura/repo'
import { lerEvento, processarEventoAsaas, tokenConfere } from '@/lib/assinatura/webhook'
import { urlPublica } from '@/lib/url-publica'

export const dynamic = 'force-dynamic'

/**
 * Webhook do Asaas (docs/ASSINATURA-ASAAS.md).
 * 1. `asaas-access-token` ≠ ASAAS_WEBHOOK_TOKEN → 401, nada muda.
 * 2. Corpo sem id/evento/cobrança → 200 sem efeito (o Asaas não deve reenviar lixo).
 * 3. Id do evento gravado antes de qualquer efeito; repetido → 200. A cobrança é reconsultada na API.
 * 4. Erro nosso (banco/API fora) → 500: o Asaas reenvia (15 falhas seguidas pausam a fila lá; ver Logs de Webhooks).
 */
export async function POST(request: Request) {
  if (!tokenConfere(request.headers.get('asaas-access-token'), process.env.ASAAS_WEBHOOK_TOKEN)) {
    return NextResponse.json({ error: 'token inválido' }, { status: 401 })
  }
  const ev = lerEvento(await request.json().catch(() => null))
  if (!ev) return NextResponse.json({ ok: true, ignorado: 'corpo' })

  const admin = getAdminSupabase()
  try {
    const resultado = await processarEventoAsaas(ev, {
      repo: repoSupabase(admin),
      buscarCobranca: (id) => buscarCobrancaAsaas(admin, id),
      avisarAcessoLiberado: async (d) => {
        const m = emailAcessoLiberado({ ...d, urlBase: urlPublica() })
        const r = await enviarEmail(admin, { para: d.email, assunto: m.assunto, html: m.html, texto: m.texto })
        if (!r.ok) console.warn('[assinatura] e-mail de acesso liberado não enviado:', r.motivo, r.erro ?? '')
      },
    })
    return NextResponse.json({ ok: true, resultado })
  } catch (e) {
    console.error('[webhook asaas]', ev.id, (e as Error).message)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
