import { NextResponse } from 'next/server'
import { acessoDoMapa } from '@/lib/mapa/acesso'
import { contarSemTrava } from '@/lib/custo/uso'

/**
 * POST { token? } — o navegador avisa que CARREGOU o script do Maps JavaScript (é o que o Google cobra por mapa).
 * Só conta em api_uso_dia (api 'maps_js', total e loja) para o contador do Super Admin; não chama nada pago.
 * Sessão do painel ou token da cozinha/motoboy; com o limite de IP/loja das rotas do mapa.
 */
export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as { token?: unknown } | null
  const a = await acessoDoMapa(request, corpo?.token)
  if ('erro' in a) return a.erro
  await contarSemTrava(a.admin, 'maps_js', a.loja)
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
