import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojasPlataforma } from '@/lib/queries/plataforma'
import { PainelPlataforma } from '@/components/superadmin/painel-plataforma'

// Dados sempre frescos: é o painel de quem libera e bloqueia contas.
export const dynamic = 'force-dynamic'

/**
 * Painel da plataforma (2026-10-04). O layout já barra quem não é superadmin; as ações
 * conferem de novo no servidor. Uma linha por loja (conta principal), sublogins à parte.
 */
export default async function SuperadminPage() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  const { lojas, resumo } = await listarLojasPlataforma(getAdminSupabase())
  return <PainelPlataforma lojas={lojas} resumo={resumo} emailSuperadmin={data.user?.email ?? ''} />
}
