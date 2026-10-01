import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarClientePorToken, buscarRestauranteIdPorSlug } from '@/lib/queries/clientes'
import { CATEGORIAS } from '@/lib/push/regras'
import { soDigitos } from '@/lib/push/motor'

/**
 * Assinatura de push da vitrine (0127). Uma por aparelho × loja (o service worker da loja tem
 * escopo /loja/<slug>, então o endpoint é da loja). Vínculo com o cliente só com prova: sessão
 * (telefone + token) ou o id do pedido recém-feito nesta loja. O endpoint é o segredo do aparelho
 * para mudar categorias ou cancelar.
 */
const VALIDAS = new Set<string>(CATEGORIAS.map((c) => c.id))
const PLATAFORMAS = new Set(['android', 'ios', 'desktop', 'outro'])

interface Corpo {
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  endpoint?: string
  categorias?: string[]
  plataforma?: string
  navegador?: string
  instalado?: boolean
  telefone?: string
  token?: string
  pedidoId?: string
}

function categoriasValidas(c: unknown): string[] | null {
  if (!Array.isArray(c)) return null
  return [...new Set(c.filter((x): x is string => typeof x === 'string' && VALIDAS.has(x)))]
}

function endpointValido(e: unknown): e is string {
  return typeof e === 'string' && e.startsWith('https://') && e.length <= 1000
}

type Contexto = { body: Corpo; admin: SupabaseClient; restauranteId: string } | { erro: NextResponse }

async function contexto(request: Request, params: Promise<{ slug: string }>): Promise<Contexto> {
  const { slug } = await params
  let body: Corpo
  try { body = await request.json() } catch { return { erro: NextResponse.json({ error: 'Corpo inválido' }, { status: 400 }) } }
  const admin = getAdminSupabase()
  const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
  if (!restauranteId) return { erro: NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 }) }
  return { body, admin, restauranteId }
}

/** Ativa (ou reativa) a assinatura deste aparelho nesta loja. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await contexto(request, params)
  if ('erro' in c) return c.erro
  const { body, admin, restauranteId } = c
  const { data: loja } = await admin.from('restaurantes').select('push_liberado').eq('id', restauranteId).maybeSingle()
  if (!loja?.push_liberado) return NextResponse.json({ error: 'Notificações indisponíveis nesta loja.' }, { status: 403 })

  const s = body.subscription
  const endpoint = s?.endpoint
  const p256dh = s?.keys?.p256dh
  const auth = s?.keys?.auth
  if (!endpointValido(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
    return NextResponse.json({ error: 'Assinatura inválida' }, { status: 400 })
  }
  const categorias = categoriasValidas(body.categorias) ?? CATEGORIAS.map((x) => x.id)

  // Vínculo com o cliente (só com prova)
  let clienteTelefone: string | null = null
  let clienteId: string | null = null
  if (body.telefone && body.token) {
    const cli = await buscarClientePorToken(admin, restauranteId, body.telefone, body.token)
    if (cli) clienteTelefone = soDigitos(cli.telefone) || null
  }
  if (!clienteTelefone && body.pedidoId && /^[0-9a-f-]{36}$/i.test(body.pedidoId)) {
    const { data: p } = await admin.from('pedidos').select('cliente_telefone, criado_em').eq('id', body.pedidoId).eq('restaurante_id', restauranteId).maybeSingle()
    // Só pedido recente (o convite aparece logo depois de pedir).
    if (p && Date.now() - new Date(p.criado_em).getTime() < 24 * 3600_000) clienteTelefone = soDigitos(p.cliente_telefone) || null
  }
  if (clienteTelefone) {
    const { data: cl } = await admin.from('clientes').select('id').eq('restaurante_id', restauranteId).eq('telefone', clienteTelefone).maybeSingle()
    clienteId = cl?.id ?? null
  }

  const agora = new Date().toISOString()
  const { data: existente } = await admin.from('push_assinaturas').select('id, cliente_telefone, cliente_id').eq('restaurante_id', restauranteId).eq('endpoint', endpoint).maybeSingle()
  const linha = {
    restaurante_id: restauranteId,
    endpoint,
    p256dh,
    auth,
    plataforma: PLATAFORMAS.has(body.plataforma ?? '') ? body.plataforma : 'outro',
    navegador: String(body.navegador ?? '').slice(0, 40),
    instalado: Boolean(body.instalado),
    categorias,
    // Consentimento (LGPD): data e categorias de cada ativação.
    consentimento_em: agora,
    status: 'ativa',
    falhas_seguidas: 0,
    // Não perde o vínculo que já existia se esta ativação veio sem prova.
    cliente_telefone: clienteTelefone ?? existente?.cliente_telefone ?? null,
    cliente_id: clienteId ?? existente?.cliente_id ?? null,
    atualizado_em: agora,
  }
  const { error } = existente
    ? await admin.from('push_assinaturas').update(linha).eq('id', existente.id)
    : await admin.from('push_assinaturas').insert(linha)
  if (error) return NextResponse.json({ error: 'Não foi possível ativar.' }, { status: 500 })
  return NextResponse.json({ ok: true, categorias, vinculado: Boolean(linha.cliente_telefone) })
}

/** Muda as categorias deste aparelho. */
export async function PATCH(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await contexto(request, params)
  if ('erro' in c) return c.erro
  const categorias = categoriasValidas(c.body.categorias)
  if (!endpointValido(c.body.endpoint) || !categorias) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  const agora = new Date().toISOString()
  const { data } = await c.admin.from('push_assinaturas')
    .update({ categorias, consentimento_em: agora, atualizado_em: agora })
    .eq('restaurante_id', c.restauranteId).eq('endpoint', c.body.endpoint).select('id')
  if (!data?.length) return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true, categorias })
}

/** Cancela as notificações deste aparelho nesta loja. */
export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const c = await contexto(request, params)
  if ('erro' in c) return c.erro
  if (!endpointValido(c.body.endpoint)) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  await c.admin.from('push_assinaturas').update({ status: 'cancelada', atualizado_em: new Date().toISOString() })
    .eq('restaurante_id', c.restauranteId).eq('endpoint', c.body.endpoint)
  return NextResponse.json({ ok: true })
}
