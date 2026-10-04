import { NextResponse } from 'next/server'
import { contextoFinanceiro } from '@/lib/financeiro/contexto'
import { sugestaoDaFichaDePreparo } from '@/lib/financeiro/cmv'

/**
 * "Importar ingredientes da ficha de preparo": devolve a SUGESTÃO (nada é gravado). Depois de salva, a ficha de
 * custo é independente da ficha de preparo — e a ficha de preparo / tela da cozinha nunca mostram custo.
 *   GET ?itemId   (custos_editar)
 */
export async function GET(request: Request) {
  const c = await contextoFinanceiro('custos_editar')
  if ('erro' in c) return c.erro
  const itemId = new URL(request.url).searchParams.get('itemId') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return NextResponse.json({ error: 'Produto não encontrado.' }, { status: 404 })
  const s = await sugestaoDaFichaDePreparo(c.admin, c.sessao.restauranteId, itemId)
  if (!s) return NextResponse.json({ error: 'Este produto não tem ficha de preparo.' }, { status: 404 })
  return NextResponse.json({ ingredientes: s })
}
