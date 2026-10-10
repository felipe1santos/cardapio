import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojasPlataforma } from '@/lib/queries/plataforma'
import { PainelPlataforma } from '@/components/superadmin/painel-plataforma'
import { lerUsoApis } from '@/lib/custo/uso'
import { lerUsoIa } from '@/lib/custo/ia'
import { MODULOS, nenhumLiberado, type ModulosDaLoja } from '@/lib/modulos'

// Dados sempre frescos: é o painel de quem libera e bloqueia contas.
export const dynamic = 'force-dynamic'

/**
 * Painel da plataforma (2026-10-04). O layout já barra quem não é superadmin; as ações
 * conferem de novo no servidor. Uma linha por loja (conta principal), sublogins à parte.
 */
export default async function SuperadminPage() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  const admin = getAdminSupabase()
  // Contador de APIs pagas (10/10): falhar aqui não derruba o painel.
  const [{ lojas, resumo }, usoApis, usoIa, { data: mods }] = await Promise.all([
    listarLojasPlataforma(admin), lerUsoApis(admin).catch(() => null), lerUsoIa(admin).catch(() => null),
    admin.from('loja_modulos').select('restaurante_id, modulo, liberado'),
  ])
  // Módulos pagos por loja (0176): sem linha = bloqueado (mesma regra de modulo_liberado).
  const modulos: Record<string, ModulosDaLoja> = {}
  for (const l of lojas) if (l.restauranteId) modulos[l.restauranteId] = nenhumLiberado()
  for (const m of (mods ?? []) as { restaurante_id: string; modulo: string; liberado: boolean }[]) {
    if ((MODULOS as readonly string[]).includes(m.modulo)) (modulos[m.restaurante_id] ??= nenhumLiberado())[m.modulo as keyof ModulosDaLoja] = m.liberado === true
  }
  return <PainelPlataforma lojas={lojas} resumo={resumo} emailSuperadmin={data.user?.email ?? ''} usoApis={usoApis} usoIa={usoIa} modulos={modulos} />
}
