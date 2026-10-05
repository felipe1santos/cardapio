import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { BASE_PUBLICA } from '@/lib/mensageria/robo'
import { acessoDeRobo, TOKEN_VALIDO } from '@/lib/mensageria/campanhas'

/**
 * Link rastreável das campanhas: /c/<token> → cardápio da loja.
 *
 * O token (24 hex aleatórios, 0104) só identifica o envio; nada do cliente vai na URL.
 * Pré-visualização de link e robôs são redirecionados sem contar clique. Token errado ou
 * falha no banco nunca travam o cliente: cai no cardápio (ou na página inicial).
 */
export const dynamic = 'force-dynamic'

/** Destino com a origem marcada (item 55): WhatsApp › campanha <nome>. O token não vai adiante. */
function destino(slug: string | null, campanha: string | null = null) {
  if (!slug) return BASE_PUBLICA()
  const q = new URLSearchParams({ utm_source: 'whatsapp', utm_medium: 'campanha' })
  if (campanha) q.set('utm_campaign', campanha.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))
  return `${BASE_PUBLICA()}/loja/${encodeURIComponent(slug)}?${q}`
}

async function nomeDaCampanha(token: string): Promise<string | null> {
  const { data } = await getAdminSupabase().from('campanha_envios').select('campanhas ( nome )').eq('token', token).maybeSingle()
  return ((data as { campanhas?: { nome?: string } } | null)?.campanhas?.nome) ?? null
}

async function slugSemContar(token: string): Promise<string | null> {
  const { data } = await getAdminSupabase().from('campanha_envios').select('restaurantes ( slug )').eq('token', token).maybeSingle()
  return ((data as { restaurantes?: { slug?: string } } | null)?.restaurantes?.slug) ?? null
}

async function resolver(request: Request, token: string, contar: boolean): Promise<NextResponse> {
  let slug: string | null = null
  let campanha: string | null = null
  if (TOKEN_VALIDO.test(token)) {
    try {
      if (contar && !acessoDeRobo(request.headers.get('user-agent'))) {
        const { data } = await getAdminSupabase().rpc('campanha_registrar_clique', { p_token: token })
        slug = (data as string | null) ?? null
      } else {
        slug = await slugSemContar(token)
      }
      campanha = slug ? await nomeDaCampanha(token).catch(() => null) : null
    } catch {
      slug = null
    }
  }
  const r = NextResponse.redirect(destino(slug, campanha), 302)
  r.headers.set('Cache-Control', 'no-store')
  r.headers.set('X-Robots-Tag', 'noindex')
  r.headers.set('Referrer-Policy', 'no-referrer')
  return r
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return resolver(request, token, true)
}

// HEAD (verificação de link) nunca conta clique.
export async function HEAD(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return resolver(request, token, false)
}
