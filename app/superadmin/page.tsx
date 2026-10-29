import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojasPlataforma } from '@/lib/queries/plataforma'
import { PainelPlataforma } from '@/components/superadmin/painel-plataforma'
import { lerUsoApis } from '@/lib/custo/uso'
import { lerUsoIa } from '@/lib/custo/ia'
import { MODULOS, nenhumLiberado, type ModulosDaLoja } from '@/lib/modulos'
import { ShellHp } from '@/components/superadmin/hp'
import { Monitoramento, type FotoSaude } from '@/components/superadmin/monitoramento'
import { UsoApisResumo } from '@/components/superadmin/uso-apis'
import { UsoIaResumo } from '@/components/superadmin/uso-ia'
import { AlertasFaixa, type AlertaTela } from '@/components/superadmin/alertas-faixa'

// Dados sempre frescos: é o painel de quem libera e bloqueia contas.
export const dynamic = 'force-dynamic'

/**
 * Super Admin › Visão geral (29/10/2026, visual da "Visão geral" da Hostinger): primeiro o MONITORAMENTO e os níveis de uso
 * (fotos do vigia, sem consulta nova a API), depois os níveis de uso das APIs pagas/IA e, por fim, os CLIENTES.
 * O layout já barra quem não é superadmin; as ações conferem de novo no servidor.
 */
export default async function SuperadminPage() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  const admin = getAdminSupabase()
  // Contador de APIs pagas (10/10): falhar aqui não derruba o painel.
  const [{ lojas, resumo }, usoApis, usoIa, { data: mods }, { data: alertas }, { data: fotos }, { data: crons }] = await Promise.all([
    listarLojasPlataforma(admin), lerUsoApis(admin).catch(() => null), lerUsoIa(admin).catch(() => null),
    admin.from('loja_modulos').select('restaurante_id, modulo, liberado'),
    // Alertas do vigia e da guarda de custo nas últimas 6 h (28/10).
    admin.from('sistema_alertas').select('id, nivel, texto, criado_em, canal, enviado, erro').in('nivel', ['amarelo', 'vermelho']).gte('criado_em', new Date(Date.now() - 6 * 3600_000).toISOString()).order('criado_em', { ascending: false }).limit(20),
    // Últimas 3 h de fotos do vigia (a cada 5 min) para os minigráficos.
    admin.from('sistema_saude_fotos').select('em, dados').order('em', { ascending: false }).limit(36),
    admin.from('sistema_cron_batidas').select('nome, ultima_em'),
  ])
  // Módulos pagos por loja (0176): sem linha = bloqueado (mesma regra de modulo_liberado).
  const modulos: Record<string, ModulosDaLoja> = {}
  for (const l of lojas) if (l.restauranteId) modulos[l.restauranteId] = nenhumLiberado()
  for (const m of (mods ?? []) as { restaurante_id: string; modulo: string; liberado: boolean }[]) {
    if ((MODULOS as readonly string[]).includes(m.modulo)) (modulos[m.restaurante_id] ??= nenhumLiberado())[m.modulo as keyof ModulosDaLoja] = m.liberado === true
  }
  const recentes = (alertas ?? []) as AlertaTela[]
  return (
    <ShellHp aba="visao" titulo="Visão geral" email={data.user?.email ?? ''}>
      <AlertasFaixa alertas={recentes} />

      <Monitoramento fotos={(fotos ?? []) as FotoSaude[]} crons={(crons ?? []) as { nome: string; ultima_em: string }[]}
        alertas6h={recentes.length} lojasAtivas={resumo.ativos} cadastros={resumo.cadastros} />

      <div id="uso" className="flex scroll-mt-[16px] flex-col gap-[20px]">
        {usoApis && <UsoApisResumo uso={usoApis} />}
        {usoIa && <UsoIaResumo ia={usoIa} />}
      </div>

      <PainelPlataforma lojas={lojas} resumo={resumo} usoApis={usoApis} usoIa={usoIa} modulos={modulos} />
    </ShellHp>
  )
}
