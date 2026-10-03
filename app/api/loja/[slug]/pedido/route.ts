import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { criarPedido } from '@/lib/queries/pedidos'
import { montarPedidoPublico } from '@/lib/queries/pedido-publico'
import { notificarPedido } from '@/lib/whatsapp'
import { registrarPedidoDoPush } from '@/lib/push/motor'
import { enviarPurchaseCapi } from '@/lib/meta-capi'
import { ipDaRequisicao } from '@/lib/limite-taxa'

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params

  let bruto: unknown
  try {
    bruto = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  // Nada de repassar o corpo inteiro: `origem`, `canal`, `comandaId` e companhia são
  // decisão do servidor. Ver lib/queries/pedido-publico.ts.
  const { ok, recusados, erro, input } = montarPedidoPublico(bruto)
  if (erro) return NextResponse.json({ error: erro }, { status: 400 })
  if (!ok || !input) {
    if (recusados.length > 0) {
      // Registra a tentativa sem guardar o payload: só os nomes dos campos.
      console.warn('[seguranca] pedido público com campos internos recusado', { slug, campos: recusados })
      return NextResponse.json(
        { error: `Campos não aceitos neste endereço: ${recusados.join(', ')}` },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()

  const { data: loja, error: lojaError } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (lojaError) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  // Mesma tentativa de checkout chegando de novo (resposta perdida, toque duplo): devolve
  // o pedido que já existe. Sem notificar de novo — o cliente já foi avisado na primeira.
  const chave = input.chaveIdempotencia
  if (chave) {
    const existente = await pedidoPorChave(admin, loja.id, chave)
    if (existente) return NextResponse.json(existente, { status: 200 })
  }

  try {
    let pedido: { id: string; numero: number }
    try {
      pedido = await criarPedido(admin, loja.id, input)
    } catch (err) {
      // As duas chegaram juntas: a primeira criou, a segunda bateu no índice único da 0065.
      if (chave && (err as { code?: string })?.code === '23505') {
        const vencedor = await pedidoPorChave(admin, loja.id, chave)
        if (vencedor) return NextResponse.json(vencedor, { status: 200 })
      }
      throw err
    }
    notificarPedido(admin, pedido.id, 'recebido').catch((err) => console.error('[whatsapp] erro ao notificar pedido recebido', err))
    // Pedido até 48 h depois de tocar numa notificação push: conta para o relatório da loja (0127).
    const origemPush = (bruto as { origemPush?: unknown }).origemPush
    if (typeof origemPush === 'string' && /^[0-9a-f-]{36}$/i.test(origemPush)) {
      registrarPedidoDoPush(admin, loja.id, origemPush, pedido.id).catch(() => null)
    }
    // API de Conversões do Meta (só com pixel + token da loja): mesma compra do navegador, mesmo event_id.
    const meta = (bruto as { meta?: { fbp?: unknown; fbc?: unknown; url?: unknown } }).meta
    const txt = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : null)
    const ip = ipDaRequisicao(request.headers)
    enviarPurchaseCapi(admin, loja.id, pedido.id, {
      ip: ip && ip !== 'desconhecido' ? ip : null, userAgent: request.headers.get('user-agent'),
      fbp: txt(meta?.fbp), fbc: txt(meta?.fbc), url: txt(meta?.url),
    }).catch(() => null)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

async function pedidoPorChave(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string, chave: string) {
  const { data } = await admin
    .from('pedidos')
    .select('id, numero')
    .eq('restaurante_id', restauranteId)
    .eq('chave_idempotencia', chave)
    .maybeSingle()
  return data ? { id: data.id as string, numero: data.numero as number } : null
}
