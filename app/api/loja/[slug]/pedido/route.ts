import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { criarPedido } from '@/lib/queries/pedidos'
import { montarPedidoPublico } from '@/lib/queries/pedido-publico'
import { notificarPedido } from '@/lib/whatsapp'
import { registrarPedidoDoPush } from '@/lib/push/motor'
import { avisarPainelPedidoNovo } from '@/lib/push/painel-pedidos'
import { criarCobrancaPix, pixOnlineDaLoja } from '@/lib/pagamentos/pix-online'
import { reverterBeneficiosPedidoCancelado } from '@/lib/fidelidade'
import { enviarPurchaseCapi } from '@/lib/meta-capi'
import { ipDaRequisicao } from '@/lib/limite-taxa'
import { alertarValorManipulado, camposDeValorEnviados } from '@/lib/financeiro/manipulacao'

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

  // Preço, total e desconto são do servidor: se vieram no corpo, alguém mexeu por fora do app (Fase 6).
  const manipulados = camposDeValorEnviados(bruto)
  if (manipulados.length) void alertarValorManipulado(admin, loja.id, manipulados, ipDaRequisicao(request.headers) ?? 'desconhecido')

  // Mesma tentativa de checkout chegando de novo (resposta perdida, toque duplo): devolve
  // o pedido que já existe. Sem notificar de novo — o cliente já foi avisado na primeira.
  const chave = input.chaveIdempotencia
  if (chave) {
    const existente = await pedidoPorChave(admin, loja.id, chave)
    if (existente) return NextResponse.json(await comPix(admin, loja.id, existente), { status: 200 })
  }

  // Pix online só se a loja oferece AGORA (flag + conta do Mercado Pago conectada) — nunca pela palavra do navegador.
  if (input.pixOnline && !(await pixOnlineDaLoja(admin, loja.id).catch(() => ({ ativo: false }))).ativo) {
    return NextResponse.json({ error: 'O Pix online não está disponível agora. Escolha outra forma de pagamento.' }, { status: 409 })
  }

  try {
    let pedido: { id: string; numero: number }
    try {
      pedido = await criarPedido(admin, loja.id, input)
    } catch (err) {
      // As duas chegaram juntas: a primeira criou, a segunda bateu no índice único da 0065.
      if (chave && (err as { code?: string })?.code === '23505') {
        const vencedor = await pedidoPorChave(admin, loja.id, chave)
        if (vencedor) return NextResponse.json(await comPix(admin, loja.id, vencedor), { status: 200 })
      }
      throw err
    }
    const meta = (bruto as { meta?: { fbp?: unknown; fbc?: unknown; url?: unknown } }).meta
    const txt = (v: unknown) => (typeof v === 'string' ? v.slice(0, 500) : null)
    const ip = ipDaRequisicao(request.headers)
    const contextoCompra = {
      ip: ip && ip !== 'desconhecido' ? ip : null, userAgent: request.headers.get('user-agent'),
      fbp: txt(meta?.fbp), fbc: txt(meta?.fbc), url: txt(meta?.url),
    }
    // Pix online (0148): o pedido espera o pagamento. Nada de WhatsApp "recebido", push do painel nem
    // compra no Meta agora — tudo isso sai na CONFIRMAÇÃO pela API (lib/pagamentos/pix-online.ts).
    if (input.pixOnline) {
      try {
        const pix = await criarCobrancaPix(admin, { restauranteId: loja.id, pedidoId: pedido.id, contexto: contextoCompra })
        return NextResponse.json({ ...pedido, aguardandoPagamento: true, pix }, { status: 201 })
      } catch (e) {
        console.error('[pix-online] cobrança não criada:', (e as Error).message?.slice(0, 160))
        await cancelarSemCobranca(admin, loja.id, pedido.id)
        return NextResponse.json({ error: 'Não foi possível gerar o Pix agora. Escolha outra forma de pagamento.' }, { status: 502 })
      }
    }
    notificarPedido(admin, pedido.id, 'recebido').catch((err) => console.error('[whatsapp] erro ao notificar pedido recebido', err))
    // Push do painel (0146): a equipe ouve o pedido novo com o celular/tablet de tela apagada.
    // Agendado não é pedido novo agora — entra no Kanban perto do horário.
    if (!input.agendadoPara) {
      avisarPainelPedidoNovo(admin, loja.id, { id: pedido.id, numero: pedido.numero, canal: input.tipo }).catch(() => null)
    }
    // Pedido até 48 h depois de tocar numa notificação push: conta para o relatório da loja (0127).
    const origemPush = (bruto as { origemPush?: unknown }).origemPush
    if (typeof origemPush === 'string' && /^[0-9a-f-]{36}$/i.test(origemPush)) {
      registrarPedidoDoPush(admin, loja.id, origemPush, pedido.id).catch(() => null)
    }
    // API de Conversões do Meta (só com pixel + token da loja): mesma compra do navegador, mesmo event_id.
    enviarPurchaseCapi(admin, loja.id, pedido.id, contextoCompra).catch(() => null)
    return NextResponse.json(pedido, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível registrar o pedido'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

/** Repetição do checkout de um pedido que espera o Pix online: devolve a MESMA cobrança (sem gerar outra). */
async function comPix(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string, pedido: { id: string; numero: number }) {
  const { data } = await admin.from('pedidos').select('status').eq('id', pedido.id).maybeSingle()
  if (data?.status !== 'aguardando_pagamento') return pedido
  try {
    return { ...pedido, aguardandoPagamento: true, pix: await criarCobrancaPix(admin, { restauranteId, pedidoId: pedido.id }) }
  } catch {
    return { ...pedido, aguardandoPagamento: true }
  }
}

/** O MP não gerou a cobrança: o pedido não pode ficar esperando um Pix que não existe. */
async function cancelarSemCobranca(admin: ReturnType<typeof getAdminSupabase>, restauranteId: string, pedidoId: string) {
  const { data } = await admin.from('pedidos').update({
    status: 'cancelado', cancelado_motivo: 'outro', cancelado_observacao: 'Pix online: o Mercado Pago não gerou a cobrança', cancelado_por: 'sistema',
    cancelado_em: new Date().toISOString(), reimprimir: false,
  }).eq('id', pedidoId).eq('status', 'aguardando_pagamento').select('id').maybeSingle()
  if (data) await reverterBeneficiosPedidoCancelado(admin, restauranteId, pedidoId)
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
