import { APIS_PAINEL, corDoUso, ROTULO_API, type ApiPainel, type CorUso, type UsoApis } from '@/lib/custo/uso'
import { GraficoDiasHp } from './grafico-hp'

/**
 * Contador das APIs pagas (Super Admin, 10/10/2026 — docs/REGRAS-DE-CUSTO.md): resumo do dia contra o limite global,
 * chamadas bloqueadas pela guarda, alertas de disparo e os últimos 7 dias. Por loja: BarraUsoLoja.
 */
const COR: Record<CorUso, string> = { verde: '#673DE6', amarela: '#FFAB00', vermelha: '#E73A47' }
// Paleta validada (dataviz): vermelho fica reservado para o pico dos gráficos.
const COR_API: Record<ApiPainel, string> = { geocoding: '#673DE6', directions: '#008361', maps_js: '#0B86C9' }
const num = (v: number) => v.toLocaleString('pt-BR')

export function Barra({ chamadas, limite, compacta = false, testid }: { chamadas: number; limite: number; compacta?: boolean; testid?: string }) {
  const { pct, cor } = corDoUso(chamadas, limite)
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testid} data-cor={cor}>
      <div className={`relative min-w-[56px] flex-1 overflow-hidden rounded-full bg-[#EBE4FF] ${compacta ? 'h-[6px]' : 'h-[8px]'}`} role="meter" aria-valuemin={0} aria-valuemax={limite} aria-valuenow={chamadas}>
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
          <span className="w-[54px] flex-shrink-0 truncate text-[10.5px] font-semibold text-text-subtle" title={ROTULO_API[api]}>{api === 'maps_js' ? 'Mapas' : api === 'geocoding' ? 'Geocod.' : 'Rotas'}</span>
          <Barra chamadas={uso?.[api] ?? 0} limite={limites[api]} compacta testid={`uso-loja-${api}`} />
        </div>
      ))}
    </div>
  )
}

export function UsoApisResumo({ uso }: { uso: UsoApis }) {
  return (
    <section className="rounded-[20px] border-[0.8px] border-[rgba(0,0,0,0.1)] bg-white p-[16px] sm:rounded-[24px] sm:p-[24px]" data-testid="uso-apis">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[16px] font-semibold leading-[24px] text-text-main">APIs pagas hoje</h2>
        <p className="text-[12px] text-text-subtle">Limite diário da guarda de custo · {uso.dia.split('-').reverse().join('/')}</p>
      </div>
      <div className="grid gap-[16px] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.7fr)]">
        <div className="flex flex-col gap-3">
          {APIS_PAINEL.map((api) => (
            <div key={api}>
              <p className="mb-1 flex items-center gap-1.5 text-[12.5px] font-semibold text-text-main"><span className="h-[9px] w-[9px] rounded-full" style={{ background: COR_API[api] }} />{ROTULO_API[api]}</p>
              <Barra chamadas={uso.total[api]} limite={uso.limites[api]} testid={`uso-total-${api}`} />
            </div>
          ))}
          <div className="mt-1 grid grid-cols-2 gap-2">
            <div className="rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.05)] px-[16px] py-[12px]" data-testid="uso-bloqueadas">
              <p className="text-[14px] leading-[20px] text-text-main">Bloqueadas pela guarda</p>
              <p className={`text-[20px] font-bold leading-[28px] tabular-nums ${uso.bloqueadas > 0 ? 'text-[#E73A47]' : 'text-text-main'}`}>{num(uso.bloqueadas)}</p>
            </div>
            <div className="rounded-[16px] border-[0.8px] border-[rgba(0,0,0,0.05)] px-[16px] py-[12px]" data-testid="uso-disparos">
              <p className="text-[14px] leading-[20px] text-text-main">Alertas de loop</p>
              <p className={`text-[20px] font-bold leading-[28px] tabular-nums ${uso.disparos > 0 ? 'text-[#E73A47]' : 'text-text-main'}`}>{num(uso.disparos)}</p>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-semibold text-text-subtle">Chamadas nos últimos 7 dias</p>
          <GraficoDiasHp rotulo="Chamadas por API nos últimos 7 dias" testid="uso-grafico" altura={190} dias={uso.ultimos7.map((d) => d.dia)} formato={(v) => num(Math.round(v))}
            series={APIS_PAINEL.map((a) => ({ nome: ROTULO_API[a], cor: COR_API[a], valores: uso.ultimos7.map((d) => d[a]) }))} />
        </div>
      </div>
    </section>
  )
}
