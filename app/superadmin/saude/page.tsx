import { getAdminSupabase } from '@/lib/supabase/admin'
import { avaliar, CRONS, type Medidas } from '@/lib/saude/avaliar'
import { diasAteFimDoCiclo, PLANO_PRO } from '@/lib/saude/oficial'
import { BYTES_EGRESS_POR_REQ } from '@/lib/saude/vigia'
import { Barra } from '@/components/superadmin/uso-apis'

export const dynamic = 'force-dynamic'

/**
 * Super Admin › Saúde do sistema (28/10/2026). Só leitura: a última foto do vigia (lib/saude/vigia.ts), a série de 30 dias
 * (0232), os crons e o histórico de alertas. Cada card diz de onde vem o número e há quanto tempo foi lido.
 */
const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'))
const gb = (b: number | null | undefined, casas = 2) => (b == null ? '—' : `${(b / 1e9).toFixed(casas)} GB`)
const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v)}%`)
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const ha = (iso: string | null | undefined) => {
  if (!iso) return 'sem leitura'
  const min = Math.floor((Date.now() - Date.parse(iso)) / 60_000)
  return min <= 0 ? 'atualizado agora' : min < 120 ? `atualizado há ${min} min` : `atualizado há ${Math.round(min / 60)} h`
}
const COR_NIVEL: Record<string, string> = { vermelho: 'bg-[#FEE2E2] text-[#B91C1C]', amarelo: 'bg-[#FEF3C7] text-[#92400E]', resumo: 'bg-[#E0F2FE] text-[#0369A1]', teste: 'bg-[#E5E7EB] text-[#1F2937]' }

type TipoFonte = 'supabase' | 'hostinger' | 'estimado' | 'servidor' | 'exato' | 'plano'
const FONTE: Record<TipoFonte, { rotulo: string; cor: string }> = {
  supabase: { rotulo: 'Supabase oficial', cor: 'bg-[#DCFCE7] text-[#166534]' },
  hostinger: { rotulo: 'Hostinger', cor: 'bg-[#E0F2FE] text-[#0369A1]' },
  estimado: { rotulo: 'estimado pelo sistema', cor: 'bg-[#FEF3C7] text-[#92400E]' },
  servidor: { rotulo: 'medido no servidor', cor: 'bg-[#E5E7EB] text-[#1F2937]' },
  exato: { rotulo: 'calculado pelo sistema (exato)', cor: 'bg-[#E5E7EB] text-[#1F2937]' },
  plano: { rotulo: 'limite do plano Pro', cor: 'bg-[#E5E7EB] text-[#1F2937]' },
}

function Fonte({ tipo }: { tipo: TipoFonte }) {
  return <span className={`whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[10.5px] font-semibold ${FONTE[tipo].cor}`}>{FONTE[tipo].rotulo}</span>
}

function Cartao({ titulo, fonte, em, children }: { titulo: string; fonte?: TipoFonte; em?: string | null; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-[4px] border border-border bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-text-subtle">{titulo}</h2>
        {fonte && <div className="flex items-center gap-2"><Fonte tipo={fonte} /><span className="text-[11px] text-text-subtle">{ha(em)}</span></div>}
      </div>
      {children}
    </section>
  )
}

function Linha({ rotulo, valor, fonte }: { rotulo: string; valor: React.ReactNode; fonte?: TipoFonte }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-[13px] last:border-0">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-text-subtle">{rotulo}{fonte && <Fonte tipo={fonte} />}</span>
      <span className="min-w-0 text-right font-semibold tabular-nums text-text-main">{valor}</span>
    </div>
  )
}

function Grafico30({ titulo, dias, valor, formato, cor }: { titulo: string; dias: { dia: string }[]; valor: (i: number) => number; formato: (v: number) => string; cor: string }) {
  const W = 560, H = 140, pe = 20, esq = 44, topo = 8
  const vals = dias.map((_, i) => valor(i))
  const max = Math.max(1, ...vals)
  const passo = (W - esq) / Math.max(dias.length, 1)
  const y = (v: number) => topo + (H - pe - topo) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={titulo}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={esq} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#E5E7EB" strokeWidth={1} />
          <text x={esq - 4} y={y(max * f) + 3} textAnchor="end" fontSize={9} fill="#6B7280">{formato(max * f)}</text>
        </g>
      ))}
      {vals.map((v, i) => (
        <g key={dias[i].dia}>
          <rect x={esq + i * passo + 1} y={y(v)} width={Math.max(2, passo - 3)} height={Math.max(0, H - pe - y(v))} rx={1} fill={cor}><title>{`${dias[i].dia.slice(8, 10)}/${dias[i].dia.slice(5, 7)}: ${formato(v)}`}</title></rect>
          {(i === 0 || i === vals.length - 1 || i % 7 === 0) && <text x={esq + i * passo + passo / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#6B7280">{`${dias[i].dia.slice(8, 10)}/${dias[i].dia.slice(5, 7)}`}</text>}
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
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <a href="/superadmin" className="text-[12px] font-semibold text-primary">← Super Admin</a>
          <h1 className="text-[20px] font-semibold text-text-main">Saúde do sistema</h1>
          <p className="text-[12.5px] text-text-subtle">{foto ? `Última verificação: ${quando(foto.em)} (a cada 5 min)` : 'O vigia ainda não rodou.'}</p>
        </div>
        <span className={`rounded-[4px] px-3 py-1.5 text-[12px] font-semibold ${ativos.some((a) => a.nivel === 'vermelho') ? COR_NIVEL.vermelho : ativos.length ? COR_NIVEL.amarelo : 'bg-[#DCFCE7] text-[#166534]'}`}>
          {ativos.length ? `${ativos.length} ponto(s) de atenção` : 'Tudo ok'}
        </span>
      </div>

      {m && (
        <div className="grid gap-3 md:grid-cols-2">
          <Cartao titulo="Supabase — cota do ciclo (Pro)" fonte="plano" em={m.em}>
            <Linha rotulo="Dias até virar o ciclo" valor={`${diasAteFimDoCiclo(new Date(), cicloDia)} dias (vira dia ${cicloDia})`} />
            <Linha rotulo="Egress no mês (projeção)" fonte="estimado" valor={m.egressMesGb == null ? '—' : <Barra chamadas={Math.round(m.egressMesGb)} limite={PLANO_PRO.egressGb} compacta />} />
            <Linha rotulo="Storage" fonte="exato" valor={m.storageBytes == null ? '—' : `${gb(m.storageBytes)} / ${PLANO_PRO.storageGb} GB`} />
            <Linha rotulo="Banco de dados" fonte={o?.prom ? 'supabase' : 'exato'} valor={`${gb(o?.prom?.dbBytes ?? m.dbBytes)} / ${PLANO_PRO.discoGb} GB`} />
            <Linha rotulo="Log ingestion" valor={<span className="font-normal text-text-subtle">sem API — ver Usage no Supabase</span>} />
            <p className="mt-2 text-[11.5px] text-text-subtle">O Supabase não tem API do egress do ciclo: a projeção usa as requisições × 700 B (calibrado em 28/10 contra a página Usage).</p>
          </Cartao>

          <Cartao titulo="Supabase — requisições (24 h)" fonte={o?.supabase?.req24h ? 'supabase' : 'estimado'} em={o?.supabase?.em ?? m.em}>
            {o?.supabase?.req24h ? (
              <>
                <Linha rotulo="PostgREST (banco)" valor={n0(o.supabase.req24h.rest)} />
                <Linha rotulo="Auth (login/sessão)" valor={n0(o.supabase.req24h.auth)} />
                <Linha rotulo="Storage (fotos)" valor={n0(o.supabase.req24h.storage)} />
                <Linha rotulo="Realtime" valor={n0(o.supabase.req24h.realtime)} />
                <Linha rotulo="Total" valor={n0(o.supabase.req24h.total)} />
              </>
            ) : (
              <>
                <Linha rotulo="PostgREST agora" valor={`${n0(m.reqPorMin)}/min`} />
                <Linha rotulo="PostgREST (média 7 dias)" valor={`${n0(m.reqMediaPorMin)}/min ≈ ${n0((m.reqMediaPorMin ?? 0) * 1440)}/dia`} />
                <p className="mt-2 text-[11.5px] text-text-subtle">Por tipo (Auth/Storage/Realtime) aparece quando SUPABASE_ACCESS_TOKEN estiver no Coolify.</p>
              </>
            )}
          </Cartao>

          <Cartao titulo="Supabase — servidor do banco" fonte={o?.prom ? 'supabase' : undefined} em={o?.prom?.em}>
            {o?.prom ? (
              <>
                <Linha rotulo="Processador" valor={pct(o.prom.cpuPct)} />
                <Linha rotulo="Memória livre" valor={o.prom.memTotal ? pct((o.prom.memDisp / o.prom.memTotal) * 100) : '—'} />
                <Linha rotulo="Disco do banco (GB)" valor={o.prom.discoTotal ? <Barra chamadas={Math.round((o.prom.discoTotal - o.prom.discoLivre) / 1e8) / 10} limite={Math.round(o.prom.discoTotal / 1e8) / 10} compacta /> : '—'} />
                <Linha rotulo="Disk IO" valor={o.prom.iops == null ? '—' : `${o.prom.iops} op/s · ${o.prom.ioMBs} MB/s`} />
              </>
            ) : <p className="text-[13px] text-text-subtle">Sem leitura ainda (a cada 15 min).</p>}
          </Cartao>

          <Cartao titulo="VPS (app)" fonte={hostinger ? 'hostinger' : 'servidor'} em={hostinger?.amostraEm ?? hostinger?.em ?? m.em}>
            {hostinger ? (
              <>
                <Linha rotulo="Processador" valor={pct(hostinger.cpuPct)} />
                <Linha rotulo="Memória em uso" valor={hostinger.ramBytes == null ? '—' : `${gb(hostinger.ramBytes, 1)}${hostinger.ramTotal ? ` / ${gb(hostinger.ramTotal, 1)}` : ''}`} />
                <Linha rotulo="Disco" valor={hostinger.discoBytes == null ? '—' : `${gb(hostinger.discoBytes, 1)}${hostinger.discoTotal ? ` / ${gb(hostinger.discoTotal, 0)}` : ''}`} />
                <Linha rotulo="Rede (saída / entrada)" valor={`${gb(hostinger.saidaBytes)} / ${gb(hostinger.entradaBytes)}`} />
              </>
            ) : (
              <>
                <Linha rotulo="Processador" valor={pct(m.cpuPct)} />
                <Linha rotulo="Memória livre" valor={pct(m.memLivrePct)} />
                <Linha rotulo="Disco usado" valor={m.discoUsadoPct == null ? '—' : <Barra chamadas={Math.round(m.discoUsadoPct)} limite={100} compacta />} />
                <p className="mt-2 text-[11.5px] text-text-subtle">Rede e números da Hostinger aparecem quando HOSTINGER_API_TOKEN estiver no Coolify.</p>
              </>
            )}
          </Cartao>
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Cartao titulo="Requisições ao banco por dia (30 dias)" fonte="estimado" em={m?.em}>
          {dias.length ? <Grafico30 titulo="Requisições PostgREST por dia" dias={dias} valor={(i) => Number(dias[i].req_postgrest)} formato={(v) => (v >= 1000 ? `${Math.round(v / 1000)} mil` : String(Math.round(v)))} cor="#0688D4" /> : <p className="text-[13px] text-text-subtle">A série começa em 28/10.</p>}
        </Cartao>
        <Cartao titulo="Egress por dia (30 dias)" fonte={temTx ? 'supabase' : 'estimado'} em={m?.em}>
          {dias.length ? <Grafico30 titulo="Egress por dia" dias={dias} valor={(i) => (temTx ? Number(dias[i].tx_bytes) : Number(dias[i].req_postgrest) * BYTES_EGRESS_POR_REQ) / 1e9} formato={(v) => `${v.toFixed(v < 1 ? 2 : 1)} GB`} cor="#A855F7" /> : <p className="text-[13px] text-text-subtle">A série começa em 28/10.</p>}
          {temTx && <p className="mt-1 text-[11.5px] text-text-subtle">Saída de rede do servidor do banco (inclui conexões diretas e réplica; o egress cobrado só conta o que sai pela API).</p>}
        </Cartao>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Cartao titulo="APIs pagas hoje" fonte="exato" em={m?.em}>
          {m && m.apis.length === 0 && <p className="text-[13px] text-text-subtle">Nenhuma chamada hoje.</p>}
          {m?.apis.map((a) => <Linha key={a.api} rotulo={a.api} valor={<Barra chamadas={a.chamadas} limite={a.limite} compacta />} />)}
          {m?.iaUsd && <Linha rotulo="IA (US$)" valor={`${m.iaUsd.gasto.toFixed(2)} / ${m.iaUsd.teto.toFixed(2)}`} />}
        </Cartao>
        <Cartao titulo="Rotinas automáticas (crons)" fonte="servidor" em={m?.em}>
          {(crons ?? []).length === 0 && <p className="text-[13px] text-text-subtle">Nenhuma batida registrada ainda.</p>}
          {((crons ?? []) as { nome: string; ultima_em: string }[]).map((c) => {
            const min = Math.floor((Date.now() - Date.parse(c.ultima_em)) / 60_000)
            const atrasado = min > Math.max(10, (CRONS[c.nome] ?? 1) * 3)
            return <Linha key={c.nome} rotulo={c.nome} valor={<span className={atrasado ? 'text-[#B91C1C]' : ''}>{min <= 0 ? 'agora' : `há ${n0(min)} min`}</span>} />
          })}
        </Cartao>
        <Cartao titulo="WhatsApp das lojas" fonte="servidor" em={m?.em}>
          {m && m.whatsappCaido.length === 0 && <p className="text-[13px] text-text-subtle">Nenhuma loja com o WhatsApp caído.</p>}
          {m?.whatsappCaido.map((w) => <Linha key={w.loja} rotulo={w.loja} valor={`fora há ${n0(w.minutos)} min`} />)}
        </Cartao>
      </div>

      {o?.erros && (
        <p className="mt-3 rounded-[4px] border border-[#FCD34D] bg-[#FEF3C7] p-2.5 text-[12px] text-[#92400E]">
          Fonte com erro na última leitura: {Object.entries(o.erros).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
      )}

      <div className="mt-3">
        <Cartao titulo="Histórico de alertas">
          {(alertas ?? []).length === 0 && <p className="text-[13px] text-text-subtle">Nenhum alerta enviado.</p>}
          <ul className="flex flex-col gap-2">
            {((alertas ?? []) as { id: number; criado_em: string; nivel: string; texto: string; canal: string | null; enviado: boolean; erro: string | null }[]).map((a) => (
              <li key={a.id} className="rounded-[4px] border border-border p-2.5">
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[11.5px]">
                  <span className={`rounded-[3px] px-1.5 py-0.5 font-semibold uppercase ${COR_NIVEL[a.nivel] ?? COR_NIVEL.teste}`}>{a.nivel}</span>
                  <span className="text-text-subtle">{quando(a.criado_em)}</span>
                  <span className="text-text-subtle">· {a.enviado ? `enviado por ${a.canal}` : 'não entregue'}</span>
                </div>
                <p className="whitespace-pre-line text-[12.5px] text-text-main">{a.texto}</p>
                {a.erro && <p className="mt-1 text-[11.5px] text-[#B91C1C]">{a.erro}</p>}
              </li>
            ))}
          </ul>
        </Cartao>
      </div>
    </div>
  )
}
