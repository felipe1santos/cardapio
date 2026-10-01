import { NextResponse } from 'next/server'
import { autorizarClientesCsv, desfazerImportacao } from '@/lib/queries/clientes-importacao'
import { registrarAuditoria } from '@/lib/auditoria'

/** Desfazer importação (até 7 dias): remove os criados que ainda não pediram; restaura os atualizados. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Importação inválida.' }, { status: 400 })
  const a = await autorizarClientesCsv()
  if ('erro' in a) return a.erro
  const r = await desfazerImportacao(a.admin, a.sessao.restauranteId, id)
  if (!r.ok) return NextResponse.json({ error: r.erro }, { status: r.status })
  await registrarAuditoria(a.admin, {
    restauranteId: a.sessao.restauranteId, usuarioId: a.sessao.userId, usuarioNome: a.sessao.nome,
    acao: 'clientes.desfez_importacao', entidade: 'clientes_importacao', entidadeId: id,
    dados: { removidos: r.removidos, mantidos_por_ja_terem_pedido: r.mantidos, restaurados: r.restaurados },
  })
  return NextResponse.json(r)
}
