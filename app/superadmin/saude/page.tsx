import { getAdminSupabase } from '@/lib/supabase/admin'
import { avaliar, CRONS, type Medidas } from '@/lib/saude/avaliar'
import { diasAteFimDoCiclo, PLANO_PRO } from '@/lib/saude/oficial'
import { BYTES_EGRESS_POR_REQ } from '@/lib/saude/vigia'
import { Barra } from '@/components/superadmin/uso-apis'
import { CabecalhoHp, PainelHp, SeloHp, ShellHp } from '@/components/superadmin/hp'
import { InfoHp } from '@/components/superadmin/info-hp'
import { DetalheAlerta, type AlertaTela } from '@/components/superadmin/alertas-faixa'

export const dynamic = 'force-dynamic'

/**
 * Super Admin › Saúde do sistema (28/10/2026; reorganizada em 29/10). Só leitura: a última foto do vigia (lib/saude/vigia.ts),
 * a série de 30 dias (0232), os crons e o histórico de alertas. Separada em Supabase × VPS × APIs pagas × rotinas × alertas;
 * cada número tem um "i" que explica o que é e de onde vem.
 */
const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'))
const gb = (b: number | null | undefined, casas = 2) => (b == null ? '—' : `${(b / 1e9).toFixed(casas)} GB`)
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`)
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const ha = (iso: string | null | undefined) => {
  if (!iso) return 'sem leitura'
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  return min <= 0 ? 'lido agora' : min < 120 ? `lido há ${min} min` : `lido há ${Math.round(min / 60)} h`
}

type TipoFonte = 'supabase' | 'hostinger' | 'estimado' | 'servidor' | 'exato' | 'plano'
const FONTE: Record<TipoFonte, string> = {
  supabase: 'Supabase oficial', hostinger: 'Hostinger oficial', estimado: 'estimado', servidor: 'medido no servidor',
  exato: 'contado pelo sistema', plano: 'plano Pro',
}

/** Título de grupo (Supabase, VPS…) com o "i" e de onde/quando veio o número. */
function Grupo({ id, titulo, sub, info, children }: { id?: string; titulo: string; sub?: string; info: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-[16px] flex-col gap-[10px]">
      <div className="flex flex-wrap items-center gap-x-[6px] px-[4px]">
        <h2 className="text-[17px] font-semibold leading-[24px] text-[#18181A] sm:text-[18px]">{titulo}</h2>
        <InfoHp titulo={titulo}>{info}</InfoHp>
        {sub && <span className="basis-full text-[13px] leading-[18px] text-[#58585E] sm:basis-auto">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

/** Um número: rótulo + "i", valor grande, barra opcional e a fonte. Duas colunas no celular. */
function Numero({ rotulo, valor, info, barra, fonte, nota }: { rotulo: string; valor: React.ReactNode; info: React.ReactNode; barra?: React.ReactNode; fonte?: TipoFonte; nota?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[4px] rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white p-[12px] sm:rounded-[20px] sm:p-[16px]">
      <div className="flex min-w-0 items-center gap-[2px]">
        <span className="min-w-0 truncate text-[13px] leading-[18px] text-[#58585E] sm:text-[14px]" title={rotulo}>{rotulo}</span>
        <InfoHp titulo={rotulo}>{info}</InfoHp>
      </div>
      <div className="text-[18px] font-semibold leading-[24px] tabular-nums text-[#18181A] sm:text-[22px] sm:leading-[28px]">{valor}</div>
      {barra && <div className="pt-[2px]">{barra}</div>}
      {(nota || fonte) && <p className="text-[12px] leading-[16px] text-[#58585E]">{nota}{nota && fonte ? ' · ' : ''}{fonte && FONTE[fonte]}</p>}
    </div>
  )
}

/** Linha de lista (rotinas, WhatsApp, APIs): nome à esquerda, situação à direita. */
function Linha({ rotulo, valor, info }: { rotulo: React.ReactNode; valor: React.ReactNode; info?: React.ReactNode }) {
  return (
    <li className="flex min-h-[44px] items-center justify-between gap-[12px] border-b-[0.8px] border-[rgba(0,0,0,0.08)] py-[6px] text-[14px] leading-[20px] last:border-0">
      <span className="flex min-w-0 items-center gap-[2px] text-[#18181A]"><span className="min-w-0 break-words">{rotulo}</span>{info}</span>
      <span className="min-w-0 flex-shrink-0 text-right font-semibold tabular-nums text-[#18181A]">{valor}</span>
    </li>
  )
}

function Grafico30({ titulo, dias, valor, formato, cor }: { titulo: string; dias: { dia: string }[]; valor: (i: number) => number; formato: (v: number) => string; cor: string }) {
  const W = 560, H = 190, pe = 24, esq = 52, topo = 10
  const vals = dias.map((_, i) => valor(i))
  const max = Math.max(1, ...vals)
  const passo = (W - esq) / Math.max(dias.length, 1)
  const y = (v: number) => topo + (H - pe - topo) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={titulo}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={esq} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />
          <text x={esq - 6} y={y(max * f) + 4} textAnchor="end" fontSize={12} fill="#58585E">{formato(max * f)}</text>
        </g>
      ))}
      {vals.map((v, i) => (
        <g key={dias[i].dia}>
          <rect x={esq + i * passo + 1} y={y(v)} width={Math.max(3, passo - 3)} height={Math.max(0, H - pe - y(v))} rx={2} fill={cor}><title>{`${dias[i].dia.slice(8, 10)}/${dias[i].dia.slice(5, 7)}: ${formato(v)}`}</title></rect>
          {(i === 0 || i === vals.length - 1 || i % 7 === 0) && <text x={esq + i * passo + passo / 2} y={H - 6} textAnchor="middle" fontSize={12} fill="#58585E">{`${dias[i].dia.slice(8, 10)}/${dias[i].dia.slice(5, 7)}`}</text>}
        </g>
      ))}
    </svg>
  )
}

export default async function SaudePage() {
  const admin = getAdminSupabase()
  const [{ data: foto }, { data: alertas }, { data: crons }, { data: serie }] = await Promise.all([
    admin.from('sistema_saude_fotos').select('em, dados').order('em', { ascending: false }).limit(1).maybeSingle(),
    admin.from('sistema_alertas').select('id, criado_em, assunto, nivel, texto, canal, enviado, erro').order('criado_em', { ascending: false }).limit(60),
    admin.from('sistema_cron_batidas').select('nome, ultima_em').order('nome'),
    admin.rpc('sistema_saude_dias', { p_dias: 30 }),
  ])
  const m = (foto?.dados ?? null) as Medidas | null
  const o = m?.oficial
  const ativos = m ? avaliar(m) : []
  const dias = ((serie ?? []) as { dia: string; req_postgrest: number; tx_bytes: number; oficial_24h: { total?: number } | null }[]).map((d) => ({ ...d, dia: String(d.dia).slice(0, 10) }))
  const cicloDia = Number(process.env.SUPABASE_CICLO_DIA) || 28
  const hostinger = o?.hostinger
  const temTx = dias.some((d) => Number(d.tx_bytes) > 0)
  const vermelho = ativos.some((a) => a.nivel === 'vermelho')
  const listaCrons = (crons ?? []) as { nome: string; ultima_em: string }[]
  const grade = 'grid grid-cols-2 gap-[10px] sm:gap-[16px] lg:grid-cols-4'
  return (
    <ShellHp aba="saude" titulo="Saúde do sistema">
      {/* Situação agora: o que o vigia achou na última volta (o mesmo texto que vai no WhatsApp). */}
      <PainelHp testid="saude-situacao">
        <CabecalhoHp titulo="Situação agora"
          sub={foto ? `Última verificação: ${quando(foto.em)} · o vigia confere tudo a cada 5 min` : 'O vigia ainda não rodou.'}
          selo={<SeloHp tom={vermelho ? 'vermelho' : ativos.length ? 'ambar' : 'verde'}>{ativos.length ? `${ativos.length} ponto(s) de atenção` : 'Tudo normal'}</SeloHp>}
          info="O vigia é uma rotina do próprio sistema que, a cada 5 minutos, lê os números do Supabase, da VPS e das APIs pagas e compara com os limites. Se algo passa do limite, aparece aqui e sai um alerta (WhatsApp/e-mail)." />
        {ativos.length > 0 && (
          <div className="flex flex-col gap-[10px] px-[12px] pb-[12px] sm:px-[24px] sm:pb-[20px]">
            {ativos.map((a) => <DetalheAlerta key={a.assunto} a={{ criado_em: m!.em, nivel: a.nivel, texto: a.texto }} />)}
          </div>
        )}
      </PainelHp>

      {m && (
        <>
          <Grupo titulo="Supabase · banco de dados" sub={`Plano Pro · ciclo vira dia ${cicloDia} (faltam ${diasAteFimDoCiclo(new Date(), cicloDia)} dias) · ${ha(o?.prom?.em ?? m.em)}`}
            info="O Supabase guarda todos os dados (pedidos, cardápios, lojas, fotos). Ele cobra por cota no ciclo mensal: se o egress ou o disco passar do limite do plano, o banco pode ser bloqueado e os pedidos param.">
            <div className={grade}>
              <Numero rotulo="Egress no mês" fonte="estimado" valor={m.egressMesGb == null ? '—' : `${Math.round(m.egressMesGb)} GB`}
                barra={m.egressMesGb == null ? undefined : <Barra chamadas={Math.round(m.egressMesGb)} limite={PLANO_PRO.egressGb} compacta />}
                nota={`limite ${PLANO_PRO.egressGb} GB`}
                info={`Egress é tudo que SAI do Supabase para o app e para os clientes (dados e fotos). É a cota que bloqueou o banco em 27/10. O Supabase não tem API desse número, então é uma projeção: requisições × ${BYTES_EGRESS_POR_REQ} B (calibrado em 28/10 contra a página Usage).`} />
              <Numero rotulo="Requisições (24 h)" fonte={o?.supabase?.req24h ? 'supabase' : 'estimado'}
                valor={o?.supabase?.req24h ? n0(o.supabase.req24h.total) : `${n0(m.reqPorMin)}/min`}
                nota={o?.supabase?.req24h ? undefined : `${m.reqReferenciaMesmoHorario ? 'normal deste horário' : 'média geral'} ${n0(m.reqMediaPorMin)}/min`}
                info="Quantas vezes o app e as lojas pediram dados ao banco. Subida brusca sem mais pedidos = possível loop (tela ou rotina pedindo dados sem parar)." />
              <Numero rotulo="Banco de dados" fonte={o?.prom ? 'supabase' : 'exato'} valor={gb(o?.prom?.dbBytes ?? m.dbBytes)} nota={`limite ${PLANO_PRO.discoGb} GB`}
                info="Tamanho das tabelas (pedidos, clientes, cardápios). Cresce devagar; as tabelas de registro são limpas sozinhas (retenção)." />
              <Numero rotulo="Storage (fotos)" fonte="exato" valor={gb(m.storageBytes)} nota={`limite ${PLANO_PRO.storageGb} GB`}
                info="Arquivos guardados: fotos dos itens, logos, capas e vídeos das lojas." />
              <Numero rotulo="CPU do banco" fonte={o?.prom ? 'supabase' : undefined} valor={pct(o?.prom?.cpuPct)}
                info="Quanto o processador do servidor do banco está trabalhando. Acima de 80% por muito tempo deixa tudo lento." />
              <Numero rotulo="Memória livre (banco)" fonte={o?.prom ? 'supabase' : undefined} valor={o?.prom?.memTotal ? pct((o.prom.memDisp / o.prom.memTotal) * 100) : '—'}
                info="Memória que ainda sobra no servidor do banco. Pouca memória livre = consultas mais lentas." />
              <Numero rotulo="Disco do banco" fonte={o?.prom ? 'supabase' : undefined}
                valor={o?.prom?.discoTotal ? `${Math.round((o.prom.discoTotal - o.prom.discoLivre) / 1e8) / 10} GB` : '—'}
                barra={o?.prom?.discoTotal ? <Barra chamadas={Math.round((o.prom.discoTotal - o.prom.discoLivre) / 1e8) / 10} limite={Math.round(o.prom.discoTotal / 1e8) / 10} compacta /> : undefined}
                nota={o?.prom?.discoTotal ? `de ${Math.round(o.prom.discoTotal / 1e8) / 10} GB` : undefined}
                info="Espaço em disco do servidor do banco (dados + índices + registros internos). O Supabase aumenta sozinho quando enche." />
              <Numero rotulo="Disk IO" fonte={o?.prom ? 'supabase' : undefined} valor={o?.prom?.iops == null ? '—' : `${o.prom.iops} op/s`}
                nota={o?.prom?.ioMBs == null ? undefined : `${o.prom.ioMBs} MB/s`}
                info="Leituras e gravações por segundo no disco do banco. O plano tem um teto; passar dele deixa as consultas em fila." />
            </div>
            {o?.supabase?.req24h && (
              <PainelHp className="p-[12px] sm:p-[16px]">
                <ul>
                  <Linha rotulo="PostgREST (dados do banco)" valor={n0(o.supabase.req24h.rest)} />
                  <Linha rotulo="Auth (login e sessão)" valor={n0(o.supabase.req24h.auth)} />
                  <Linha rotulo="Storage (fotos)" valor={n0(o.supabase.req24h.storage)} />
                  <Linha rotulo="Realtime (pedidos ao vivo)" valor={n0(o.supabase.req24h.realtime)} />
                </ul>
              </PainelHp>
            )}
          </Grupo>

          <Grupo titulo="VPS · servidor do app" sub={`Hostinger · onde roda o site e o painel · ${ha(hostinger?.amostraEm ?? hostinger?.em ?? m.em)}`}
            info="A VPS é o computador alugado na Hostinger que roda o Menuzia (vitrine, painel, rotinas). Se CPU, memória ou disco enchem, o site fica lento ou cai — os dados continuam salvos no Supabase.">
            <div className={grade}>
              <Numero rotulo="Uso da CPU" fonte={hostinger ? 'hostinger' : 'servidor'} valor={pct(hostinger ? hostinger.cpuPct : m.cpuPct)}
                info="Quanto o processador da VPS está trabalhando. Picos curtos são normais (deploy, horário de pedidos)." />
              <Numero rotulo={hostinger ? 'Memória em uso' : 'Memória livre'} fonte={hostinger ? 'hostinger' : 'servidor'}
                valor={hostinger ? gb(hostinger.ramBytes, 1) : pct(m.memLivrePct)} nota={hostinger?.ramTotal ? `de ${gb(hostinger.ramTotal, 1)}` : undefined}
                info="Memória RAM da VPS. Se acabar, o sistema trava (aconteceu em 23/10 antes do swap)." />
              <Numero rotulo="Disco" fonte={hostinger ? 'hostinger' : 'servidor'}
                valor={hostinger ? gb(hostinger.discoBytes, 1) : pct(m.discoUsadoPct)}
                barra={!hostinger && m.discoUsadoPct != null ? <Barra chamadas={Math.round(m.discoUsadoPct)} limite={100} compacta /> : undefined}
                nota={hostinger?.discoTotal ? `de ${gb(hostinger.discoTotal, 0)}` : undefined}
                info="Espaço em disco da VPS (programas, imagens Docker, registros). A limpeza automática das imagens antigas roda de madrugada." />
              <Numero rotulo="Rede (saída / entrada)" fonte={hostinger ? 'hostinger' : undefined}
                valor={hostinger ? gb(hostinger.saidaBytes) : '—'} nota={hostinger ? `entrada ${gb(hostinger.entradaBytes)}` : 'aparece com HOSTINGER_API_TOKEN'}
                info="Tráfego da VPS com a internet. Não é cobrado à parte, mas um salto pode indicar robô ou loop." />
            </div>
          </Grupo>
        </>
      )}

      <div className="grid gap-[20px] lg:grid-cols-3">
        <Grupo titulo="APIs pagas hoje" info="Chamadas de hoje às APIs que custam dinheiro (Google Maps, IA). Cada uma tem um teto diário: chegando nele, o sistema para de chamar até o dia seguinte.">
          <PainelHp className="p-[12px] sm:p-[16px]">
            {m && m.apis.length === 0 && !m.iaUsd && <p className="text-[14px] text-[#58585E]">Nenhuma chamada hoje.</p>}
            <ul>
              {m?.apis.map((a) => <Linha key={a.api} rotulo={a.api} valor={<span className="block w-[130px]"><Barra chamadas={a.chamadas} limite={a.limite} compacta /></span>} />)}
              {m?.iaUsd && <Linha rotulo="IA (US$ hoje)" valor={`${m.iaUsd.gasto.toFixed(2)} / ${m.iaUsd.teto.toFixed(2)}`} />}
            </ul>
          </PainelHp>
        </Grupo>

        <Grupo id="rotinas" titulo="Rotinas automáticas" info="Tarefas que o servidor roda sozinho de tempos em tempos (despacho de entregas, Pix, vigia, limpezas). Aqui aparece a última vez que cada uma rodou; em vermelho = atrasada (parou de rodar).">
          <PainelHp className="p-[12px] sm:p-[16px]">
            {listaCrons.length === 0 && <p className="text-[14px] text-[#58585E]">Nenhuma batida registrada ainda.</p>}
            <ul>
              {listaCrons.map((c) => {
                const min = Math.floor((Date.now() - Date.parse(c.ultima_em)) / 60_000)
                const atrasado = min > Math.max(10, (CRONS[c.nome] ?? 1) * 3)
                return <Linha key={c.nome} rotulo={c.nome} valor={<span className={atrasado ? 'text-[#B3122D]' : 'font-normal text-[#58585E]'}>{atrasado ? 'atrasada · ' : ''}{min <= 0 ? 'agora' : `há ${n0(min)} min`}</span>} />
              })}
            </ul>
          </PainelHp>
        </Grupo>

        <Grupo id="whatsapp" titulo="WhatsApp das lojas" info="Lojas cujo WhatsApp caiu sozinho estando em uso. Loja que desconectou por vontade própria não entra aqui nem gera alerta: fica desconectada até o dono reconectar em Integrações.">
          <PainelHp className="p-[12px] sm:p-[16px]">
            {m && m.whatsappCaido.length === 0 && <p className="text-[14px] text-[#58585E]">Nenhuma loja com o WhatsApp caído.</p>}
            <ul>{m?.whatsappCaido.map((w) => <Linha key={w.loja} rotulo={w.loja} valor={<span className="text-[#B3122D]">fora há {n0(w.minutos)} min</span>} />)}</ul>
          </PainelHp>
        </Grupo>
      </div>

      {o?.erros && (
        <p className="rounded-[16px] border-[0.8px] border-[rgba(138,97,0,0.25)] bg-[#FFF8E2] p-[12px] text-[13px] leading-[18px] text-[#8A6100]">
          Fonte com erro na última leitura: {Object.entries(o.erros).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
      )}

      <Grupo titulo="Últimos 30 dias" info="Um número por dia, para ver tendência: se as barras sobem sem aumento de pedidos, algo está pedindo dados demais.">
        <div className="grid gap-[12px] lg:grid-cols-2">
          <PainelHp className="p-[12px] sm:p-[20px]">
            <div className="mb-[8px] flex items-center gap-[2px]">
              <h3 className="text-[15px] font-semibold leading-[22px] text-[#18181A]">Requisições ao banco por dia</h3>
              <InfoHp titulo="Requisições ao banco por dia">Total diário de chamadas PostgREST (dados) ao Supabase, contado pelo vigia.</InfoHp>
            </div>
            {dias.length ? <Grafico30 titulo="Requisições PostgREST por dia" dias={dias} valor={(i) => Number(dias[i].req_postgrest)} formato={(v) => (v >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v)))} cor="#673DE6" /> : <p className="text-[14px] text-[#58585E]">A série começa em 28/10.</p>}
          </PainelHp>
          <PainelHp className="p-[12px] sm:p-[20px]">
            <div className="mb-[8px] flex items-center gap-[2px]">
              <h3 className="text-[15px] font-semibold leading-[22px] text-[#18181A]">Egress por dia</h3>
              <InfoHp titulo="Egress por dia">{temTx
                ? 'Saída de rede do servidor do banco, lida no Supabase (inclui conexões diretas e réplica; o egress cobrado só conta o que sai pela API).'
                : `Estimativa: requisições do dia × ${BYTES_EGRESS_POR_REQ} B.`}</InfoHp>
            </div>
            {dias.length ? <Grafico30 titulo="Egress por dia" dias={dias} valor={(i) => (temTx ? Number(dias[i].tx_bytes) : Number(dias[i].req_postgrest) * BYTES_EGRESS_POR_REQ) / 1e9} formato={(v) => `${v.toFixed(v < 1 ? 2 : 1)} GB`} cor="#18181A" /> : <p className="text-[14px] text-[#58585E]">A série começa em 28/10.</p>}
          </PainelHp>
        </div>
      </Grupo>

      <Grupo id="alertas" titulo="Histórico de alertas" sub="Últimos 60 avisos enviados" info="Cada alerta mostra o que aconteceu, o número que disparou e o que fazer, além de quando saiu e por onde (WhatsApp/e-mail).">
        {(alertas ?? []).length === 0
          ? <PainelHp className="p-[16px]"><p className="text-[14px] text-[#58585E]">Nenhum alerta enviado.</p></PainelHp>
          : <div className="flex flex-col gap-[10px]">{((alertas ?? []) as AlertaTela[]).map((a, i) => <DetalheAlerta key={a.id ?? i} a={a} />)}</div>}
      </Grupo>
    </ShellHp>
  )
}
