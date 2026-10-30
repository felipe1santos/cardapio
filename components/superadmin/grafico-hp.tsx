/**
 * Gráfico de barras do Super Admin (30/10/2026), por dia (a coluna de hoje vem escrita "Hoje") ou por hora.
 * Feito em HTML (não SVG com viewBox) para o texto ter o mesmo tamanho no celular e no computador. Passar o mouse, tocar
 * ou focar um dia mostra os valores (só CSS, sem estado: serve em página de servidor e em componente de cliente).
 */
export interface SerieHp { nome: string; cor: string; valores: number[] }

const dataBR = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })

export function GraficoDiasHp({ rotulo, dias, series, formato, altura = 160, testid, rotuloDe, visivel }: {
  rotulo: string
  /** Dias "AAAA-MM-DD", do mais antigo para o mais novo (ou outras colunas, com `rotuloDe`). */
  dias: string[]
  series: SerieHp[]
  formato: (v: number) => string
  altura?: number
  testid?: string
  /** Texto de cada coluna quando não é data (ex.: horas). */
  rotuloDe?: (coluna: string) => string
  /** Quais colunas mostram o texto embaixo. */
  visivel?: (i: number) => boolean
}) {
  const pico = Math.max(0, ...series.flatMap((s) => s.valores))
  if (!dias.length || pico <= 0) {
    return <p className="flex min-h-[96px] items-center justify-center rounded-[12px] bg-[#F5F5F6] px-[12px] text-center text-[13px] leading-[18px] text-[#58585E]" data-testid={testid}>Sem uso neste período.</p>
  }
  const hoje = hojeSP()
  const nome = (d: string) => (rotuloDe ? rotuloDe(d) : d === hoje ? 'Hoje' : dataBR(d))
  const y = (v: number) => (v / pico) * 100
  const comRotulo = (i: number) => (visivel ? visivel(i) : dias.length <= 10 || i === 0 || i === dias.length - 1 || dias[i] === hoje || (i % 7 === 0 && dias.length - 1 - i >= 4))
  return (
    <figure className="m-0 min-w-0" aria-label={rotulo} data-testid={testid}>
      <div className="flex gap-[6px] pt-[8px]">
        <div className="relative w-[52px] flex-shrink-0 text-right text-[11px] leading-[14px] tabular-nums text-[#58585E]" style={{ height: altura }} aria-hidden>
          <span className="absolute right-0 top-0 -translate-y-1/2 whitespace-nowrap">{formato(pico)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2 whitespace-nowrap">{formato(pico / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
        </div>
        <div className="relative min-w-0 flex-1" style={{ height: altura }}>
          <span className="absolute inset-x-0 top-0 h-px bg-[rgba(0,0,0,0.08)]" aria-hidden />
          <span className="absolute inset-x-0 top-1/2 h-px bg-[rgba(0,0,0,0.08)]" aria-hidden />
          <span className="absolute inset-x-0 bottom-0 h-px bg-[rgba(0,0,0,0.12)]" aria-hidden />
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {dias.map((d, i) => {
              const lado = i < dias.length / 3 ? 'left-0' : i >= (dias.length * 2) / 3 ? 'right-0' : 'left-1/2 -translate-x-1/2'
              const resumo = series.map((s) => `${s.nome}: ${formato(s.valores[i] ?? 0)}`).join(', ')
              return (
                <div key={d} tabIndex={0} aria-label={`${nome(d)}. ${resumo}`}
                  className="group relative flex h-full min-w-0 flex-1 cursor-default items-end justify-center gap-[1px] rounded-[3px] outline-none hover:bg-[rgba(103,61,230,0.06)] focus:bg-[rgba(103,61,230,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#673DE6]">
                  {series.map((s) => (
                    <span key={s.nome} className="min-w-[2px] max-w-[22px] flex-1 rounded-t-[3px]" style={{ height: `${s.valores[i] > 0 ? Math.max(y(s.valores[i]), 1.5) : 0}%`, background: s.cor }} aria-hidden />
                  ))}
                  <span role="tooltip" className={`pointer-events-none absolute top-[4px] z-20 hidden w-max max-w-[200px] rounded-[8px] bg-[#18181A] px-[8px] py-[6px] text-left text-[12px] leading-[16px] text-white shadow-[0_8px_20px_rgba(24,24,26,0.25)] group-hover:block group-focus:block ${lado}`}>
                    <span className="block font-semibold">{nome(d)}</span>
                    {series.map((s) => <span key={s.nome} className="block whitespace-nowrap tabular-nums">{series.length > 1 ? `${s.nome}: ` : ''}{formato(s.valores[i] ?? 0)}</span>)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="mt-[6px] flex gap-[6px]" aria-hidden>
        <div className="w-[52px] flex-shrink-0" />
        <div className="flex min-w-0 flex-1 gap-[2px]">
          {dias.map((d, i) => (
            <span key={d} className={`relative h-[16px] min-w-0 flex-1 text-[11px] leading-[16px] ${d === hoje ? 'font-semibold text-[#18181A]' : 'text-[#58585E]'}`}>
              {comRotulo(i) && <span className={`absolute top-0 whitespace-nowrap ${i === 0 && dias.length > 10 ? 'left-0' : i === dias.length - 1 && dias.length > 10 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>{nome(d)}</span>}
            </span>
          ))}
        </div>
      </div>
      {series.length > 1 && (
        <div className="mt-[8px] flex flex-wrap gap-x-[12px] gap-y-[4px] text-[12px] leading-[16px] text-[#58585E]">
          {series.map((s) => <span key={s.nome} className="inline-flex items-center gap-[4px]"><span className="h-[8px] w-[8px] rounded-[2px]" style={{ background: s.cor }} aria-hidden />{s.nome}</span>)}
        </div>
      )}
    </figure>
  )
}
