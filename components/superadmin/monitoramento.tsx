import Link from 'next/link'
import { Activity, AlertTriangle, CheckCircle2, Database, Server } from 'lucide-react'
import { avaliar, CRONS, type Medidas } from '@/lib/saude/avaliar'
import { diasAteFimDoCiclo, PLANO_PRO } from '@/lib/saude/oficial'
import { BYTES_EGRESS_POR_REQ } from '@/lib/saude/vigia'
import { AnelHp, CabecalhoHp, CLASSE_BOTAO_SECUNDARIO, MetricaHp, PainelHp, SeloHp, SparklineHp } from './hp'
import { InfoHp } from './info-hp'
import { ListaAlertas } from './alertas-faixa'
import { GraficoDiasHp } from './grafico-hp'

/**
 * Monitoramento da Visão geral (29/10/2026; 30/10: a Saúde do sistema veio toda para cá, sem repetir número). Separa SUPABASE
 * (banco, cobrado por uso) e VPS (onde o app roda). Só exibição — os números são as fotos que o vigia já grava a cada 5 min
 * (sistema_saude_fotos) e a série de 30 dias (0232), sem consulta nova a API nenhuma.
 */
export interface FotoSaude { em: string; dados: Medidas }
export interface DiaSaude { dia: string; req_postgrest: number; tx_bytes: number }

const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'))
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const gb = (b: number | null | undefined, casas = 2) => (b == null ? '—' : `${(b / 1e9).toFixed(casas)} GB`)
const ha = (iso: string | null | undefined) => {
  if (!iso) return 'sem leitura'
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  return min <= 0 ? 'lido agora' : min < 120 ? `lido há ${min} min` : `lido há ${Math.round(min / 60)} h`
}
const pctF = (v: number) => `${Math.round(v)}%`
/** Card vermelho só pela tela (30/10, pedido do dono), à parte dos alertas do vigia: VPS a partir de 60%, o resto a partir de 70%. */
const VERMELHO_VPS = 60
const VERMELHO_GERAL = 70
const passou = (v: number | null | undefined, limite: number) => v != null && v >= limite
const CURVA_VERMELHA = '#E73A47'
const gbF = (v: number) => `${v.toFixed(v < 1 ? 2 : 1)} GB`

function Grupo({ icone, titulo, sub, info, children }: { icone: React.ReactNode; titulo: string; sub: string; info: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-[12px] pb-[12px] pt-[12px] sm:px-[24px] sm:pb-[20px] sm:pt-[16px]">
      <div className="mb-[8px] flex flex-wrap items-center gap-x-[8px] sm:mb-[12px]">
        <span className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px] bg-[#EBE4FF] text-[#673DE6]" aria-hidden>{icone}</span>
        <h3 className="text-[14px] font-semibold leading-[20px] text-[#18181A] sm:text-[15px]">{titulo}</h3>
        <InfoHp titulo={titulo}>{info}</InfoHp>
        <span className="text-[12px] leading-[16px] text-[#58585E] max-sm:basis-full sm:text-[13px]">{sub}</span>
      </div>
      <div className="grid grid-cols-2 gap-[8px] sm:gap-[12px] lg:grid-cols-4">{children}</div>
    </div>
  )
}

/** Requisições das últimas 24 h por serviço: quem mais pede dados ao banco. */
function RequisicoesServico({ r }: { r: { rest: number; auth: number; storage: number; realtime: number; total: number } }) {
  const itens: [string, number][] = [['Dados (PostgREST)', r.rest], ['Login e sessão (Auth)', r.auth], ['Fotos (Storage)', r.storage], ['Pedidos ao vivo (Realtime)', r.realtime]]
  const max = Math.max(1, ...itens.map(([, v]) => v))
  return (
    <div className="px-[12px] pb-[12px] sm:px-[24px] sm:pb-[20px]" data-testid="sa-req-servico">
      <div className="rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.08)] px-[12px] py-[10px] sm:px-[16px] sm:py-[12px]">
        <p className="mb-[8px] flex items-center gap-[4px] text-[13px] font-semibold leading-[20px] text-[#18181A] sm:text-[14px]">
          Requisições em 24 h: {n0(r.total)}
          <InfoHp titulo="Requisições em 24 h">Quantas vezes o app e as lojas pediram dados ao banco, separado por serviço (número oficial do Supabase). Subida brusca sem mais pedidos = possível loop.</InfoHp>
        </p>
        <ul className="m-0 grid list-none gap-x-[24px] gap-y-[8px] p-0 sm:grid-cols-2">
          {itens.map(([rotulo, v]) => (
            <li key={rotulo} className="min-w-0">
              <div className="flex justify-between gap-[8px] text-[12px] leading-[16px] sm:text-[13px]"><span className="min-w-0 truncate text-[#58585E]">{rotulo}</span><span className="font-semibold tabular-nums text-[#18181A]">{n0(v)}</span></div>
              <div className="mt-[3px] h-[6px] overflow-hidden rounded-full bg-[#EBE4FF]" aria-hidden><div className="h-full rounded-full bg-[#673DE6]" style={{ width: `${(v / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function Monitoramento({ fotos, picoReq }: { fotos: FotoSaude[]; picoReq?: { media: number; dias: number } | null }) {
  const m = fotos[0]?.dados ?? null
  const serie = [...fotos].reverse()
  const horas = serie.map((f) => hora(f.em))
  const pontos = m ? avaliar(m) : []
  const vermelho = pontos.some((a) => a.nivel === 'vermelho')
  const selo = !m ? <SeloHp tom="cinza">Sem leitura</SeloHp>
    : pontos.length === 0 ? <SeloHp tom="verde" testid="sa-status">Em atividade</SeloHp>
      : <SeloHp tom={vermelho ? 'vermelho' : 'ambar'} testid="sa-status">{pontos.length} ponto(s) de atenção</SeloHp>
  const cicloDia = Number(process.env.SUPABASE_CICLO_DIA) || 28
  const o = m?.oficial
  const prom = o?.prom
  const hostinger = o?.hostinger
  const memUsada = m?.memLivrePct == null ? null : 100 - m.memLivrePct
  const egressPct = m?.egressMesGb == null ? null : (m.egressMesGb / PLANO_PRO.egressGb) * 100
  // A foto guarda a memória DISPONÍVEL (memDisp); a tela mostra a ocupada, como os outros cards de uso.
  const memOcupada = (p?: { memTotal: number; memDisp: number } | null) => (p?.memTotal ? 100 - (p.memDisp / p.memTotal) * 100 : null)
  const memBanco = memOcupada(prom)
  const discoBanco = prom?.discoTotal ? prom.discoTotal - prom.discoLivre : null
  const discoBancoPct = discoBanco != null && prom?.discoTotal ? (discoBanco / prom.discoTotal) * 100 : null
  const dbPct = (prom?.dbBytes ?? m?.dbBytes) != null ? (Number(prom?.dbBytes ?? m?.dbBytes) / (PLANO_PRO.discoGb * 1e9)) * 100 : null
  const storagePct = m?.storageBytes != null ? (m.storageBytes / (PLANO_PRO.storageGb * 1e9)) * 100 : null
  const a = {
    cpuBanco: passou(prom?.cpuPct, VERMELHO_GERAL), memBanco: passou(memBanco, VERMELHO_GERAL), egress: passou(egressPct, VERMELHO_GERAL),
    db: passou(dbPct, VERMELHO_GERAL), storage: passou(storagePct, VERMELHO_GERAL), discoBanco: passou(discoBancoPct, VERMELHO_GERAL),
    cpu: passou(m?.cpuPct, VERMELHO_VPS), mem: passou(memUsada, VERMELHO_VPS), disco: passou(m?.discoUsadoPct, VERMELHO_VPS),
  }
  return (
    <PainelHp testid="sa-monitoramento">
      <CabecalhoHp
        icone={<Activity className="h-[22px] w-[22px]" aria-hidden />}
        titulo="Menuzia · Produção"
        selo={selo}
        info="O vigia é uma rotina do próprio sistema que, a cada 5 minutos, lê os números do Supabase, da VPS e das APIs pagas e compara com os limites. Verde = tudo normal; amarelo/vermelho = algum número passou do limite e sai um alerta."
        sub={m ? `Verificado às ${hora(m.em)}, a cada 5 min · Supabase Pro · ciclo vira em ${diasAteFimDoCiclo(new Date(), cicloDia)} dias` : 'O vigia ainda não rodou.'}
        acoes={<Link href="/superadmin" className={`${CLASSE_BOTAO_SECUNDARIO} max-sm:hidden`}>Atualizar</Link>}
      />
      {pontos.length > 0 && (
        <div className="pb-[4px]" data-testid="saude-situacao">
          <ListaAlertas vazio="" alertas={pontos.map((a) => ({ id: a.assunto, criado_em: m!.em, nivel: a.nivel, texto: a.texto }))} />
        </div>
      )}
      <div className="border-t-[0.8px] border-[rgba(0,0,0,0.1)]" />

      <Grupo icone={<Database className="h-[16px] w-[16px]" />} titulo="Supabase" sub={`banco de dados, cobrado por uso · número grande = última leitura · gráfico = últimas 3 h · ${ha(prom?.em ?? m?.em)}`}
        info="O Supabase guarda todos os dados (pedidos, cardápios, lojas, fotos). Ele cobra por cota no ciclo mensal: se o egress ou o disco passar do limite do plano, o banco pode ser bloqueado e os pedidos param.">
        <MetricaHp rotulo="Requisições" testid="sa-req" valor={n0(m?.reqPorMin)} unidade="/min"
          cantoTom={!picoReq || m?.reqPorMin == null ? 'roxo' : m.reqPorMin > picoReq.media ? 'vermelho' : 'verde'}
          canto={picoReq ? <span title={`Média da hora mais movimentada de cada um dos últimos ${picoReq.dias} dia(s) completos. Verde: agora está abaixo dela. Vermelho: agora está acima.`} data-testid="sa-req-pico">Pico {picoReq.dias}d: {n0(picoReq.media)}/min</span> : undefined}
          nota={m?.reqMediaPorMin != null ? `${m.reqReferenciaMesmoHorario ? 'normal do horário' : 'média geral'} ${n0(m.reqMediaPorMin)}/min` : undefined}
          info="Quantas vezes por minuto o sistema consulta o banco. Cada consulta gasta tráfego (egress). O dobro do normal deste horário por muito tempo pode indicar algo em repetição. No canto: média da hora mais movimentada de cada dia, nos últimos 7 dias completos; verde = agora está abaixo dessa base; vermelho = agora está acima, fora do normal."
          grafico={<SparklineHp rotulos={horas} rotulo="Requisições por minuto" valores={serie.map((f) => Number(f.dados.reqPorMin))} />} />
        <MetricaHp rotulo="CPU do banco" testid="sa-cpu-banco" alerta={a.cpuBanco} valor={prom?.cpuPct == null ? '—' : `${Math.round(prom.cpuPct)}%`}
          info="Quanto do processador do servidor do banco está em uso (número oficial do Supabase). Acima de ~70% por muito tempo, é hora de subir o tamanho do banco."
          grafico={<SparklineHp rotulos={horas} rotulo="CPU do banco" cor={a.cpuBanco ? CURVA_VERMELHA : undefined} formato={pctF} valores={serie.map((f) => Number(f.dados.oficial?.prom?.cpuPct))} />} />
        <MetricaHp rotulo="Memória em uso (banco)" testid="sa-mem-banco" alerta={a.memBanco} valor={memBanco == null ? '—' : pctF(memBanco)}
          info="Memória ocupada no servidor do banco. Quanto menor, melhor: acima de 70% o card fica vermelho, e pouca memória sobrando deixa as consultas mais lentas."
          grafico={<SparklineHp rotulos={horas} rotulo="Memória em uso do banco" cor={a.memBanco ? CURVA_VERMELHA : undefined} formato={pctF} valores={serie.map((f) => memOcupada(f.dados.oficial?.prom) ?? NaN)} />} />
        <MetricaHp rotulo="Disk IO" testid="sa-io" valor={prom?.iops == null ? '—' : n0(prom.iops)} unidade="op/s" nota={prom?.ioMBs == null ? undefined : `${prom.ioMBs} MB/s`}
          info="Leituras e gravações por segundo no disco do banco. O plano tem um teto; passar dele deixa as consultas em fila."
          grafico={<SparklineHp rotulos={horas} rotulo="Disk IO" valores={serie.map((f) => Number(f.dados.oficial?.prom?.iops))} />} />
        <MetricaHp rotulo="Egress no mês" testid="sa-egress" alerta={a.egress} valor={m?.egressMesGb == null ? '—' : `${Math.round(m.egressMesGb)} GB`} unidade={`/ ${PLANO_PRO.egressGb}`} nota="estimado"
          info={`Egress é tudo que SAI do Supabase para o app e para os clientes (dados e fotos). É a cota que bloqueou o banco em 27/10. O Supabase não tem API desse número, então é uma projeção: requisições × ${BYTES_EGRESS_POR_REQ} B. O anel mostra quanto da cota isso representa.`}
          anel={egressPct != null ? <AnelHp pct={egressPct} rotulo="Egress do mês" alerta={a.egress} /> : undefined} />
        <MetricaHp rotulo="Banco de dados" testid="sa-db" alerta={a.db} valor={gb(prom?.dbBytes ?? m?.dbBytes)} nota={`limite ${PLANO_PRO.discoGb} GB`}
          info="Tamanho das tabelas (pedidos, clientes, cardápios). Cresce devagar; as tabelas de registro são limpas sozinhas (retenção)."
          grafico={<SparklineHp rotulos={horas} rotulo="Banco de dados" cor={a.db ? CURVA_VERMELHA : undefined} formato={(v) => gbF(v)} valores={serie.map((f) => Number(f.dados.oficial?.prom?.dbBytes ?? f.dados.dbBytes) / 1e9)} />} />
        <MetricaHp rotulo="Storage (fotos)" testid="sa-storage" alerta={a.storage} valor={gb(m?.storageBytes)} nota={`limite ${PLANO_PRO.storageGb} GB`}
          info="Arquivos guardados: fotos dos itens, logos, capas e vídeos das lojas."
          grafico={<SparklineHp rotulos={horas} rotulo="Storage" cor={a.storage ? CURVA_VERMELHA : undefined} formato={(v) => gbF(v)} valores={serie.map((f) => Number(f.dados.storageBytes) / 1e9)} />} />
        <MetricaHp rotulo="Disco do banco" testid="sa-disco-banco" alerta={a.discoBanco} valor={discoBanco == null ? '—' : gb(discoBanco, 1)} nota={prom?.discoTotal ? `de ${gb(prom.discoTotal, 1)}` : undefined}
          info="Espaço em disco do servidor do banco (dados + índices + registros internos). O Supabase aumenta sozinho quando enche."
          anel={discoBanco != null && prom?.discoTotal ? <AnelHp pct={(discoBanco / prom.discoTotal) * 100} rotulo="Disco do banco" alerta={a.discoBanco} /> : undefined} />
      </Grupo>
      {o?.supabase?.req24h && <RequisicoesServico r={o.supabase.req24h} />}

      <div className="border-t-[0.8px] border-[rgba(0,0,0,0.1)]" />

      <Grupo icone={<Server className="h-[16px] w-[16px]" />} titulo="VPS" sub={`servidor do app, na Hostinger · número grande = última leitura · gráfico = últimas 3 h · ${ha(hostinger?.amostraEm ?? hostinger?.em ?? m?.em)}`}
        info="A VPS é o computador alugado na Hostinger que roda o Menuzia (vitrine, painel, rotinas). Se CPU, memória ou disco enchem, o site fica lento ou cai — os dados continuam salvos no Supabase.">
        <MetricaHp rotulo="Uso da CPU" testid="sa-cpu" alerta={a.cpu} valor={m?.cpuPct == null ? '—' : `${Math.round(m.cpuPct)}%`}
          info="Processador da VPS em uso. Durante um deploy sobe muito por alguns minutos (normal). Só alerta se ficar acima de 90% por 15 minutos."
          grafico={<SparklineHp rotulos={horas} rotulo="CPU da VPS" cor={a.cpu ? CURVA_VERMELHA : undefined} formato={pctF} valores={serie.map((f) => Number(f.dados.cpuPct))} />} />
        <MetricaHp rotulo="Uso de memória" testid="sa-mem" alerta={a.mem} valor={memUsada == null ? '—' : `${Math.round(memUsada)}%`} nota={hostinger?.ramBytes != null ? `${gb(hostinger.ramBytes, 1)}${hostinger.ramTotal ? ` de ${gb(hostinger.ramTotal, 1)}` : ''}` : undefined}
          info="Memória RAM da VPS em uso (o mesmo número do painel da Hostinger). Acima de 80% o servidor pode ficar lento; se acabar, o sistema trava."
          grafico={<SparklineHp rotulos={horas} rotulo="Memória da VPS" cor={a.mem ? CURVA_VERMELHA : undefined} formato={pctF} valores={serie.map((f) => f.dados.memLivrePct == null ? NaN : 100 - f.dados.memLivrePct)} />} />
        <MetricaHp rotulo="Rede (saída)" testid="sa-rede" valor={hostinger ? gb(hostinger.saidaBytes) : '—'} nota={hostinger ? `entrada ${gb(hostinger.entradaBytes)}` : 'sem leitura da Hostinger'}
          info="Tráfego da VPS com a internet. Não é cobrado à parte, mas um salto pode indicar robô ou loop."
          grafico={<SparklineHp rotulos={horas} rotulo="Rede de saída" formato={(v) => gbF(v)} valores={serie.map((f) => { const b = f.dados.oficial?.hostinger?.saidaBytes; return b == null ? NaN : b / 1e9 })} />} />
        <MetricaHp rotulo="Uso do disco" testid="sa-disco" alerta={a.disco} valor={m?.discoUsadoPct == null ? '—' : `${Math.round(m.discoUsadoPct)}%`} nota={hostinger?.discoBytes != null ? `${gb(hostinger.discoBytes, 1)}${hostinger.discoTotal ? ` de ${gb(hostinger.discoTotal, 0)}` : ''}` : undefined}
          info="Espaço usado no disco da VPS. Cada deploy deixa uma imagem; a limpeza automática roda a cada 6 h e guarda as 3 últimas."
          anel={m?.discoUsadoPct != null ? <AnelHp pct={m.discoUsadoPct} rotulo="Disco da VPS" alerta={a.disco} /> : undefined} />
      </Grupo>

      {o?.erros && (
        <p className="mx-[12px] mb-[12px] rounded-[12px] bg-[#FFF8E2] p-[12px] text-[13px] leading-[18px] text-[#8A6100] sm:mx-[24px] sm:mb-[20px]">
          Fonte com erro na última leitura: {Object.entries(o.erros).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
      )}
    </PainelHp>
  )
}

/** Tendência de 30 dias: um número por dia. */
export function Tendencia30({ dias }: { dias: DiaSaude[] }) {
  const temTx = dias.some((d) => Number(d.tx_bytes) > 0)
  const eixo = dias.map((d) => d.dia)
  return (
    <div className="grid gap-[12px] lg:grid-cols-2 lg:gap-[20px]" data-testid="sa-tendencia">
      <PainelHp className="p-[12px] sm:p-[20px]">
        <div className="mb-[4px] flex items-center gap-[2px]">
          <h2 className="text-[15px] font-semibold leading-[22px] text-[#18181A]">Requisições ao banco por dia</h2>
          <InfoHp titulo="Requisições ao banco por dia">Total diário de chamadas PostgREST (dados) ao Supabase, contado pelo vigia. Se as barras sobem sem aumento de pedidos, algo está pedindo dados demais.</InfoHp>
        </div>
        <GraficoDiasHp rotulo="Requisições ao banco nos últimos 30 dias" dias={eixo} formato={(v) => (v >= 1000 ? `${Math.round(v / 1000).toLocaleString('pt-BR')} mil` : String(Math.round(v)))}
          series={[{ nome: 'Requisições', cor: '#673DE6', valores: dias.map((d) => Number(d.req_postgrest)) }]} />
      </PainelHp>
      <PainelHp className="p-[12px] sm:p-[20px]">
        <div className="mb-[4px] flex items-center gap-[2px]">
          <h2 className="text-[15px] font-semibold leading-[22px] text-[#18181A]">Egress por dia</h2>
          <InfoHp titulo="Egress por dia">{temTx
            ? 'Saída de rede do servidor do banco, lida no Supabase (inclui conexões diretas e réplica; o egress cobrado só conta o que sai pela API).'
            : `Estimativa: requisições do dia × ${BYTES_EGRESS_POR_REQ} B.`}</InfoHp>
        </div>
        <GraficoDiasHp rotulo="Egress nos últimos 30 dias" dias={eixo} formato={gbF}
          series={[{ nome: 'Egress', cor: '#0B86C9', valores: dias.map((d) => (temTx ? Number(d.tx_bytes) : Number(d.req_postgrest) * BYTES_EGRESS_POR_REQ) / 1e9) }]} />
      </PainelHp>
    </div>
  )
}

/** Requisições/min de uma foto do vigia (só a hora e o número, sem o resto da foto). */
export interface LeituraHora { em: string; req: number | null }

const textoHora = (h: string) => `${h}h às ${String((Number(h) + 1) % 24).padStart(2, '0')}h`

/** Três horas mais movimentadas, em selos. */
function MaioresHoras({ horas, formato }: { horas: { h: string; v: number }[]; formato: (v: number) => string }) {
  const top = [...horas].filter((x) => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3)
  return (
    <ul className="m-0 mb-[4px] flex list-none flex-wrap gap-[6px] p-0" data-testid="sa-horas-top">
      {top.map((x) => <li key={x.h}><SeloHp tom="roxo">{textoHora(x.h)} · {formato(x.v)}</SeloHp></li>)}
    </ul>
  )
}

/** Horários de pico das últimas 24 h, por hora do dia. Egress = estimativa a partir das requisições (o vigia não mede por hora). */
export function HorariosPico({ leituras }: { leituras: LeituraHora[] }) {
  const soma = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }))
  for (const l of leituras) {
    const v = Number(l.req)
    if (l.req == null || !Number.isFinite(v)) continue
    const h = Number(new Date(l.em).toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }))
    soma[h].s += v; soma[h].n += 1
  }
  const nomes = soma.map((_, h) => String(h).padStart(2, '0'))
  const req = soma.map((x) => (x.n ? x.s / x.n : 0))
  const mb = req.map((v) => (v * 60 * BYTES_EGRESS_POR_REQ) / 1e6)
  const fReq = (v: number) => `${Math.round(v).toLocaleString('pt-BR')}/min`
  const fMb = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} GB` : `${v.toFixed(v < 10 ? 1 : 0)} MB`)
  const colunas = { dias: nomes, rotuloDe: (h: string) => `${h}h`, visivel: (i: number) => i % 6 === 0 || i === 23 }
  return (
    <PainelHp testid="sa-horarios-pico">
      <CabecalhoHp titulo="Horários de pico" sub="Últimas 24 h, média de cada hora"
        info={`Mostra em que hora do dia o banco trabalha mais. Vem das leituras do vigia, a cada 5 minutos. O egress por hora é estimado: requisições × ${BYTES_EGRESS_POR_REQ} B, por isso os horários batem com os das requisições.`} />
      <div className="grid gap-[20px] px-[12px] pb-[12px] sm:px-[24px] sm:pb-[20px] lg:grid-cols-2">
        <div className="min-w-0">
          <h3 className="mb-[6px] text-[14px] font-semibold leading-[20px] text-[#18181A]">Requisições</h3>
          <MaioresHoras horas={nomes.map((h, i) => ({ h, v: req[i] }))} formato={fReq} />
          <GraficoDiasHp rotulo="Requisições por minuto em cada hora do dia" formato={fReq} {...colunas} altura={130}
            series={[{ nome: 'Requisições', cor: '#673DE6', valores: req }]} />
        </div>
        <div className="min-w-0">
          <h3 className="mb-[6px] text-[14px] font-semibold leading-[20px] text-[#18181A]">Egress (estimado)</h3>
          <MaioresHoras horas={nomes.map((h, i) => ({ h, v: mb[i] }))} formato={fMb} />
          <GraficoDiasHp rotulo="Egress estimado em cada hora do dia" formato={fMb} {...colunas} altura={130}
            series={[{ nome: 'Egress', cor: '#0B86C9', valores: mb }]} />
        </div>
      </div>
    </PainelHp>
  )
}

/** Nome das rotinas em português; rotina nova sem nome aqui aparece com o nome técnico. */
const NOME_ROTINA: Record<string, string> = {
  whatsapp: 'WhatsApp e vigia', campanhas: 'Campanhas', push: 'Notificações push', canais: 'Canais de venda', entregas: 'Entregas automáticas',
  'loja-horario': 'Abrir e fechar lojas', 'pix-online': 'Pix online', 'financeiro-vigia': 'Vigia do financeiro',
  'financeiro-diario': 'Financeiro diário', 'ancora-integridade': 'Âncora de integridade',
}
const intervalo = (min: number) => (min >= 1440 ? 'por dia' : min >= 60 ? `a cada ${min / 60} h` : `a cada ${min} min`)
const tempo = (min: number) => (min <= 0 ? 'agora' : min < 120 ? `há ${min} min` : min < 2880 ? `há ${Math.round(min / 60)} h` : `há ${Math.round(min / 1440)} dias`)

/** Rotinas em blocos: a atrasada vem primeiro, em vermelho; o resto cabe numa olhada só. */
export function RotinasHp({ crons }: { crons: { nome: string; ultima_em: string }[] }) {
  const lista = crons.map((c) => {
    const min = Math.floor((Date.now() - Date.parse(c.ultima_em)) / 60_000)
    const cada = CRONS[c.nome] ?? 1
    return { ...c, min, cada, atrasada: min > Math.max(10, cada * 3) }
  }).sort((a, b) => Number(b.atrasada) - Number(a.atrasada) || (NOME_ROTINA[a.nome] ?? a.nome).localeCompare(NOME_ROTINA[b.nome] ?? b.nome, 'pt-BR'))
  const atrasadas = lista.filter((c) => c.atrasada).length
  return (
    <PainelHp id="rotinas" testid="sa-rotinas" className="min-w-0 scroll-mt-[16px]">
      <CabecalhoHp titulo="Rotinas automáticas"
        info="Tarefas que o servidor roda sozinho de tempos em tempos (despacho de entregas, Pix, vigia, limpezas). Cada bloco mostra a última vez que rodou; em vermelho = atrasada (parou de rodar)."
        selo={lista.length ? <SeloHp tom={atrasadas ? 'vermelho' : 'verde'}>{atrasadas ? `${atrasadas} atrasada(s)` : `${lista.length} em dia`}</SeloHp> : undefined} />
      {lista.length === 0
        ? <p className="px-[16px] pb-[16px] text-[14px] leading-[20px] text-[#58585E] sm:px-[24px]">Nenhuma rotina registrada ainda.</p>
        : (
          <ul className="m-0 grid list-none grid-cols-2 gap-[8px] px-[12px] pb-[12px] sm:px-[24px] sm:pb-[20px] md:grid-cols-3">
            {lista.map((c) => (
              <li key={c.nome} data-testid="sa-rotina" data-atrasada={c.atrasada} className={`flex min-w-0 items-start gap-[8px] rounded-[12px] px-[10px] py-[8px] ${c.atrasada ? 'bg-[#FFE8EF]' : 'bg-[#F5F5F6]'}`}>
                {c.atrasada
                  ? <AlertTriangle className="mt-[2px] h-[16px] w-[16px] flex-shrink-0 text-[#B3122D]" aria-hidden />
                  : <CheckCircle2 className="mt-[2px] h-[16px] w-[16px] flex-shrink-0 text-[#008361]" aria-hidden />}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold leading-[20px] text-[#18181A]" title={c.nome}>{NOME_ROTINA[c.nome] ?? c.nome}</span>
                  <span className={`block text-[12px] leading-[16px] tabular-nums ${c.atrasada ? 'font-semibold text-[#B3122D]' : 'text-[#58585E]'}`}>{c.atrasada ? 'atrasada · ' : ''}{tempo(c.min)} · {intervalo(c.cada)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
    </PainelHp>
  )
}

export function WhatsappLojasHp({ caidas }: { caidas: { loja: string; minutos: number }[] }) {
  return (
    <PainelHp id="whatsapp" testid="sa-whatsapp" className="min-w-0 scroll-mt-[16px]">
      <CabecalhoHp titulo="WhatsApp das lojas"
        info="Lojas cujo WhatsApp caiu sozinho estando em uso. Loja que desconectou por vontade própria não entra aqui nem gera alerta: fica desconectada até o dono reconectar em Integrações."
        selo={<SeloHp tom={caidas.length ? 'vermelho' : 'verde'}>{caidas.length ? `${caidas.length} fora` : 'Tudo conectado'}</SeloHp>} />
      {caidas.length > 0 && (
        <ul className="m-0 list-none px-[16px] pb-[12px] sm:px-[24px] sm:pb-[20px]">
          {caidas.map((w) => (
            <li key={w.loja} className="flex min-h-[40px] items-center justify-between gap-[12px] border-t-[0.8px] border-[rgba(0,0,0,0.08)] text-[14px] leading-[20px]">
              <span className="min-w-0 truncate text-[#18181A]">{w.loja}</span>
              <span className="flex-shrink-0 font-semibold tabular-nums text-[#B3122D]">fora há {n0(w.minutos)} min</span>
            </li>
          ))}
        </ul>
      )}
    </PainelHp>
  )
}
