import { NextResponse } from 'next/server'
import { latestYml } from '@/lib/impressao/atualizacao-assistente'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { bloqueiaAtualizacao, ipDoRequest } from '@/lib/impressao/atualizacao-bloqueio'

/**
 * Atualização automática do Assistente (0.2.0-beta.11+): devolve o `latest.yml` com a versão
 * atual. Público e só leitura — não tem dado de loja; o instalador é o do release do GitHub.
 * Sem versão liberada (ou desligada): 404, e o Assistente fica onde está.
 * Loja fora da atualização (0172, restaurantes.impressao_sem_atualizacao): 404 para os IPs dos computadores
 * dela — reconhecidos por impressao_agentes.visto_ip, gravado quando o computador busca pedidos.
 */
export async function GET(req: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const { arquivo } = await params
  const yml = arquivo === 'latest.yml' ? latestYml() : null
  if (!yml) return new NextResponse('não encontrado', { status: 404 })
  const ip = ipDoRequest(req.headers)
  if (ip) {
    const { data, error } = await getAdminSupabase().from('impressao_agentes')
      .select('visto_ip, restaurantes!inner ( impressao_sem_atualizacao )')
      .eq('visto_ip', ip).is('revogado_em', null).eq('restaurantes.impressao_sem_atualizacao', true).limit(1)
    // Sem a coluna ainda (0172 não aplicada) ou banco fora: na dúvida, NÃO entrega a versão nova.
    if (error) return new NextResponse('indisponível', { status: 503 })
    if (bloqueiaAtualizacao(ip, (data ?? []).map((r) => r.visto_ip as string | null))) return new NextResponse('não encontrado', { status: 404 })
  }
  return new NextResponse(yml, { headers: { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-store' } })
}
