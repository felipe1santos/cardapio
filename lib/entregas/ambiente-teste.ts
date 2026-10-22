import type { SupabaseClient } from '@supabase/supabase-js'
import { isSuperAdminEmail } from '@/lib/auth/superadmin'

/**
 * Ambiente de teste dos parceiros de entrega (21/10/2026, regra do dono): o lojista conecta SEMPRE em produção; a
 * opção "Teste" (sandbox, corridas simuladas) só existe na loja Menuzia (a de demonstração) e para o Super Admin.
 */
export const LOJA_DE_TESTE = 'menuzia'

export async function podeUsarAmbienteTeste(admin: SupabaseClient, restauranteId: string, email: string | null | undefined): Promise<boolean> {
  if (isSuperAdminEmail(email)) return true
  const { data } = await admin.from('restaurantes').select('slug').eq('id', restauranteId).maybeSingle()
  return data?.slug === LOJA_DE_TESTE
}
