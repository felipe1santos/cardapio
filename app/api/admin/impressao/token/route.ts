import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { buscarTokenAgente, gerarTokenAgente } from '@/lib/queries/impressao'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Token de pareamento do Assistente de Impressão (página Impressão).
 *
 * Desde a 0080 o navegador não enxerga a coluna `impressao_agente_token` — nem da
 * própria loja. Só o dono, por esta rota, lê e gera. O middleware já barra quem não
 * tem `ajustes.editar`; a checagem se repete aqui porque credencial não pode
 * depender de uma única porta.
 *
 * A loja vem da SESSÃO, nunca do corpo ou da URL: não há como pedir o token de
 * outra loja. O valor não vai para log nem para a auditoria.
 */
async function contexto() {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'ajustes.editar')) {
    return { erro: NextResponse.json({ error: 'Só o dono da loja acessa o token do assistente.' }, { status: 403 }) }
  }
  return { sessao }
}

export async function GET() {
  const { sessao, erro } = await contexto()
  if (erro) return erro
  const token = await buscarTokenAgente(getAdminSupabase(), sessao.restauranteId)
  return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST() {
  const { sessao, erro } = await contexto()
  if (erro) return erro
  const admin = getAdminSupabase()
  const token = await gerarTokenAgente(admin, sessao.restauranteId)
  // Quem trocou e quando — sem o valor.
  await registrarAuditoria(admin, {
    restauranteId: sessao.restauranteId,
    usuarioId: sessao.userId,
    usuarioNome: sessao.nome,
    acao: 'impressao.gerou_token',
    entidade: 'restaurante',
    entidadeId: sessao.restauranteId,
    dados: {},
  }).catch(() => {})
  return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } })
}
