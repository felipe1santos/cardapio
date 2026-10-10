import { NextResponse } from 'next/server'
import { latestYml } from '@/lib/impressao/atualizacao-assistente'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { bloqueiaAtualizacao, ipDoRequest } from '@/lib/impressao/atualizacao-bloqueio'

/**
 * Atualização automática do Assistente (0.2.0-beta.11+): devolve o `latest.yml` com a versão
 * atual. Público e só leitura — não tem dado de loja; o instalador é o do release do GitHub.
 * Sem versão liberada (ou desligada): 404, e o Assistente fica onde está.
 *
 * Computador fora da atualização (Villa — ordem do dono): o atualizador não manda credencial, só o IP chega.
 *   1ª checagem (0175): o COMPUTADOR pareado com impressao_agentes.sem_atualizacao — 404 para qualquer IP que ele
 *      já usou para buscar pedidos (impressao_agente_ips, gravado por gatilho);
 *   2ª checagem (0172): o visto_ip atual dos computadores das lojas com restaurantes.impressao_sem_atualizacao.
 * Banco fora ou erro: NÃO entrega a versão nova (falha para o lado seguro).
 */
export async function GET(req: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const { arquivo } = await params
  const yml = arquivo === 'latest.yml' ? latestYml() : null
  if (!yml) return new NextResponse('não encontrado', { status: 404 })
  const ip = ipDoRequest(req.headers)
  if (ip) {
    const admin = getAdminSupabase()
    const [porComputador, porLoja] = await Promise.all([
      admin.from('impressao_agente_ips')
        .select('ip, impressao_agentes!inner ( sem_atualizacao, revogado_em )')
        .eq('ip', ip).eq('impressao_agentes.sem_atualizacao', true).is('impressao_agentes.revogado_em', null).limit(1),
      admin.from('impressao_agentes')
        .select('visto_ip, restaurantes!inner ( impressao_sem_atualizacao )')
        .eq('visto_ip', ip).is('revogado_em', null).eq('restaurantes.impressao_sem_atualizacao', true).limit(1),
    ])
    if (porComputador.error || porLoja.error) return new NextResponse('indisponível', { status: 503 })
    const ips = [...(porComputador.data ?? []).map((r) => r.ip as string | null), ...(porLoja.data ?? []).map((r) => r.visto_ip as string | null)]
    if (bloqueiaAtualizacao(ip, ips)) return new NextResponse('não encontrado', { status: 404 })
  }
  return new NextResponse(yml, { headers: { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-store' } })
}
