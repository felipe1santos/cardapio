import Link from 'next/link'
import { Activity } from 'lucide-react'
import { avaliar, CRONS, type Medidas } from '@/lib/saude/avaliar'
import { diasAteFimDoCiclo, PLANO_PRO } from '@/lib/saude/oficial'
import { AnelHp, AtalhoHp, CabecalhoHp, CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO, LinhaInfoHp, MetricaHp, PainelHp, SeloHp, SparklineHp } from './hp'

/**
 * Monitoramento no topo do Super Admin (29/10/2026): a primeira coisa ao entrar são os níveis de uso. Só exibição — os
 * números são as fotos que o vigia já grava a cada 5 min (sistema_saude_fotos), sem consulta nova a API nenhuma.
 */
export interface FotoSaude { em: string; dados: Medidas }

const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'))
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

export function Monitoramento({ fotos, crons, alertas6h, lojasAtivas, cadastros }: {
  fotos: FotoSaude[]
  crons: { nome: string; ultima_em: string }[]
  alertas6h: number
  lojasAtivas: number
  cadastros: number
}) {
  const m = fotos[0]?.dados ?? null
  const serie = [...fotos].reverse()
  const pontos = m ? avaliar(m) : []
  const vermelho = pontos.some((a) => a.nivel === 'vermelho')
  const selo = !m ? <SeloHp tom="cinza">Sem leitura</SeloHp>
    : pontos.length === 0 ? <SeloHp tom="verde" testid="sa-status">Em atividade</SeloHp>
      : <SeloHp tom={vermelho ? 'vermelho' : 'ambar'} testid="sa-status">{pontos.length} ponto(s) de atenção</SeloHp>
  const cicloDia = Number(process.env.SUPABASE_CICLO_DIA) || 28
  const prom = m?.oficial?.prom
  const memUsada = m?.memLivrePct == null ? null : 100 - m.memLivrePct
  const cronsOk = crons.filter((c) => Date.now() - Date.parse(c.ultima_em) < Math.max(10, (CRONS[c.nome] ?? 1) * 3) * 60_000).length
  const apisHoje = (m?.apis ?? []).reduce((s, a) => s + a.chamadas, 0)
  const egressPct = m?.egressMesGb == null ? null : (m.egressMesGb / PLANO_PRO.egressGb) * 100
  return (
    <>
      <PainelHp testid="sa-monitoramento">
        <CabecalhoHp
          icone={<Activity className="h-[24px] w-[24px]" />}
          titulo="Menuzia · Produção"
          selo={selo}
          sub={m ? `Supabase Pro • VPS KVM 2 • última verificação às ${hora(m.em)} (a cada 5 min)` : 'O vigia ainda não rodou.'}
          acoes={<>
            <Link href="/superadmin/saude" className={CLASSE_BOTAO_PRIMARIO} data-testid="link-saude">Saúde do sistema</Link>
            <Link href="/superadmin" className={CLASSE_BOTAO_SECUNDARIO}>Atualizar</Link>
          </>}
        />
        <LinhaInfoHp itens={[
          { rotulo: 'Plano:', valor: 'Supabase Pro' },
          { rotulo: 'Ciclo vira em:', valor: `${diasAteFimDoCiclo(new Date(), cicloDia)} dias` },
          { rotulo: 'Alertas nas últimas 6 h:', valor: alertas6h > 0 ? <Link href="/superadmin/saude" className="font-semibold text-[#673DE6] hover:underline">{alertas6h} — ver</Link> : '0' },
          { rotulo: 'Lojas cadastradas:', valor: n0(cadastros) },
        ]} />
        <div className="grid gap-[16px] p-[24px] sm:grid-cols-2 lg:grid-cols-3">
          <MetricaHp rotulo="Requisições ao banco" href="/superadmin/saude" testid="sa-req"
            valor={n0(m?.reqPorMin)} unidade="/min" nota={m?.reqMediaPorMin != null ? `média ${n0(m.reqMediaPorMin)}/min` : undefined}
            grafico={<SparklineHp rotulo="Requisições por minuto" valores={serie.map((f) => Number(f.dados.reqPorMin))} />} />
          <MetricaHp rotulo="Uso da CPU (VPS)" href="/superadmin/saude" testid="sa-cpu"
            valor={m?.cpuPct == null ? '—' : `${Math.round(m.cpuPct)}%`}
            grafico={<SparklineHp rotulo="CPU da VPS" valores={serie.map((f) => Number(f.dados.cpuPct))} />} />
          <MetricaHp rotulo="Uso de memória (VPS)" href="/superadmin/saude" testid="sa-mem"
            valor={memUsada == null ? '—' : `${Math.round(memUsada)}%`}
            grafico={<SparklineHp rotulo="Memória da VPS" valores={serie.map((f) => f.dados.memLivrePct == null ? NaN : 100 - f.dados.memLivrePct)} />} />
          <MetricaHp rotulo="CPU do banco (Supabase)" href="/superadmin/saude" testid="sa-cpu-banco"
            valor={prom?.cpuPct == null ? '—' : `${Math.round(prom.cpuPct)}%`}
            nota={prom?.iops != null ? `disk IO ${prom.iops} op/s` : undefined}
            grafico={<SparklineHp rotulo="CPU do banco" valores={serie.map((f) => Number(f.dados.oficial?.prom?.cpuPct))} />} />
          <MetricaHp rotulo="Uso do disco (VPS)" href="/superadmin/saude" testid="sa-disco"
            valor={m?.discoUsadoPct == null ? '—' : `${Math.round(m.discoUsadoPct)}%`} unidade="/ 100%"
            grafico={m?.discoUsadoPct != null ? <AnelHp pct={m.discoUsadoPct} rotulo="Disco da VPS" /> : undefined} />
          <MetricaHp rotulo="Egress no mês (estimado)" href="/superadmin/saude" testid="sa-egress"
            valor={m?.egressMesGb == null ? '—' : `${Math.round(m.egressMesGb)} GB`} unidade={`/ ${PLANO_PRO.egressGb} GB`}
            grafico={egressPct != null ? <AnelHp pct={egressPct} rotulo="Egress do mês" /> : undefined} />
        </div>
      </PainelHp>

      <div className="grid gap-[16px] sm:grid-cols-2 lg:grid-cols-4">
        <AtalhoHp titulo="Clientes ativos" valor={n0(lojasAtivas)} href="#clientes" testid="sa-atalho-clientes" />
        <AtalhoHp titulo="Rotinas automáticas" valor={`${cronsOk} de ${crons.length} rodando`} href="/superadmin/saude" />
        <AtalhoHp titulo="APIs pagas hoje" valor={`${n0(apisHoje)} chamadas`} href="#uso" />
        <AtalhoHp titulo="WhatsApp das lojas" valor={m && m.whatsappCaido.length ? `${m.whatsappCaido.length} desconectada(s)` : 'Tudo conectado'} href="/superadmin/saude" />
      </div>
    </>
  )
}
