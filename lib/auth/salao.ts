import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession, type AppSession } from '@/lib/auth/session'
import { podeNoSalao, REGRAS_SALAO_PADRAO, type Permissao, type RegrasSalao } from '@/lib/auth/permissoes'

/**
 * Porta de entrada de TODA rota de servidor do salão.
 *
 * O middleware já barra pela flag e pela permissão da rota, mas rota de servidor não
 * confia que o porteiro esteja no lugar (e ele deixa passar num soluço do banco). Aqui,
 * de novo e do banco: sessão válida, módulo ligado na loja da sessão, e a permissão
 * pedida com as regras da loja aplicadas.
 *
 * Loja, papel e autor saem SEMPRE da sessão. Nenhuma rota do salão lê isso do corpo.
 */

export interface ContextoSalao {
  sessao: AppSession
  admin: SupabaseClient
  regras: RegrasSalao
  /** Identificador desta requisição na trilha de auditoria. */
  correlacao: string
  /** `podeNoSalao` já com o papel e as regras desta sessão. */
  pode: (permissao: Permissao) => boolean
}

export type ResultadoContexto = ContextoSalao | { erro: NextResponse }

export function regrasDaLinha(row: {
  salao_garcom_recebe?: boolean | null
  salao_garcom_transfere?: boolean | null
  salao_caixa_desconto?: boolean | null
} | null | undefined): RegrasSalao {
  return {
    garcomRecebe: row?.salao_garcom_recebe ?? REGRAS_SALAO_PADRAO.garcomRecebe,
    garcomTransfere: row?.salao_garcom_transfere ?? REGRAS_SALAO_PADRAO.garcomTransfere,
    caixaDesconto: row?.salao_caixa_desconto ?? REGRAS_SALAO_PADRAO.caixaDesconto,
  }
}

export async function contextoSalao(permissao: Permissao): Promise<ResultadoContexto> {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }

  const correlacao = crypto.randomUUID()
  const admin = getAdminSupabase({ correlacao })

  const { data: loja, error } = await admin
    .from('restaurantes')
    .select('modulo_mesas_ativo, salao_garcom_recebe, salao_garcom_transfere, salao_caixa_desconto')
    .eq('id', sessao.restauranteId)
    .maybeSingle()
  if (error) return { erro: NextResponse.json({ error: 'Não foi possível conferir a loja.' }, { status: 500 }) }
  // Módulo desligado: para quem está de fora, ele não existe. 404, igual ao middleware.
  if (!loja?.modulo_mesas_ativo) return { erro: NextResponse.json({ error: 'Não encontrado' }, { status: 404 }) }

  const regras = regrasDaLinha(loja)
  const podeAqui = (p: Permissao) => podeNoSalao(sessao.papel, p, regras)
  if (!podeAqui(permissao)) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }

  return { sessao, admin, regras, correlacao, pode: podeAqui }
}
