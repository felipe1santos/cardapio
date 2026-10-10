import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverFrete, type EnderecoFrete, type FreteDecisao } from '@/lib/frete'
import { criarLimitador } from '@/lib/limite-taxa'
import { ipDoRequest } from '@/lib/impressao/atualizacao-bloqueio'

// Rota pública (checkout sem login): limite por IP e por loja — a geocodificação (lojas com raio) é paga (10/10).
const porIp = criarLimitador({ max: 30, janelaMs: 60_000 })
const porLoja = criarLimitador({ max: 300, janelaMs: 60_000 })

export type FreteResposta = FreteDecisao


/**
 * Calcula o frete para um endereço de cliente. Regra em lib/frete.ts (decidirFrete):
 * bairro cadastrado → faixa de raio → taxa padrão. Bairro fora da tabela só cai na
 * taxa padrão quando a loja não usa raio E ligou `frete_fora_da_lista = 'taxa_padrao'`;
 * fora do raio, ou endereço não encontrado, retorna entregavel: false. Google indisponível (sem faturamento, sem
 * chave, limite diário): reserva pela taxa fixa da loja — o checkout não trava (10/10).
 */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ip = ipDoRequest(request.headers) ?? 'sem-ip'
  if (porIp.excedeu(ip) || porLoja.excedeu(slug)) return NextResponse.json({ error: 'Muitas consultas de frete. Aguarde um minuto.' }, { status: 429 })
  porIp.registrar(ip)
  porLoja.registrar(slug)

  let body: EnderecoFrete
  try {
    body = (await request.json()) as EnderecoFrete
  } catch {
    return NextResponse.json({ error: 'Corpo inválido' }, { status: 400 })
  }

  const admin = getAdminSupabase()
  const { data: loja, error: lojaErr } = await admin.from('restaurantes').select('id').eq('slug', slug).maybeSingle()
  if (lojaErr) return NextResponse.json({ error: 'Erro ao localizar a loja' }, { status: 500 })
  if (!loja) return NextResponse.json({ error: 'Loja não encontrada' }, { status: 404 })

  const resultado = await resolverFrete(admin, loja.id, body)
  return NextResponse.json<FreteResposta>(resultado)
}
