import { NextResponse } from 'next/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverMesaPorToken } from '@/lib/queries/mesas'

/**
 * Modo do cardápio da mesa (0075), para a tela aberta perceber a troca.
 *
 * A gestão liga e desliga "somente visualização" com celulares já na mesa. Sem isto, o
 * cliente ficaria no modo antigo até fechar e ler o QR de novo — montando uma seleção
 * que a rota recusa, ou vendo um cardápio de consulta numa loja que voltou a atender.
 *
 * Resposta minúscula e sem dado de ninguém: só o booleano. Roda com `service_role`
 * porque a chave anônima não tem grant em `mesas`; o token opaco da URL é a credencial,
 * e mesa inativa, bloqueada ou de loja com o módulo desligado devolve 404 igual.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()
  const mesa = await resolverMesaPorToken(admin, token)
  if (!mesa) return NextResponse.json({ error: 'Mesa não encontrada' }, { status: 404 })

  const { data } = await admin
    .from('restaurantes')
    .select('mesa_somente_visualizacao')
    .eq('id', mesa.restauranteId)
    .maybeSingle()

  return NextResponse.json({
    somenteVisualizacao: (data as { mesa_somente_visualizacao?: boolean } | null)?.mesa_somente_visualizacao === true,
  })
}
