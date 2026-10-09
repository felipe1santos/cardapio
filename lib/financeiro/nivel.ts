import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Os dois níveis do Financeiro (0167):
 *   nível 1 "Financeiro ligado" (financeiro_ativo) — menu, relatórios, contas, CMV, DRE; PDV, mesa e delivery vendem
 *     igual a sem financeiro (caixa automático do dia, sem PIN, sem trava, acerto do motoboy na Logística);
 *   nível 2 "Controle de caixa ativo" (financeiro_ativo E controle_caixa_ativo) — abrir/fechar à mão, contagem cega,
 *     trava da gaveta, PIN de outra pessoa, tela travada e troca de operador.
 * O banco decide o mesmo em fin_caixa_estrito(); aqui é a versão do app.
 */
export interface NivelFinanceiro { financeiro: boolean; controleCaixa: boolean }

export function nivelDe(r: { financeiro_ativo?: boolean | null; controle_caixa_ativo?: boolean | null } | null | undefined): NivelFinanceiro {
  const financeiro = r?.financeiro_ativo === true
  return { financeiro, controleCaixa: financeiro && r?.controle_caixa_ativo === true }
}

export async function nivelFinanceiro(admin: SupabaseClient, restauranteId: string | null | undefined): Promise<NivelFinanceiro> {
  if (!restauranteId) return { financeiro: false, controleCaixa: false }
  const { data } = await admin.from('restaurantes').select('financeiro_ativo, controle_caixa_ativo').eq('id', restauranteId).maybeSingle()
  return nivelDe(data as { financeiro_ativo?: boolean; controle_caixa_ativo?: boolean } | null)
}

/** Nível 2 ligado? (operação com caixa controlado) */
export async function controleCaixaAtivo(admin: SupabaseClient, restauranteId: string | null | undefined): Promise<boolean> {
  return (await nivelFinanceiro(admin, restauranteId)).controleCaixa
}
