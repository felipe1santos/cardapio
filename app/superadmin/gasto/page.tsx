import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojasPlataforma } from '@/lib/queries/plataforma'
import { lerCotacao, lerGastoLojas } from '@/lib/custo/gasto-lojas'
import { limitesIa } from '@/lib/custo/ia'
import { GastoPorLoja } from '@/components/superadmin/gasto-lojas'
import { LimitesCampanhas } from '@/components/superadmin/limites-campanhas'

export const dynamic = 'force-dynamic'

/**
 * Super Admin › Gasto por loja (12/10/2026). O layout de /superadmin já barra quem não é superadmin. Só leitura (fora o teto
 * de IA por loja e a cotação, que são server actions que conferem o superadmin de novo).
 */
export default async function GastoPage() {
  const admin = getAdminSupabase()
  const { lojas } = await listarLojasPlataforma(admin)
  const ids = lojas.map((l) => l.restauranteId).filter((x): x is string => !!x)
  const [gasto, cotacao, { data: tetos }, { data: limites }] = await Promise.all([
    lerGastoLojas(admin, ids),
    lerCotacao(admin),
    admin.from('whatsapp_robo_config').select('restaurante_id, ia_teto_usd_dia').not('ia_teto_usd_dia', 'is', null).limit(5000),
    admin.from('plataforma_config').select('chave, valor').in('chave', ['disparo_teto_dia', 'disparo_frequencia_dias', 'push_teto_dia']),
  ])
  const lim = Object.fromEntries(((limites ?? []) as { chave: string; valor: unknown }[]).map((l) => [l.chave, Number(l.valor)]))
  const nomes = Object.fromEntries(lojas.filter((l) => l.restauranteId).map((l) => [l.restauranteId as string, l.loja || l.email || 'Loja']))
  const tetosLoja = Object.fromEntries(((tetos ?? []) as { restaurante_id: string; ia_teto_usd_dia: number | string }[]).map((t) => [t.restaurante_id, Number(t.ia_teto_usd_dia)]))
  return (
    <>
      <GastoPorLoja gasto={gasto} nomes={nomes} cotacao={cotacao} tetosLoja={tetosLoja} tetoPadrao={limitesIa().usdDiaLoja} />
      <div className="mx-auto max-w-[1100px] px-4 pb-8">
        <LimitesCampanhas inicial={{ disparoTetoDia: lim.disparo_teto_dia ?? 150, frequenciaDias: lim.disparo_frequencia_dias ?? 3, pushTetoDia: lim.push_teto_dia ?? 1 }} />
      </div>
    </>
  )
}
