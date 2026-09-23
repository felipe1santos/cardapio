import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession, type AppSession } from '@/lib/auth/session'
import { pode } from '@/lib/auth/permissoes'
import { registrarAuditoria } from '@/lib/auditoria'

/**
 * Porta das rotas ANTIGAS do PDV (`/api/admin/pdv/pedido`, `/comanda/[id]/pagar`,
 * `/comanda/[id]/fechar`, `/pedido/[id]/cancelar`) durante a convivência com o v2.
 *
 * 1. Sessão e permissão conferidas no handler (antes: só o middleware).
 * 2. Telemetria: toda chamada grava `pdv_legado.<rota>` na auditoria, com o resultado.
 *    É o que decide, depois de 14 dias, se as rotas podem sair (docs/PDV-V2-OPERACAO.md).
 * 3. Loja com `pdv_v2` ligado recebe 410: a tela nova não chama estas rotas, e uma aba
 *    antiga aberta não pode furar as regras novas (pagamento real, pendências).
 */

export interface ContextoLegado {
  sessao: AppSession
  admin: SupabaseClient
  registrar: (resultado: string, dados?: Record<string, unknown>) => Promise<void>
}

export async function contextoLegado(rota: string): Promise<ContextoLegado | { erro: NextResponse }> {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  if (!pode(sessao.papel, 'pedidos.balcao.criar')) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }

  const admin = getAdminSupabase({ correlacao: crypto.randomUUID() })
  const registrar = (resultado: string, dados: Record<string, unknown> = {}) =>
    registrarAuditoria(admin, {
      restauranteId: sessao.restauranteId,
      usuarioId: sessao.userId,
      usuarioNome: sessao.nome,
      acao: `pdv_legado.${rota}`,
      entidade: 'pdv',
      dados: { resultado, ...dados },
    })

  const { data: loja } = await admin.from('restaurantes').select('pdv_v2').eq('id', sessao.restauranteId).maybeSingle()
  if (loja?.pdv_v2 === true) {
    await registrar('recusado_pdv_v2')
    return {
      erro: NextResponse.json(
        { error: 'O PDV desta loja foi atualizado. Recarregue a página para usar a versão nova.', codigo: 'pdv_atualizado' },
        { status: 410 },
      ),
    }
  }
  return { sessao, admin, registrar }
}
