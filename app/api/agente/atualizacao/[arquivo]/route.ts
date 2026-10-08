import { NextResponse } from 'next/server'
import { latestYml } from '@/lib/impressao/atualizacao-assistente'

/**
 * Atualização automática do Assistente Beta (0.2.0-beta.11+): devolve o `latest.yml` com a versão
 * atual. Público e só leitura — não tem dado de loja; o instalador é o do release do GitHub.
 * Sem versão liberada (ou desligada): 404, e o Assistente fica onde está.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const { arquivo } = await params
  const yml = arquivo === 'latest.yml' ? latestYml() : null
  if (!yml) return new NextResponse('não encontrado', { status: 404 })
  return new NextResponse(yml, { headers: { 'Content-Type': 'text/yaml; charset=utf-8', 'Cache-Control': 'no-store' } })
}
