import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojasPlataforma } from '@/lib/queries/plataforma'
import { PainelPlataforma } from '@/components/superadmin/painel-plataforma'
import { lerUsoApis } from '@/lib/custo/uso'
import { lerUsoIa } from '@/lib/custo/ia'
import { MODULOS, nenhumLiberado, type ModulosDaLoja } from '@/lib/modulos'

/** 1ª linha do alerta sem o emoji e o "Menuzia — " (ex.: "custo de API", "banco fora do ar"). */
function tituloDoAlerta(texto: string): string {
  return texto.split('\n')[0].replace(/^\S+ Menuzia — /, '')
}

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
  const [{ lojas, resumo }, usoApis, usoIa, { data: mods }, { data: alertas }] = await Promise.all([
    listarLojasPlataforma(admin), lerUsoApis(admin).catch(() => null), lerUsoIa(admin).catch(() => null),
    admin.from('loja_modulos').select('restaurante_id, modulo, liberado'),
    // Alertas do vigia e da guarda de custo nas últimas 6 h (28/10): faixa no topo com link para a Saúde do sistema.
    admin.from('sistema_alertas').select('nivel, texto, criado_em').in('nivel', ['amarelo', 'vermelho']).gte('criado_em', new Date(Date.now() - 6 * 3600_000).toISOString()).order('criado_em', { ascending: false }).limit(20),
  ])
  // Módulos pagos por loja (0176): sem linha = bloqueado (mesma regra de modulo_liberado).
  const modulos: Record<string, ModulosDaLoja> = {}
  for (const l of lojas) if (l.restauranteId) modulos[l.restauranteId] = nenhumLiberado()
  for (const m of (mods ?? []) as { restaurante_id: string; modulo: string; liberado: boolean }[]) {
    if ((MODULOS as readonly string[]).includes(m.modulo)) (modulos[m.restaurante_id] ??= nenhumLiberado())[m.modulo as keyof ModulosDaLoja] = m.liberado === true
  }
  const recentes = (alertas ?? []) as { nivel: string; texto: string; criado_em: string }[]
  const vermelho = recentes.some((a) => a.nivel === 'vermelho')
  return (
    <>
      {recentes.length > 0 && (
        <a href="/superadmin/saude" data-testid="faixa-alertas"
          className={`mx-auto mt-3 flex max-w-[1100px] items-center justify-between gap-3 rounded-[4px] border px-4 py-2.5 text-[12.5px] font-semibold ${vermelho ? 'border-[#FCA5A5] bg-[#FEE2E2] text-[#B91C1C]' : 'border-[#FCD34D] bg-[#FEF3C7] text-[#92400E]'}`}>
          <span className="min-w-0 truncate">{vermelho ? '🔴' : '🟡'} {recentes.length} alerta(s) nas últimas 6 h — {tituloDoAlerta(recentes[0].texto)}</span>
          <span className="flex-shrink-0 underline">Ver Saúde do sistema</span>
        </a>
      )}
      <PainelPlataforma lojas={lojas} resumo={resumo} emailSuperadmin={data.user?.email ?? ''} usoApis={usoApis} usoIa={usoIa} modulos={modulos} />
    </>
  )
}
