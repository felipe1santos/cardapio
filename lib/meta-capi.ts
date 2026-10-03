import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { idsDeMedicaoSeguros } from '@/lib/pixels'
import { eventIdDoPedido, parametrosDoCarrinho } from '@/lib/pixel-eventos'

/**
 * API de Conversões do Meta (2026-10-03): o Purchase também sai do SERVIDOR, com o mesmo
 * event_id do navegador (`pedido-<id>`). Se o pixel do navegador for bloqueado (navegador do
 * Instagram, bloqueador, iOS), a compra ainda chega; se os dois chegarem, o Meta conta uma vez.
 *
 * Só roda se a loja tiver Pixel ID válido E o token colado em Integrações (integracoes_segredos,
 * só o servidor lê). Telefone vai em SHA-256 (exigência do Meta); nada em texto aberto.
 * Nunca atrapalha o pedido: erro só vai para o log.
 */
const VERSAO_API = 'v21.0'

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/** Telefone no formato do Meta: só dígitos, com DDI 55. */
export function telefoneNormalizado(tel: string | null | undefined): string | null {
  const d = (tel ?? '').replace(/\D/g, '')
  if (d.length < 10) return null
  return d.startsWith('55') && d.length >= 12 ? d : `55${d}`
}

export interface ContextoCompra {
  ip: string | null
  userAgent: string | null
  fbp?: string | null
  fbc?: string | null
  url?: string | null
}

/** Corpo do evento (puro, testável). */
export function montarPurchase(p: {
  pedidoId: string; numero: number; total: number; telefone: string | null
  itens: { item_id: string | null; quantidade: number; preco_unitario: number }[]
  criadoEm: Date; ctx: ContextoCompra; testCode?: string | null
}) {
  const conteudo = parametrosDoCarrinho(p.itens.filter((i) => i.item_id).map((i) => ({ itemId: i.item_id as string, qty: i.quantidade, unit: Number(i.preco_unitario) })), p.total)
  const tel = telefoneNormalizado(p.telefone)
  const ok = (v?: string | null) => (v && /^fb\.\d\.\d+\.[\w.-]{4,500}$/.test(v) ? v : undefined)
  return {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(p.criadoEm.getTime() / 1000),
      event_id: eventIdDoPedido(p.pedidoId),
      action_source: 'website',
      ...(p.ctx.url && /^https:\/\//.test(p.ctx.url) ? { event_source_url: p.ctx.url.slice(0, 500) } : {}),
      user_data: {
        ...(tel ? { ph: [sha256(tel)] } : {}),
        ...(p.ctx.ip ? { client_ip_address: p.ctx.ip } : {}),
        ...(p.ctx.userAgent ? { client_user_agent: p.ctx.userAgent.slice(0, 400) } : {}),
        ...(ok(p.ctx.fbp) ? { fbp: ok(p.ctx.fbp) } : {}),
        ...(ok(p.ctx.fbc) ? { fbc: ok(p.ctx.fbc) } : {}),
      },
      custom_data: {
        currency: conteudo.currency, value: conteudo.value, content_ids: conteudo.content_ids, contents: conteudo.contents,
        content_type: conteudo.content_type, num_items: conteudo.num_items, order_id: String(p.numero),
      },
    }],
    ...(p.testCode ? { test_event_code: p.testCode } : {}),
  }
}

/** Manda o Purchase do pedido recém-criado. Silencioso: devolve o resultado só para log/teste. */
export async function enviarPurchaseCapi(admin: SupabaseClient, restauranteId: string, pedidoId: string, ctx: ContextoCompra): Promise<{ enviado: boolean; motivo?: string }> {
  try {
    const [{ data: loja }, { data: seg }] = await Promise.all([
      admin.from('restaurantes').select('facebook_pixel_id').eq('id', restauranteId).maybeSingle(),
      admin.from('integracoes_segredos').select('meta_capi_token, meta_test_event_code').eq('restaurante_id', restauranteId).maybeSingle(),
    ])
    const { pixelId } = idsDeMedicaoSeguros(loja?.facebook_pixel_id as string | null, null)
    const token = (seg?.meta_capi_token as string | null) ?? null
    if (!pixelId || !token) return { enviado: false, motivo: 'nao_configurado' }
    const { data: ped } = await admin.from('pedidos').select('id, numero, total, cliente_telefone, criado_em, pedido_itens ( item_id, quantidade, preco_unitario )').eq('id', pedidoId).maybeSingle()
    if (!ped) return { enviado: false, motivo: 'pedido' }
    const corpo = montarPurchase({
      pedidoId, numero: ped.numero as number, total: Number(ped.total), telefone: ped.cliente_telefone as string | null,
      itens: ((ped.pedido_itens ?? []) as { item_id: string | null; quantidade: number; preco_unitario: number }[]),
      criadoEm: new Date(ped.criado_em as string), ctx, testCode: (seg?.meta_test_event_code as string | null) ?? null,
    })
    // META_CAPI_BASE só existe no servidor local de testes (aponta para um receptor falso).
    const base = process.env.META_CAPI_BASE || 'https://graph.facebook.com'
    const r = await fetch(`${base}/${VERSAO_API}/${pixelId}/events?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) {
      const txt = (await r.text().catch(() => '')).slice(0, 200)
      console.error('[meta-capi] recusado', r.status, txt)
      return { enviado: false, motivo: `http_${r.status}` }
    }
    return { enviado: true }
  } catch (err) {
    console.error('[meta-capi] falha', (err as Error).message?.slice(0, 160))
    return { enviado: false, motivo: 'erro' }
  }
}
