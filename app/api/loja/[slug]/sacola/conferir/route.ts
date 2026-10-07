import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { buscarRestauranteIdPorSlug } from '@/lib/queries/clientes'
import { precificarLinhas } from '@/lib/queries/pedidos'
import { classificarIndisponivel, type ConferenciaLinha } from '@/lib/sacola-conferencia'

export const dynamic = 'force-dynamic'

type LinhaEntrada = {
  chave?: unknown; itemId?: unknown; quantidade?: unknown; complementos?: unknown; observacao?: unknown
  tamanhoNome?: unknown; saborNome?: unknown; bordaNome?: unknown; massaNome?: unknown; precoUnitario?: unknown
}
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.slice(0, 200) : undefined)

/**
 * Confere a sacola guardada no aparelho (item pausado, esgotado, fora do dia/horário, removido,
 * opção pausada ou preço mudado) com a MESMA regra do pedido (precificarLinhas), linha por linha,
 * para a vitrine avisar antes do "Fazer pedido". Agendado: confere para o horário agendado.
 * Só leitura; nada é gravado.
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const corpo = (await request.json().catch(() => null)) as { itens?: LinhaEntrada[]; agendadoPara?: unknown } | null
  const itens = Array.isArray(corpo?.itens) ? corpo.itens.slice(0, 80) : []
  if (itens.length === 0) return NextResponse.json({ linhas: [] })
  const admin = getAdminSupabase()
  const restauranteId = await buscarRestauranteIdPorSlug(admin, slug)
  if (!restauranteId) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })
  const { data: loja } = await admin.from('restaurantes').select('pizza_calculo_preco').eq('id', restauranteId).maybeSingle()
  const agendado = typeof corpo?.agendadoPara === 'string' ? new Date(corpo.agendadoPara) : null
  const referenciaItens = agendado && !Number.isNaN(agendado.getTime()) ? agendado : undefined

  const linhas: ConferenciaLinha[] = await Promise.all(itens.map(async (l) => {
    const chave = String(l.chave ?? '')
    const itemId = typeof l.itemId === 'string' ? l.itemId : ''
    if (!itemId) return { chave, ok: false, tipo: 'removido', motivo: 'Este item não existe mais no cardápio.' }
    try {
      const [p] = await precificarLinhas(admin, restauranteId, {
        origem: 'cardapio',
        itens: [{
          itemId, quantidade: 1, observacao: '',
          complementos: Array.isArray(l.complementos) ? l.complementos.filter((c): c is string => typeof c === 'string').slice(0, 60) : [],
          tamanhoNome: texto(l.tamanhoNome), saborNome: texto(l.saborNome), bordaNome: texto(l.bordaNome), massaNome: texto(l.massaNome),
        }],
      }, { referenciaItens, canal: 'delivery', pizzaCalculoPreco: loja?.pizza_calculo_preco })
      const anterior = Number(l.precoUnitario)
      const mudou = Number.isFinite(anterior) && Math.round(anterior * 100) !== Math.round(p.preco_unitario * 100)
      return { chave, ok: true, precoAtual: p.preco_unitario, ...(mudou ? { precoAnterior: anterior } : {}) }
    } catch (e) {
      const msg = (e as Error).message ?? ''
      return { chave, ok: false, ...classificarIndisponivel(msg, !!referenciaItens) }
    }
  }))
  return NextResponse.json({ linhas }, { headers: { 'Cache-Control': 'no-store' } })
}
