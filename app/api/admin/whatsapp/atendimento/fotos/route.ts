import { NextResponse } from 'next/server'
import { contextoAtendimento, semCache } from '../contexto'
import { MAX_FOTOS_POR_PEDIDO, obterFotos } from '@/lib/mensageria/fotos'
import { provedorAtual } from '@/lib/mensageria/provedor'

/**
 * POST { telefones: string[], quebradas?: string[] } → { fotos: { [telefone]: url | null } }
 *
 * O navegador chama só para as linhas VISÍVEIS da lista que ainda não têm foto (ou cuja
 * foto venceu), no máximo 10 por vez. `quebradas`: fotos que não carregaram na tela (o
 * link do WhatsApp expira) — renovadas se tiverem mais de 1 h. Limites em lib/mensageria/fotos.
 */
export async function POST(request: Request) {
  const ctx = await contextoAtendimento()
  if ('erro' in ctx) return ctx.erro
  const corpo = (await request.json().catch(() => null)) as { telefones?: unknown; quebradas?: unknown } | null
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, MAX_FOTOS_POR_PEDIDO) : [])
  const telefones = lista(corpo?.telefones)
  const quebradas = lista(corpo?.quebradas)
  if (!telefones.length && !quebradas.length) return NextResponse.json({ error: 'Pedido inválido.' }, { status: 400 })
  try {
    const { data: loja } = await ctx.admin.from('restaurantes').select('evolution_instance').eq('id', ctx.loja).maybeSingle()
    const instancia = (loja?.evolution_instance as string | null) ?? null
    const fotos = await obterFotos(ctx.admin, provedorAtual(), ctx.loja, instancia, telefones, quebradas)
    return NextResponse.json({ fotos }, { headers: semCache })
  } catch {
    // Foto é enfeite: falhou, a tela fica com as iniciais.
    return NextResponse.json({ fotos: {} }, { headers: semCache })
  }
}
