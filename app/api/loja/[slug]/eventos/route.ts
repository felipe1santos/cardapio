import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { normalizarLoteEventos } from '@/lib/vitrine-eventos'
import { criarLimitador, ipDaRequisicao } from '@/lib/limite-taxa'
import { categoriaNavegador, ehRobo } from '@/lib/navegador'

/**
 * Recebe os eventos de navegação da vitrine (ver lib/vitrine-rastreio.ts).
 *
 * Chega por `sendBeacon`, então a resposta não é lida por ninguém — por isso
 * erro de validação vira 204 silencioso em vez de 400: não há quem trate, e
 * analytics nunca pode atrapalhar o pedido. Só a loja inexistente responde 404.
 *
 * A hora do evento é a do SERVIDOR menos a idade que o navegador informa: o
 * relógio do celular do cliente pode estar horas errado, a idade não.
 */
const idPorSlug = new Map<string, { id: string; em: number }>()
const CACHE_MS = 10 * 60_000
// Envio anônimo por natureza (sendBeacon), mas não sem freio: um navegador manda poucos
// lotes por minuto; enxurrada do mesmo IP é descartada em silêncio (B16).
const lotesPorIp = criarLimitador({ max: 60, janelaMs: 60_000 })

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  // Robô e pré-visualização de link (WhatsApp, Facebook) não são visita (2026-10-03).
  const ua = request.headers.get('user-agent')
  // Testes automáticos (Chrome headless) só contam no servidor local com a chave de teste.
  if (ehRobo(ua) && !(process.env.E2E_ACEITA_HEADLESS === '1' && /HeadlessChrome/.test(ua ?? ''))) return new NextResponse(null, { status: 204 })
  const { navegador, sistema } = categoriaNavegador(ua)
  const chave = `${ipDaRequisicao(request.headers)}:${slug}`
  if (lotesPorIp.excedeu(chave)) return new NextResponse(null, { status: 204 })
  lotesPorIp.registrar(chave)

  let corpo: unknown
  try {
    corpo = JSON.parse(await request.text())
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  const lote = normalizarLoteEventos(corpo, Date.now())
  if (!lote.length) return new NextResponse(null, { status: 204 })

  const admin = getAdminSupabase()
  let lojaId = idPorSlug.get(slug)
  if (!lojaId || Date.now() - lojaId.em > CACHE_MS) {
    const { data: loja } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
    if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
    lojaId = { id: loja.id as string, em: Date.now() }
    idPorSlug.set(slug, lojaId)
  }

  const { error } = await admin
    .from('vitrine_eventos')
    .insert(lote.map((e) => ({ ...e, restaurante_id: lojaId.id, navegador, sistema })))
  // item_id de item apagado (ou forjado) viola a FK: tenta de novo sem ele em
  // vez de perder o lote inteiro.
  if (error?.code === '23503') {
    await admin.from('vitrine_eventos').insert(lote.map((e) => ({ ...e, item_id: null, restaurante_id: lojaId.id, navegador, sistema })))
  } else if (error?.code === '42703' || error?.code === 'PGRST204') {
    // Banco ainda sem a 0138 (navegador/sistema): grava sem eles.
    await admin.from('vitrine_eventos').insert(lote.map((e) => ({ ...e, restaurante_id: lojaId.id })))
  } else if (error) {
    console.error('[vitrine-eventos] falha ao gravar', error.message)
  }
  return new NextResponse(null, { status: 204 })
}
