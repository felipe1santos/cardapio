import { corDoUso, type CorUso } from '@/lib/custo/uso'
import type { SomaIa, UsoIa } from '@/lib/custo/ia'

/**
 * Contador da IA de atendimento (ChatGPT) no Super Admin (10/10/2026 — docs/REGRAS-DE-CUSTO.md): gasto de hoje
 * contra o teto diário, mês corrente, tokens, por modelo e 7 dias; por loja: IaDaLoja. Lê ia_uso_dia (0174).
 */
const COR: Record<CorUso, string> = { verde: '#10B981', amarela: '#F59E0B', vermelha: '#EF4444' }
const num = (v: number) => v.toLocaleString('pt-BR')
/** micro-dólares → "US$ 0,0123" (4 casas abaixo de 1 dólar: a IA custa frações de centavo). */
export function usd(micro: number) {
  const v = micro / 1e6
  return `US$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 })}`
}
export function brl(micro: number, cotacao: number) {
  return `R$ ${((micro / 1e6) * cotacao).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
const tokens = (s: SomaIa) => num(s.tokensEntrada + s.tokensSaida)

function BarraValor({ atual, limite, rotulo, testid }: { atual: number; limite: number; rotulo: string; testid?: string }) {
  const { pct, cor } = corDoUso(atual, limite)
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testid} data-cor={cor}>
      <div className="relative h-[8px] min-w-[56px] flex-1 overflow-hidden rounded-full bg-[#E5E7EB]" role="meter" aria-valuemin={0} aria-valuemax={limite} aria-valuenow={atual}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(pct, atual > 0 ? 3 : 0)}%`, background: COR[cor] }} />
      </div>
      <span className="whitespace-nowrap text-[12.5px] font-semibold tabular-nums text-text-main">{rotulo}</span>
    </div>
  )
}

function Caixa({ titulo, valor, sub, testid }: { titulo: string; valor: string; sub?: string; testid?: string }) {
  return (
    <div className="rounded-[4px] border border-border px-3 py-2" data-testid={testid}>
      <p className="text-[11px] uppercase text-text-subtle">{titulo}</p>
      <p className="text-[18px] font-semibold tabular-nums text-text-main">{valor}</p>
      {sub && <p className="text-[11.5px] text-text-subtle">{sub}</p>}
    </div>
  )
}

function Grafico7({ dias }: { dias: UsoIa['ultimos7'] }) {
  const W = 360, H = 110, pe = 20, topo = 6
  const max = Math.max(1, ...dias.map((d) => d.custoMicroUsd))
  const passo = W / dias.length
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Gasto da IA nos últimos 7 dias" data-testid="ia-grafico">
      <line x1={0} x2={W} y1={H - pe} y2={H - pe} stroke="#E5E7EB" />
      {dias.map((d, i) => {
        const h = ((H - pe - topo) * d.custoMicroUsd) / max
        return (
          <g key={d.dia}>
            <rect x={i * passo + passo / 2 - 9} y={H - pe - h} width={18} height={Math.max(h, d.custoMicroUsd > 0 ? 2 : 0)} rx={2} fill="#A855F7"><title>{`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)} · ${usd(d.custoMicroUsd)} · ${num(d.chamadas)} respostas`}</title></rect>
            <text x={i * passo + passo / 2} y={H - 5} textAnchor="middle" fontSize={10} fill="#6B7280">{`${d.dia.slice(8, 10)}/${d.dia.slice(5, 7)}`}</text>
          </g>
        )
      })}
    </svg>
  )
}

export function UsoIaResumo({ ia }: { ia: UsoIa }) {
  const { limites: L } = ia
  const modelos = Object.entries(ia.porModeloMes).sort((a, b) => b[1].custoMicroUsd - a[1].custoMicroUsd)
  return (
    <section className="mb-4 rounded-[6px] border border-border bg-white p-4" data-testid="uso-ia">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text-main">
          IA de atendimento (ChatGPT)
          <span className={`rounded-[3px] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase ${ia.ligada ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF3C7] text-[#92400E]'}`} data-testid="ia-status">
            {ia.ligada ? 'Ligada' : 'Ainda não ligada'}
          </span>
        </h2>
        <p className="text-[12px] text-text-subtle">Teto diário: {usd(L.usdDia * 1e6)} no sistema · {usd(L.usdDiaLoja * 1e6)} por loja · cotação R$ {L.cotacao.toLocaleString('pt-BR')}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="flex flex-col gap-3">
          <div>
            <p className="mb-1 text-[12.5px] font-semibold text-text-main">Gasto hoje</p>
            <BarraValor atual={ia.hoje.custoMicroUsd} limite={L.usdDia * 1e6} rotulo={`${usd(ia.hoje.custoMicroUsd)} / ${usd(L.usdDia * 1e6)}`} testid="ia-gasto-hoje" />
          </div>
          <div>
            <p className="mb-1 text-[12.5px] font-semibold text-text-main">Respostas hoje</p>
            <BarraValor atual={ia.hoje.chamadas} limite={L.chamadasDia} rotulo={`${num(ia.hoje.chamadas)} / ${num(L.chamadasDia)}`} testid="ia-chamadas-hoje" />
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Caixa titulo="Hoje" valor={brl(ia.hoje.custoMicroUsd, L.cotacao)} sub={`${tokens(ia.hoje)} tokens`} testid="ia-hoje" />
            <Caixa titulo="Este mês" valor={brl(ia.mes.custoMicroUsd, L.cotacao)} sub={`${usd(ia.mes.custoMicroUsd)} · ${num(ia.mes.chamadas)} respostas`} testid="ia-mes" />
            <Caixa titulo="Barradas pelo teto" valor={num(ia.bloqueadasHoje)} sub="hoje" testid="ia-bloqueadas" />
          </div>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-semibold text-text-subtle">Gasto nos últimos 7 dias</p>
          <Grafico7 dias={ia.ultimos7} />
          <p className="mb-1 mt-2 text-[12px] font-semibold text-text-subtle">Por modelo (mês)</p>
          {modelos.length ? (
            <ul className="flex flex-col gap-0.5 text-[12px]" data-testid="ia-modelos">
              {modelos.map(([m, s]) => (
                <li key={m} className="flex justify-between gap-3"><span className="truncate text-text-main">{m}</span><span className="tabular-nums text-text-subtle">{num(s.chamadas)} resp. · {tokens(s)} tokens · {usd(s.custoMicroUsd)}</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-text-subtle">Nenhum uso ainda. Quando a IA for ligada, cada resposta aparece aqui com tokens e custo.</p>
          )}
        </div>
      </div>
    </section>
  )
}

/** IA de uma loja: gasto de hoje contra o teto da loja e total do mês. */
export function IaDaLoja({ uso, limites }: { uso: UsoIa['porLoja'][string] | undefined; limites: UsoIa['limites'] }) {
  const hoje = uso?.hoje.custoMicroUsd ?? 0
  const mes = uso?.mes ?? { chamadas: 0, custoMicroUsd: 0, tokensEntrada: 0, tokensSaida: 0 }
  const { cor } = corDoUso(hoje, limites.usdDiaLoja * 1e6)
  return (
    <div className="flex w-[150px] flex-col gap-0.5 text-[11.5px]" data-testid="ia-loja" data-cor={cor}>
      <span className="tabular-nums text-text-main"><span className="font-semibold uppercase text-text-subtle">Hoje </span>{usd(hoje)}</span>
      <span className="tabular-nums text-text-main"><span className="font-semibold uppercase text-text-subtle">Mês </span>{brl(mes.custoMicroUsd, limites.cotacao)}</span>
      <span className="tabular-nums text-text-subtle">{num(mes.chamadas)} respostas</span>
    </div>
  )
}
