import { NextResponse } from 'next/server'
import { abrirInstalador, instaladorPorArquivo } from '@/lib/impressao/instaladores'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Download do instalador do Assistente (12/10/2026: saiu do GitHub). Público e só leitura — é o mesmo .exe que qualquer
 * loja baixa no painel. Usado pelos botões "Baixar" e pelo atualizador (url do latest.yml). As regras de QUEM atualiza
 * (janelas de horário, trava da Villa por computador/IP, fila vazia) continuam no latest.yml e no Assistente: aqui só
 * se entrega o arquivo pedido pelo nome exato.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ arquivo: string }> }) {
  const { arquivo } = await params
  const inst = instaladorPorArquivo(arquivo)
  if (!inst) return new NextResponse('não encontrado', { status: 404 })
  return new NextResponse(abrirInstalador(inst), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(inst.tamanho),
      'Content-Disposition': `attachment; filename="${inst.arquivo}"`,
      'Cache-Control': 'no-store',
    },
  })
}
