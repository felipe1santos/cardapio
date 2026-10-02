import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Terminal travado / troca rápida de operador (0132). A loja de um terminal é a de quem entrou
 * nele COM SENHA nos últimos 30 dias (usuarios_sessoes). Só funcionários dessa loja entram por PIN
 * nesse terminal — PIN nunca serve num aparelho que ninguém da loja abriu com senha.
 */
export const DIAS_TERMINAL = 30

export async function lojaDoTerminal(admin: SupabaseClient, terminal: string | null): Promise<string | null> {
  if (!terminal || !/^[0-9a-f-]{36}$/i.test(terminal)) return null
  const desde = new Date(Date.now() - DIAS_TERMINAL * 86_400_000).toISOString()
  const { data } = await admin.from('usuarios_sessoes').select('restaurante_id').eq('terminal', terminal).not('restaurante_id', 'is', null)
    .gte('criado_em', desde).order('criado_em', { ascending: false }).limit(1)
  return (data?.[0]?.restaurante_id as string | undefined) ?? null
}
