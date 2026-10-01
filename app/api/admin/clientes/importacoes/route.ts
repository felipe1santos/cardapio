import { NextResponse } from 'next/server'
import { autorizarClientesCsv, DIAS_DESFAZER } from '@/lib/queries/clientes-importacao'

/** Histórico de importações da loja (as 50 mais recentes). */
export async function GET() {
  const a = await autorizarClientesCsv()
  if ('erro' in a) return a.erro
  const { data, error } = await a.admin.from('clientes_importacoes')
    .select('id, usuario_nome, arquivo_nome, modo, total_linhas, criados, atualizados, ignorados, erros, status, criado_em, concluido_em, desfeita_em')
    .eq('restaurante_id', a.sessao.restauranteId).order('criado_em', { ascending: false }).limit(50)
  if (error) return NextResponse.json({ error: 'Não foi possível carregar o histórico.' }, { status: 500 })
  return NextResponse.json({ importacoes: data, diasDesfazer: DIAS_DESFAZER })
}
