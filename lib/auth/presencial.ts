import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { getCurrentSession, type AppSession } from '@/lib/auth/session'
import { podeNoSalao, type Permissao, type RegrasSalao } from '@/lib/auth/permissoes'
import { regrasDaLinha } from '@/lib/auth/salao'

/**
 * Porta de entrada das rotas do PDV v2 (balcão e conta presencial).
 *
 * Mesmo desenho de `contextoSalao`, com duas diferenças: exige a flag `pdv_v2` da loja
 * (desligada = 404, o recurso não existe para aquela loja) e NÃO exige o módulo de
 * mesas — balcão existe em loja sem salão. Conta de mesa confere o módulo à parte
 * (`exigirModuloMesas`).
 *
 * Loja, papel e autor saem SEMPRE da sessão. Nada disso é lido do corpo.
 */

export interface LojaPresencial {
  pdvV2: boolean
  moduloMesas: boolean
  formasPagamento: string[]
  regras: RegrasSalao
}

export interface ContextoPresencial {
  sessao: AppSession
  admin: SupabaseClient
  loja: LojaPresencial
  correlacao: string
  pode: (permissao: Permissao) => boolean
}

export type ResultadoPresencial = ContextoPresencial | { erro: NextResponse }

export const FORMAS_PADRAO = ['dinheiro', 'pix', 'credito', 'debito']

export async function carregarLojaPresencial(admin: SupabaseClient, restauranteId: string): Promise<LojaPresencial | null> {
  const { data, error } = await admin
    .from('restaurantes')
    .select('pdv_v2, modulo_mesas_ativo, formas_pagamento_mesa, salao_garcom_recebe, salao_garcom_transfere, salao_caixa_desconto')
    .eq('id', restauranteId)
    .maybeSingle()
  if (error || !data) return null
  return {
    pdvV2: data.pdv_v2 === true,
    moduloMesas: data.modulo_mesas_ativo === true,
    formasPagamento: (data.formas_pagamento_mesa as string[] | null) ?? FORMAS_PADRAO,
    regras: regrasDaLinha(data),
  }
}

export async function contextoPresencial(permissao: Permissao): Promise<ResultadoPresencial> {
  const sessao = await getCurrentSession(await getServerSupabase())
  if (!sessao) return { erro: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }

  const correlacao = crypto.randomUUID()
  const admin = getAdminSupabase({ correlacao })
  const loja = await carregarLojaPresencial(admin, sessao.restauranteId)
  if (!loja) return { erro: NextResponse.json({ error: 'Não foi possível conferir a loja.' }, { status: 500 }) }
  if (!loja.pdvV2) return { erro: NextResponse.json({ error: 'Não encontrado' }, { status: 404 }) }

  const podeAqui = (p: Permissao) => podeNoSalao(sessao.papel, p, loja.regras)
  if (!podeAqui(permissao)) return { erro: NextResponse.json({ error: 'Sem permissão' }, { status: 403 }) }

  return { sessao, admin, loja, correlacao, pode: podeAqui }
}
