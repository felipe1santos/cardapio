import Link from 'next/link'
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

/** 1ª linha do alerta sem o emoji e o "Menuzia — " (ex.: "custo de API", "banco fora do ar"). */
function tituloDoAlerta(texto: string): string {
  return texto.split('\n')[0].replace(/^\S+ Menuzia — /, '')
}

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
    admin.from('sistema_alertas').select('nivel, texto, criado_em').in('nivel', ['amarelo', 'vermelho']).gte('criado_em', new Date(Date.now() - 6 * 3600_000).toISOString()).order('criado_em', { ascending: false }).limit(20),
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
  const recentes = (alertas ?? []) as { nivel: string; texto: string; criado_em: string }[]
  const vermelho = recentes.some((a) => a.nivel === 'vermelho')
  return (
    <ShellHp aba="visao" titulo="Visão geral" email={data.user?.email ?? ''}>
      {recentes.length > 0 && (
        <Link href="/superadmin/saude" data-testid="faixa-alertas"
          className={`flex items-center justify-between gap-[12px] rounded-[16px] border-[0.8px] px-[16px] py-[12px] text-[14px] font-semibold leading-[20px] ${vermelho ? 'border-[rgba(231,58,71,0.3)] bg-[#FFE8EF] text-[#D63163]' : 'border-[rgba(138,97,0,0.25)] bg-[#FFF8E2] text-[#8A6100]'}`}>
          <span className="min-w-0 truncate">{recentes.length} alerta(s) nas últimas 6 h — {tituloDoAlerta(recentes[0].texto)}</span>
          <span className="flex-shrink-0 text-[#673DE6]">Ver Saúde do sistema</span>
        </Link>
      )}

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
