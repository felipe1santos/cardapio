import { getAdminSupabase } from '@/lib/supabase/admin'
import { avaliar, CRONS, type Medidas } from '@/lib/saude/avaliar'
import { Barra } from '@/components/superadmin/uso-apis'

export const dynamic = 'force-dynamic'

/**
 * Super Admin › Saúde do sistema (28/10/2026, Etapa 7 da varredura). Só leitura: a última foto do vigia (lib/saude/vigia.ts),
 * os crons e o histórico de alertas. O layout de /superadmin já barra quem não é superadmin.
 */
const n0 = (v: number | null | undefined) => (v == null ? '—' : Math.round(v).toLocaleString('pt-BR'))
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const COR_NIVEL: Record<string, string> = { vermelho: 'bg-[#FEE2E2] text-[#B91C1C]', amarelo: 'bg-[#FEF3C7] text-[#92400E]', resumo: 'bg-[#E0F2FE] text-[#0369A1]', teste: 'bg-[#E5E7EB] text-[#1F2937]' }

function Cartao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[4px] border border-border bg-white p-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text-subtle">{titulo}</h2>
      {children}
    </section>
  )
}

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-[13px] last:border-0">
      <span className="text-text-subtle">{rotulo}</span>
      <span className="min-w-0 text-right font-semibold tabular-nums text-text-main">{valor}</span>
    </div>
  )
}

export default async function SaudePage() {
  const admin = getAdminSupabase()
  const [{ data: foto }, { data: alertas }, { data: crons }] = await Promise.all([
    admin.from('sistema_saude_fotos').select('em, dados').order('em', { ascending: false }).limit(1).maybeSingle(),
    admin.from('sistema_alertas').select('id, criado_em, assunto, nivel, texto, canal, enviado, erro').order('criado_em', { ascending: false }).limit(60),
    admin.from('sistema_cron_batidas').select('nome, ultima_em').order('nome'),
  ])
  const m = (foto?.dados ?? null) as Medidas | null
  const ativos = m ? avaliar(m) : []
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
        <div className="grid gap-3 md:grid-cols-3">
          <Cartao titulo="Banco (Supabase)">
            <Linha rotulo="Requisições agora" valor={`${n0(m.reqPorMin)}/min`} />
            <Linha rotulo="Média 7 dias" valor={`${n0(m.reqMediaPorMin)}/min`} />
            <Linha rotulo="Egress projetado no mês" valor={m.egressMesGb == null ? '—' : <Barra chamadas={Math.round(m.egressMesGb)} limite={m.egressCotaGb} compacta />} />
            <Linha rotulo="Tamanho do banco" valor={m.dbBytes == null ? '—' : `${(m.dbBytes / 1e9).toFixed(2)} / ${(m.dbCotaBytes / 1e9).toFixed(0)} GB`} />
          </Cartao>
          <Cartao titulo="VPS">
            <Linha rotulo="Processador (carga ÷ núcleos)" valor={m.cpuCarga == null ? '—' : `${m.cpuCarga.toFixed(2)}×`} />
            <Linha rotulo="Memória livre" valor={m.memLivrePct == null ? '—' : `${Math.round(m.memLivrePct)}%`} />
            <Linha rotulo="Disco usado" valor={m.discoUsadoPct == null ? '—' : <Barra chamadas={Math.round(m.discoUsadoPct)} limite={100} compacta />} />
          </Cartao>
          <Cartao titulo="APIs pagas hoje">
            {m.apis.length === 0 && <p className="text-[13px] text-text-subtle">Nenhuma chamada hoje.</p>}
            {m.apis.map((a) => <Linha key={a.api} rotulo={a.api} valor={<Barra chamadas={a.chamadas} limite={a.limite} compacta />} />)}
            {m.iaUsd && <Linha rotulo="IA (US$)" valor={`${m.iaUsd.gasto.toFixed(2)} / ${m.iaUsd.teto.toFixed(2)}`} />}
          </Cartao>
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Cartao titulo="Rotinas automáticas (crons)">
          {(crons ?? []).length === 0 && <p className="text-[13px] text-text-subtle">Nenhuma batida registrada ainda.</p>}
          {((crons ?? []) as { nome: string; ultima_em: string }[]).map((c) => {
            const min = Math.floor((Date.now() - Date.parse(c.ultima_em)) / 60_000)
            const atrasado = min > Math.max(10, (CRONS[c.nome] ?? 1) * 3)
            return <Linha key={c.nome} rotulo={c.nome} valor={<span className={atrasado ? 'text-[#B91C1C]' : ''}>{min <= 0 ? 'agora' : `há ${n0(min)} min`}</span>} />
          })}
        </Cartao>
        <Cartao titulo="WhatsApp das lojas">
          {m && m.whatsappCaido.length === 0 && <p className="text-[13px] text-text-subtle">Nenhuma loja com o WhatsApp caído.</p>}
          {m?.whatsappCaido.map((w) => <Linha key={w.loja} rotulo={w.loja} valor={`fora há ${n0(w.minutos)} min`} />)}
        </Cartao>
      </div>

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
