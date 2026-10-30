import { getServerSupabase } from '@/lib/supabase/server'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { listarLojasPlataforma } from '@/lib/queries/plataforma'
import { PainelPlataforma } from '@/components/superadmin/painel-plataforma'
import { lerUsoApis } from '@/lib/custo/uso'
import { lerUsoIa } from '@/lib/custo/ia'
import { lerCotacao } from '@/lib/custo/gasto-lojas'
import { MODULOS, nenhumLiberado, type ModulosDaLoja } from '@/lib/modulos'
import { CabecalhoHp, PainelHp, ShellHp } from '@/components/superadmin/hp'
import { Monitoramento, RotinasHp, Tendencia30, WhatsappLojasHp, type DiaSaude, type FotoSaude } from '@/components/superadmin/monitoramento'
import { GastoHoje } from '@/components/superadmin/gasto-apis'
import { AlertasFaixa, ListaAlertas, type AlertaTela } from '@/components/superadmin/alertas-faixa'

// Dados sempre frescos: é o painel de quem libera e bloqueia contas.
export const dynamic = 'force-dynamic'

/**
 * Super Admin › Visão geral (29/10/2026, visual da "Visão geral" da Hostinger; 30/10: juntou a Saúde do sistema). Ordem:
 * monitoramento, gasto de hoje, tendência, rotinas, alertas e clientes. Cada número aparece uma vez só.
 * O layout já barra quem não é superadmin; as ações conferem de novo no servidor.
 */
export default async function SuperadminPage() {
  const supabase = await getServerSupabase()
  const { data } = await supabase.auth.getUser()
  const admin = getAdminSupabase()
  // Contador de APIs pagas (10/10): falhar aqui não derruba o painel.
  const [{ lojas, resumo }, usoApis, usoIa, cotacao, { data: mods }, { data: alertas }, { data: fotos }, { data: crons }, { data: serie }] = await Promise.all([
    listarLojasPlataforma(admin), lerUsoApis(admin).catch(() => null), lerUsoIa(admin).catch(() => null), lerCotacao(admin).catch(() => 5.5),
    admin.from('loja_modulos').select('restaurante_id, modulo, liberado'),
    admin.from('sistema_alertas').select('id, criado_em, nivel, texto, canal, enviado, erro').order('criado_em', { ascending: false }).limit(60),
    // Últimas 3 h de fotos do vigia (a cada 5 min) para os minigráficos.
    admin.from('sistema_saude_fotos').select('em, dados').order('em', { ascending: false }).limit(36),
    admin.from('sistema_cron_batidas').select('nome, ultima_em'),
    admin.rpc('sistema_saude_dias', { p_dias: 30 }),
  ])
  // Módulos pagos por loja (0176): sem linha = bloqueado (mesma regra de modulo_liberado).
  const modulos: Record<string, ModulosDaLoja> = {}
  for (const l of lojas) if (l.restauranteId) modulos[l.restauranteId] = nenhumLiberado()
  for (const m of (mods ?? []) as { restaurante_id: string; modulo: string; liberado: boolean }[]) {
    if ((MODULOS as readonly string[]).includes(m.modulo)) (modulos[m.restaurante_id] ??= nenhumLiberado())[m.modulo as keyof ModulosDaLoja] = m.liberado === true
  }
  const historico = (alertas ?? []) as AlertaTela[]
  const desde = Date.now() - 6 * 3600_000
  const recentes = historico.filter((a) => (a.nivel === 'amarelo' || a.nivel === 'vermelho') && Date.parse(a.criado_em) >= desde)
  const listaFotos = (fotos ?? []) as FotoSaude[]
  const dias = ((serie ?? []) as DiaSaude[]).map((d) => ({ ...d, dia: String(d.dia).slice(0, 10) }))
  return (
    <ShellHp aba="visao" titulo="Visão geral" email={data.user?.email ?? ''}>
      <AlertasFaixa alertas={recentes} />
      <Monitoramento fotos={listaFotos} />
      <GastoHoje uso={usoApis} ia={usoIa} cotacao={cotacao} />
      <Tendencia30 dias={dias} />
      <div className="grid gap-[12px] sm:gap-[20px] lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <RotinasHp crons={(crons ?? []) as { nome: string; ultima_em: string }[]} />
        <WhatsappLojasHp caidas={listaFotos[0]?.dados.whatsappCaido ?? []} />
      </div>
      <PainelHp id="alertas" testid="sa-historico-alertas" className="scroll-mt-[16px] overflow-hidden">
        <CabecalhoHp titulo="Histórico de alertas" sub="Últimos 60 avisos · toque para ver tudo"
          info="Cada alerta mostra o que aconteceu, o número que disparou e o que fazer, além de quando saiu e por onde (WhatsApp ou notificação do painel)." />
        <ListaAlertas alertas={historico} vazio="Nenhum alerta enviado." />
      </PainelHp>
      <PainelPlataforma lojas={lojas} resumo={resumo} usoApis={usoApis} usoIa={usoIa} modulos={modulos} />
    </ShellHp>
  )
}
