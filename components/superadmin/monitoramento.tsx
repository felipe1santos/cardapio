import Link from 'next/link'
import { Activity, Database, Server } from 'lucide-react'
import { avaliar, CRONS, type Medidas } from '@/lib/saude/avaliar'
import { diasAteFimDoCiclo, PLANO_PRO } from '@/lib/saude/oficial'
import { AnelHp, AtalhoHp, CabecalhoHp, CLASSE_BOTAO_PRIMARIO, CLASSE_BOTAO_SECUNDARIO, LinhaInfoHp, MetricaHp, PainelHp, SeloHp, SparklineHp } from './hp'
import { InfoHp } from './info-hp'

/**
 * Monitoramento no topo do Super Admin (29/10/2026): a primeira coisa ao entrar são os níveis de uso, separados entre
 * SUPABASE (banco de dados, cobrado por uso) e VPS (o servidor onde o app roda). Só exibição — os números são as fotos
 * que o vigia já grava a cada 5 min (sistema_saude_fotos), sem consulta nova a API nenhuma.
 */
export interface FotoSaude { em: string; dados: Medidas }

const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'))
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })

function Grupo({ icone, titulo, sub, info, children }: { icone: React.ReactNode; titulo: string; sub: string; info: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-[12px] pb-[12px] pt-[12px] sm:px-[24px] sm:pb-[20px] sm:pt-[16px]">
      <div className="mb-[8px] flex items-center gap-[8px] sm:mb-[12px]">
        <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-[#EBE4FF] text-[#673DE6]" aria-hidden>{icone}</span>
        <h3 className="text-[14px] font-semibold leading-[20px] text-[#18181A] sm:text-[15px]">{titulo}</h3>
        <InfoHp titulo={titulo}>{info}</InfoHp>
        <span className="hidden text-[13px] text-[#58585E] sm:inline">· {sub}</span>
      </div>
      <div className="grid grid-cols-2 gap-[8px] sm:gap-[16px] lg:grid-cols-3">{children}</div>
    </div>
  )
}

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
          icone={<Activity className="h-[22px] w-[22px]" aria-hidden />}
          titulo="Menuzia · Produção"
          selo={selo}
          info="Situação geral do sistema, conferida pelo vigia a cada 5 minutos. Verde = tudo dentro do normal; amarelo/vermelho = algum número passou do limite (detalhes em Saúde do sistema)."
          sub={m ? `Última verificação às ${hora(m.em)} · a cada 5 min` : 'O vigia ainda não rodou.'}
          acoes={<>
            <Link href="/superadmin/saude" className={CLASSE_BOTAO_PRIMARIO} data-testid="link-saude">Saúde do sistema</Link>
            <Link href="/superadmin" className={`${CLASSE_BOTAO_SECUNDARIO} max-sm:hidden`}>Atualizar</Link>
          </>}
        />
        <LinhaInfoHp itens={[
          { rotulo: 'Plano:', valor: 'Supabase Pro' },
          { rotulo: 'Ciclo vira em:', valor: `${diasAteFimDoCiclo(new Date(), cicloDia)} dias` },
          { rotulo: 'Alertas (6 h):', valor: alertas6h > 0 ? <Link href="#alertas" className="font-semibold text-[#B3122D] hover:underline">{alertas6h} — ver</Link> : '0' },
          { rotulo: 'Lojas cadastradas:', valor: n0(cadastros) },
        ]} />

        <Grupo icone={<Database className="h-[16px] w-[16px]" />} titulo="Supabase" sub="banco de dados (cobrado por uso)"
          info="O Supabase guarda os dados (pedidos, cardápio, lojas). O plano Pro inclui 250 GB de tráfego (egress) por mês; passou disso, o sistema pode ser bloqueado como em 27/10.">
          <MetricaHp rotulo="Requisições" testid="sa-req" valor={n0(m?.reqPorMin)} unidade="/min"
            nota={m?.reqMediaPorMin != null ? `${m.reqReferenciaMesmoHorario ? 'normal deste horário' : 'média geral'} ${n0(m.reqMediaPorMin)}/min` : undefined}
            info="Quantas vezes por minuto o sistema consulta o banco. Cada consulta gasta tráfego (egress). O dobro da média por muito tempo pode indicar algo em repetição."
            grafico={<SparklineHp rotulo="Requisições por minuto" valores={serie.map((f) => Number(f.dados.reqPorMin))} />} />
          <MetricaHp rotulo="CPU do banco" testid="sa-cpu-banco" valor={prom?.cpuPct == null ? '—' : `${Math.round(prom.cpuPct)}%`}
            nota={prom?.iops != null ? `disco ${prom.iops} op/s` : undefined}
            info="Quanto do processador do servidor do banco está em uso (número oficial do Supabase). Acima de ~70% por muito tempo, é hora de subir o tamanho do banco."
            grafico={<SparklineHp rotulo="CPU do banco" valores={serie.map((f) => Number(f.dados.oficial?.prom?.cpuPct))} />} />
          <MetricaHp rotulo="Egress no mês" testid="sa-egress" valor={m?.egressMesGb == null ? '—' : `${Math.round(m.egressMesGb)} GB`} unidade={`/ ${PLANO_PRO.egressGb}`}
            info="Projeção do tráfego que sai do Supabase neste ciclo (estimativa a partir das requisições; o número oficial fica na página Usage do Supabase). O anel mostra quanto da cota de 250 GB isso representa."
            grafico={egressPct != null ? <AnelHp pct={egressPct} rotulo="Egress do mês" /> : undefined} />
        </Grupo>

        <div className="border-t-[0.8px] border-[rgba(0,0,0,0.1)]" />

        <Grupo icone={<Server className="h-[16px] w-[16px]" />} titulo="VPS" sub="servidor onde o app roda (Hostinger)"
          info="A VPS é o computador da Hostinger onde o Menuzia (painel, vitrine e WhatsApp) roda. Se ela ficar sem memória, disco ou processador, o sistema fica lento ou cai.">
          <MetricaHp rotulo="Uso da CPU" testid="sa-cpu" valor={m?.cpuPct == null ? '—' : `${Math.round(m.cpuPct)}%`}
            info="Processador da VPS em uso. Durante um deploy sobe muito por alguns minutos (normal). Só alerta se ficar acima de 90% por 15 minutos."
            grafico={<SparklineHp rotulo="CPU da VPS" valores={serie.map((f) => Number(f.dados.cpuPct))} />} />
          <MetricaHp rotulo="Uso de memória" testid="sa-mem" valor={memUsada == null ? '—' : `${Math.round(memUsada)}%`}
            info="Memória RAM da VPS em uso (o mesmo número do painel da Hostinger). Acima de 80% o servidor pode ficar lento."
            grafico={<SparklineHp rotulo="Memória da VPS" valores={serie.map((f) => f.dados.memLivrePct == null ? NaN : 100 - f.dados.memLivrePct)} />} />
          <MetricaHp rotulo="Uso do disco" testid="sa-disco" valor={m?.discoUsadoPct == null ? '—' : `${Math.round(m.discoUsadoPct)}%`}
            info="Espaço usado no disco da VPS. Cada deploy deixa uma imagem; a limpeza automática roda a cada 6 h e guarda as 3 últimas."
            grafico={m?.discoUsadoPct != null ? <AnelHp pct={m.discoUsadoPct} rotulo="Disco da VPS" /> : undefined} />
        </Grupo>
      </PainelHp>

      <div className="grid grid-cols-2 gap-[8px] sm:gap-[16px] lg:grid-cols-4">
        <AtalhoHp titulo="Clientes ativos" valor={n0(lojasAtivas)} href="#clientes" testid="sa-atalho-clientes" />
        <AtalhoHp titulo="Rotinas automáticas" valor={`${cronsOk} de ${crons.length} ok`} href="/superadmin/saude#rotinas" />
        <AtalhoHp titulo="APIs pagas hoje" valor={`${n0(apisHoje)} chamadas`} href="#uso" />
        <AtalhoHp titulo="WhatsApp das lojas" valor={m && m.whatsappCaido.length ? `${m.whatsappCaido.length} desconectada(s)` : 'Tudo conectado'} href="/superadmin/saude#whatsapp" />
      </div>
    </>
  )
}
