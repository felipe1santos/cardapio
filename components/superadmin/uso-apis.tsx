import { APIS_PAINEL, corDoUso, ROTULO_API, type ApiPainel, type CorUso, type UsoApis } from '@/lib/custo/uso'

/**
 * Contador das APIs pagas (Super Admin, 10/10/2026 — docs/REGRAS-DE-CUSTO.md): resumo do dia contra o limite global,
 * chamadas bloqueadas pela guarda, alertas de disparo e os últimos 7 dias. Por loja: BarraUsoLoja.
 */
const COR: Record<CorUso, string> = { verde: '#10B981', amarela: '#F59E0B', vermelha: '#EF4444' }
const COR_API: Record<ApiPainel, string> = { geocoding: '#0688D4', directions: '#A855F7', maps_js: '#10B981' }
const num = (v: number) => v.toLocaleString('pt-BR')

export function Barra({ chamadas, limite, compacta = false, testid }: { chamadas: number; limite: number; compacta?: boolean; testid?: string }) {
  const { pct, cor } = corDoUso(chamadas, limite)
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testid} data-cor={cor}>
      <div className={`relative min-w-[56px] flex-1 overflow-hidden rounded-full bg-[#E5E7EB] ${compacta ? 'h-[6px]' : 'h-[8px]'}`} role="meter" aria-valuemin={0} aria-valuemax={limite} aria-valuenow={chamadas}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(pct, chamadas > 0 ? 3 : 0)}%`, background: COR[cor] }} />
      </div>
      <span className={`whitespace-nowrap tabular-nums text-text-main ${compacta ? 'text-[11.5px]' : 'text-[12.5px] font-semibold'}`}>{num(chamadas)} / {num(limite)}</span>
    </div>
  )
}

/** As 3 APIs de uma loja hoje, empilhadas (tabela e cartão). */
export function BarraUsoLoja({ uso, limites }: { uso: Record<ApiPainel, number> | undefined; limites: Record<ApiPainel, number> }) {
  return (
    <div className="flex w-[190px] flex-col gap-1" data-testid="uso-loja">
      {APIS_PAINEL.map((api) => (
        <div key={api} className="flex items-center gap-1.5">
          <span className="w-[54px] flex-shrink-0 truncate text-[10.5px] font-semibold uppercase text-text-subtle" title={ROTULO_API[api]}>{api === 'maps_js' ? 'Mapas' : api === 'geocoding' ? 'Geocod.' : 'Rotas'}</span>
          <Barra chamadas={uso?.[api] ?? 0} limite={limites[api]} compacta testid={`uso-loja-${api}`} />
        </div>
      ))}
    </div>
  )
}

function Grafico7Dias({ dias }: { dias: UsoApis['ultimos7'] }) {
  const W = 560, H = 150, pe = 22, esq = 34, topo = 8
  const max = Math.max(10, ...dias.flatMap((d) => APIS_PAINEL.map((a) => d[a])))
  const passo = (W - esq) / dias.length
  const larg = Math.min(14, (passo - 10) / APIS_PAINEL.length)
  const y = (v: number) => topo + (H - pe - topo) * (1 - v / max)
  const fmtDia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Chamadas por API nos últimos 7 dias" data-testid="uso-grafico">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={esq} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#E5E7EB" strokeWidth={1} />
          <text x={esq - 4} y={y(max * f) + 3} textAnchor="end" fontSize={9} fill="#6B7280">{num(Math.round(max * f))}</text>
        </g>
      ))}
      {dias.map((d, i) => (
        <g key={d.dia}>
          {APIS_PAINEL.map((a, j) => {
            const x = esq + i * passo + (passo - larg * APIS_PAINEL.length) / 2 + j * larg
            return <rect key={a} x={x} y={y(d[a])} width={Math.max(2, larg - 2)} height={H - pe - y(d[a])} rx={2} fill={COR_API[a]}><title>{`${fmtDia(d.dia)} · ${ROTULO_API[a]}: ${num(d[a])}`}</title></rect>
          })}
          <text x={esq + i * passo + passo / 2} y={H - 6} textAnchor="middle" fontSize={10} fill="#6B7280">{fmtDia(d.dia)}</text>
        </g>
      ))}
    </svg>
  )
}

export function UsoApisResumo({ uso }: { uso: UsoApis }) {
  return (
    <section className="mb-4 rounded-[6px] border border-border bg-white p-4" data-testid="uso-apis">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text-main">APIs pagas hoje</h2>
        <p className="text-[12px] text-text-subtle">Limite diário da guarda de custo · {uso.dia.split('-').reverse().join('/')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-3">
          {APIS_PAINEL.map((api) => (
            <div key={api}>
              <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-text-main"><span className="h-[9px] w-[9px] rounded-full" style={{ background: COR_API[api] }} />{ROTULO_API[api]}</p>
              <Barra chamadas={uso.total[api]} limite={uso.limites[api]} testid={`uso-total-${api}`} />
            </div>
          ))}
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="rounded-[4px] border border-border px-3 py-2" data-testid="uso-bloqueadas">
              <p className="text-[11px] uppercase text-text-subtle">Bloqueadas pela guarda</p>
              <p className={`text-[18px] font-semibold tabular-nums ${uso.bloqueadas > 0 ? 'text-[#B91C1C]' : 'text-text-main'}`}>{num(uso.bloqueadas)}</p>
            </div>
            <div className="rounded-[4px] border border-border px-3 py-2" data-testid="uso-disparos">
              <p className="text-[11px] uppercase text-text-subtle">Alertas de loop</p>
              <p className={`text-[18px] font-semibold tabular-nums ${uso.disparos > 0 ? 'text-[#B91C1C]' : 'text-text-main'}`}>{num(uso.disparos)}</p>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-semibold text-text-subtle">Últimos 7 dias</p>
          <Grafico7Dias dias={uso.ultimos7} />
          <div className="mt-1 flex flex-wrap gap-3 text-[11.5px] text-text-subtle">
            {APIS_PAINEL.map((a) => <span key={a} className="inline-flex items-center gap-1"><span className="h-[8px] w-[8px] rounded-[2px]" style={{ background: COR_API[a] }} />{ROTULO_API[a]}</span>)}
          </div>
        </div>
      </div>
    </section>
  )
}
