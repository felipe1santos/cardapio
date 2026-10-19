import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { podeNotificarCanal } from '@/lib/auth/permissoes'
import { EdicaoError, editarPedido, type EdicaoPedido } from '@/lib/pedidos/editar'

/**
 * Editar um pedido já criado (18/10): itens (adicionar/remover/quantidade/observação), endereço e pagamento.
 *   POST { itens?, endereco?, pagamento?, pagoOnline?: { escolha, aprovacao? }, reimprimir? }
 * Quem edita: quem pode mover pedidos de delivery (dono, gerente, atendente, logística) — até o despacho
 * (lib/pedido-editavel.ts). Tudo recalculado no servidor (lib/pedidos/editar.ts); nada de total vindo do navegador.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })
  if (!podeNotificarCanal(sessao.papel, 'delivery')) return NextResponse.json({ error: 'Você não tem permissão para editar pedidos.' }, { status: 403 })
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  const corpo = (await request.json().catch(() => null)) as EdicaoPedido | null
  if (!corpo || typeof corpo !== 'object') return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 })
  const edicao: EdicaoPedido = {
    itens: corpo.itens && typeof corpo.itens === 'object' ? {
      adicionar: Array.isArray(corpo.itens.adicionar) ? corpo.itens.adicionar.slice(0, 50) : undefined,
      remover: Array.isArray(corpo.itens.remover) ? corpo.itens.remover.filter((x): x is string => typeof x === 'string').slice(0, 100) : undefined,
      quantidade: Array.isArray(corpo.itens.quantidade) ? corpo.itens.quantidade.filter((q) => q && typeof q.itemId === 'string' && Number.isFinite(Number(q.quantidade))).map((q) => ({ itemId: q.itemId, quantidade: Number(q.quantidade) })) : undefined,
      observacao: Array.isArray(corpo.itens.observacao) ? corpo.itens.observacao.filter((o) => o && typeof o.itemId === 'string').map((o) => ({ itemId: o.itemId, observacao: String(o.observacao ?? '').slice(0, 300) })) : undefined,
    } : undefined,
    endereco: corpo.endereco && typeof corpo.endereco === 'object' && typeof corpo.endereco.rua === 'string' ? {
      rua: corpo.endereco.rua.trim().slice(0, 120), numero: String(corpo.endereco.numero ?? '').trim().slice(0, 20), complemento: String(corpo.endereco.complemento ?? '').trim().slice(0, 120),
      bairro: String(corpo.endereco.bairro ?? '').trim().slice(0, 80), cep: String(corpo.endereco.cep ?? '').replace(/\D/g, '').slice(0, 8), cidade: String(corpo.endereco.cidade ?? '').trim().slice(0, 80), referencia: String(corpo.endereco.referencia ?? '').trim().slice(0, 200),
    } : undefined,
    pagamento: corpo.pagamento,
    pagoOnline: corpo.pagoOnline && (corpo.pagoOnline.escolha === 'estorno_parcial' || corpo.pagoOnline.escolha === 'diferenca_entrega') ? corpo.pagoOnline : undefined,
    reimprimir: corpo.reimprimir === true,
  }
  if (edicao.endereco && (!edicao.endereco.rua || !edicao.endereco.numero || !edicao.endereco.bairro)) return NextResponse.json({ error: 'Endereço precisa de rua, número e bairro.' }, { status: 400 })
  try {
    const r = await editarPedido(getAdminSupabase({ correlacao: crypto.randomUUID() }), { restauranteId: sessao.restauranteId, pedidoId: id, por: { id: sessao.userId, nome: sessao.nome }, origem: 'painel', edicao })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    if (e instanceof EdicaoError) return NextResponse.json({ error: e.message, codigo: e.codigo, precisa: e.precisa }, { status: e.status })
    console.error('[editar pedido]', e)
    return NextResponse.json({ error: (e as Error).message?.slice(0, 200) || 'Não foi possível editar o pedido.' }, { status: 500 })
  }
}
