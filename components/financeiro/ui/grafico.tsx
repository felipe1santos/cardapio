'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'

/**
 * Gráfico único e reaproveitável do Financeiro (Fase 6). Cores copiadas do gráfico do Gerenciador de Eventos
 * da Meta — não trocar sem pedido:
 *   série 1: linha #1877F2, área #EDF5FE → #DFF2FB      série 2: linha #32CDCD, área #EFFBFB → #CCF2F2
 *   barras #83C8C0 · meta sólida #007A80 · meta tracejada #83C8C0 · medidor alerta #D93616, trilho #EFF1F3
 *   hover: linha vertical #BABDC2 · grade #EEEEEE · texto #1C2B33 · eixos #465A69 · borda do tooltip #CBD2D9
 *   fundo #FFFFFF · coluna do hover nas barras #F2F2F2 (medida no print "Origem do evento", 2026-10-04)
 * Linhas finas, poucos valores no eixo Y, datas curtas no X ("set 5"). No hover: linha vertical cinza, pontos
 * viram bolinhas brancas com a borda da cor da série, tooltip branco com sombra (seções em negrito, quadradinho
 * da cor, valor à direita e o período no rodapé). Legenda abaixo, com quadradinho e texto em negrito.
 */
export const CORES_GRAFICO = {
  serie1: '#1877F2', area1: ['#EDF5FE', '#DFF2FB'],
  serie2: '#32CDCD', area2: ['#EFFBFB', '#CCF2F2'],
  barra: '#83C8C0', metaSolida: '#007A80', metaTracejada: '#83C8C0',
  medidorAlerta: '#D93616', trilho: '#EFF1F3',
  hover: '#BABDC2', grade: '#EEEEEE', texto: '#1C2B33', eixo: '#465A69', bordaTooltip: '#CBD2D9', fundo: '#FFFFFF',
  colunaHover: '#F2F2F2',
} as const

export interface SerieGrafico {
  nome: string
  tipo: 'linha' | 'barra'
  /** 1 ou 2 para as linhas (cor da série); barras usam sempre #83C8C0. */
  cor?: 1 | 2
  valores: (number | null)[]
  /** Seção do tooltip em que a série aparece (ex.: "Vendas", "Custos"). */
  secao?: string
}
export interface MetaGrafico { valor: number; rotulo: string; estilo: 'solida' | 'tracejada' }

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
/** "2026-09-05" → "set 5" (formato curto do eixo X). */
export function dataCurta(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split('-').map(Number)
  return `${MESES[m - 1]} ${d}`
}

/** Até 4 marcas "redondas" no eixo Y, de 0 até cobrir o máximo. */
export function marcasY(max: number, min = 0): number[] {
  const topo = Math.max(max, 1)
  const base = Math.min(min, 0)
  const passoBruto = (topo - base) / 3
  const mag = 10 ** Math.floor(Math.log10(passoBruto))
  const passo = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((p) => p >= passoBruto) ?? passoBruto
  const out: number[] = []
  for (let v = Math.floor(base / passo) * passo; v <= topo + passo * 0.001; v += passo) out.push(Math.round(v * 100) / 100)
  if (out[out.length - 1] < topo) out.push(out[out.length - 1] + passo)
  return out
}

export function GraficoFinanceiro({ rotulos, periodos, series, metas = [], formatar, formatarEixo, altura = 240, testid, rodapeTooltip }: {
  rotulos: string[]
  /** Texto do rodapé do tooltip para cada ponto (ex.: "5 a 11 de set."). Padrão: o rótulo. */
  periodos?: string[]
  series: SerieGrafico[]
  metas?: MetaGrafico[]
  formatar: (n: number) => string
  formatarEixo?: (n: number) => string
  altura?: number
  testid?: string
  /** Linha pequena no pé do tooltip (como "Fuso horário — America/Sao_Paulo" na Meta). */
  rodapeTooltip?: string
}) {
  const id = useId().replace(/:/g, '')
  const caixa = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(600)
  const [foco, setFoco] = useState<number | null>(null)
  useEffect(() => {
    const el = caixa.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Toque: o tooltip fica aberto depois de soltar o dedo e fecha ao tocar fora do gráfico.
  useEffect(() => {
    if (foco === null) return
    const fora = (e: PointerEvent) => { if (!caixa.current?.contains(e.target as Node)) setFoco(null) }
    window.addEventListener('pointerdown', fora, true)
    return () => window.removeEventListener('pointerdown', fora, true)
  }, [foco])

  const n = rotulos.length
  const todos = [...series.flatMap((s) => s.valores.filter((v): v is number => v !== null)), ...metas.map((m) => m.valor)]
  const ticks = useMemo(() => marcasY(todos.length ? Math.max(...todos) : 1, todos.length ? Math.min(...todos) : 0), [todos.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const yMin = ticks[0], yMax = ticks[ticks.length - 1]
  const esq = 56, dir = 12, topo = 10, baixo = 26
  const w = largura - esq - dir, h = altura - topo - baixo
  // Só barras (como "Origem do evento" da Meta): cada barra no centro da sua faixa — não encosta nas bordas nem
  // cobre o eixo. Com linhas: pontos de ponta a ponta, como antes.
  const bandas = series.length > 0 && series.every((s) => s.tipo === 'barra')
  const x = (i: number) => (bandas ? esq + ((i + 0.5) * w) / Math.max(1, n) : esq + (n <= 1 ? w / 2 : (i * w) / (n - 1)))
  const y = (v: number) => topo + h - ((v - yMin) / (yMax - yMin || 1)) * h
  const larguraBarra = Math.max(3, Math.min(bandas ? 56 : 28, (w / Math.max(1, n)) * (bandas ? 0.72 : 0.55)))
  const passoX = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))))
  const fmtEixo = formatarEixo ?? formatar

  function caminho(vals: (number | null)[]) {
    let d = '', abriu = false
    vals.forEach((v, i) => {
      if (v === null) { abriu = false; return }
      d += `${abriu ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      abriu = true
    })
    return d
  }
  function area(vals: (number | null)[]) {
    const pts = vals.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[]
    if (pts.length < 2) return ''
    const base = y(Math.max(yMin, 0))
    return `M${pts[0][0]},${base}` + pts.map(([a, b]) => `L${a.toFixed(1)},${b.toFixed(1)}`).join('') + `L${pts[pts.length - 1][0]},${base}Z`
  }
  function aoMover(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * largura
    const i = n <= 1 ? 0 : bandas ? Math.floor(((px - esq) / w) * n) : Math.round(((px - esq) / w) * (n - 1))
    setFoco(Math.max(0, Math.min(n - 1, i)))
  }

  const linhas = series.filter((s) => s.tipo === 'linha')
  const barras = series.filter((s) => s.tipo === 'barra')
  const secoes = [...new Set(series.map((s) => s.secao ?? ''))]
  const tipX = foco === null ? 0 : x(foco)
  const tipEsquerda = tipX > largura * 0.6
  // Só barras (como "Origem do evento"): período em negrito no TOPO do tooltip. Com linhas: no pé.
  const soBarras = barras.length > 0 && linhas.length === 0
  const passoColuna = bandas ? w / Math.max(1, n) : n <= 1 ? w : w / (n - 1)

  return (
    <div className="w-full" style={{ color: CORES_GRAFICO.texto }} data-testid={testid}>
      <div ref={caixa} className="relative w-full" style={{ background: CORES_GRAFICO.fundo }}>
        <svg width="100%" height={altura} viewBox={`0 0 ${largura} ${altura}`} preserveAspectRatio="none" role="img" aria-label={series.map((s) => s.nome).join(', ')}
          onPointerMove={aoMover} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setFoco(null) }} onPointerDown={aoMover} style={{ touchAction: 'pan-y', display: 'block' }}>
          <defs>
            <linearGradient id={`${id}-a1`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CORES_GRAFICO.area1[0]} /><stop offset="100%" stopColor={CORES_GRAFICO.area1[1]} /></linearGradient>
            <linearGradient id={`${id}-a2`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CORES_GRAFICO.area2[0]} /><stop offset="100%" stopColor={CORES_GRAFICO.area2[1]} /></linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={esq} x2={largura - dir} y1={y(t)} y2={y(t)} stroke={CORES_GRAFICO.grade} strokeWidth={1} />
              <text x={esq - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={CORES_GRAFICO.eixo}>{fmtEixo(t)}</text>
            </g>
          ))}
          {rotulos.map((r, i) => (i % passoX === 0 || i === n - 1) && (
            <text key={i} x={x(i)} y={altura - 8} textAnchor={bandas ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fontSize={11} fill={CORES_GRAFICO.eixo}>{r}</text>
          ))}
          {foco !== null && barras.length > 0 && (
            <rect data-coluna-hover x={tipX - Math.max(larguraBarra, passoColuna * 0.8) / 2} y={topo} width={Math.max(larguraBarra, passoColuna * 0.8)} height={h} fill={CORES_GRAFICO.colunaHover} />
          )}
          {barras.map((s) => s.valores.map((v, i) => v === null ? null : (
            <rect key={`${s.nome}-${i}`} x={x(i) - larguraBarra / 2} y={Math.min(y(v), y(Math.max(yMin, 0)))} width={larguraBarra} height={Math.abs(y(Math.max(yMin, 0)) - y(v))} fill={CORES_GRAFICO.barra} />
          )))}
          {linhas.map((s) => <path key={`a-${s.nome}`} d={area(s.valores)} fill={`url(#${id}-a${s.cor ?? 1})`} />)}
          {linhas.map((s) => <path key={`l-${s.nome}`} d={caminho(s.valores)} fill="none" stroke={(s.cor ?? 1) === 1 ? CORES_GRAFICO.serie1 : CORES_GRAFICO.serie2} strokeWidth={1.5} strokeLinejoin="round" />)}
          {metas.map((m) => (
            <line key={m.rotulo} x1={esq} x2={largura - dir} y1={y(m.valor)} y2={y(m.valor)} stroke={m.estilo === 'solida' ? CORES_GRAFICO.metaSolida : CORES_GRAFICO.metaTracejada}
              strokeWidth={1.5} strokeDasharray={m.estilo === 'tracejada' ? '5 4' : undefined} />
          ))}
          {foco !== null && (
            <g>
              <line x1={tipX} x2={tipX} y1={topo} y2={topo + h} stroke={CORES_GRAFICO.hover} strokeWidth={1} />
              {linhas.map((s) => s.valores[foco] === null ? null : (
                <circle key={s.nome} cx={tipX} cy={y(s.valores[foco] as number)} r={4} fill="#FFFFFF" stroke={(s.cor ?? 1) === 1 ? CORES_GRAFICO.serie1 : CORES_GRAFICO.serie2} strokeWidth={2} />
              ))}
              {metas.map((m) => (
                <circle key={`m-${m.rotulo}`} cx={tipX} cy={y(m.valor)} r={4} fill="#FFFFFF" stroke={m.estilo === 'solida' ? CORES_GRAFICO.metaSolida : CORES_GRAFICO.metaTracejada} strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {foco !== null && (
          <div className="pointer-events-none absolute top-2 z-[5] min-w-[200px] max-w-[300px] rounded-[8px] bg-white px-4 py-3 text-[13px] shadow-[0_4px_14px_rgba(28,43,51,0.18)]"
            style={{ border: `1px solid ${CORES_GRAFICO.bordaTooltip}`, color: CORES_GRAFICO.texto, ...(tipEsquerda ? { right: largura - tipX + 12 } : { left: tipX + 12 }) }} data-testid={testid ? `${testid}-tooltip` : undefined}>
            {soBarras && <p className="mb-2 text-[15px] font-bold leading-snug">{periodos?.[foco] ?? rotulos[foco]}</p>}
            {secoes.map((sec) => (
              <div key={sec} className="mb-1 last:mb-0">
                {sec && <p className="mb-0.5 font-bold">{sec}</p>}
                {series.filter((s) => (s.secao ?? '') === sec).map((s) => (
                  <p key={s.nome} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5"><Quadradinho s={s} />{s.nome}</span>
                    <b>{s.valores[foco] === null ? '—' : formatar(s.valores[foco] as number)}</b>
                  </p>
                ))}
              </div>
            ))}
            {metas.map((m) => <p key={m.rotulo} className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-[10px]" style={{ background: m.estilo === 'solida' ? CORES_GRAFICO.metaSolida : CORES_GRAFICO.metaTracejada }} />{m.rotulo}</span><b>{formatar(m.valor)}</b></p>)}
            {!soBarras && <p className="mt-2 border-t pt-2 text-[12px]" style={{ borderColor: CORES_GRAFICO.grade, color: CORES_GRAFICO.eixo }}>{periodos?.[foco] ?? rotulos[foco]}</p>}
            {rodapeTooltip && <p className="mt-2 text-[11.5px]" style={{ color: CORES_GRAFICO.eixo }}>{rodapeTooltip}</p>}
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] font-bold" data-testid={testid ? `${testid}-legenda` : undefined}>
        {series.map((s) => <span key={s.nome} className="flex items-center gap-1.5"><Quadradinho s={s} />{s.nome}</span>)}
        {metas.map((m) => <span key={m.rotulo} className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-[12px]" style={{ background: m.estilo === 'solida' ? CORES_GRAFICO.metaSolida : CORES_GRAFICO.metaTracejada }} />{m.rotulo}</span>)}
      </div>
    </div>
  )
}

function Quadradinho({ s }: { s: SerieGrafico }) {
  const cor = s.tipo === 'barra' ? CORES_GRAFICO.barra : (s.cor ?? 1) === 1 ? CORES_GRAFICO.serie1 : CORES_GRAFICO.serie2
  return <span className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: cor }} />
}

/**
 * Medidor circular (cópia do "19%" da Meta): anel #EFF1F3, arco a partir do topo no sentido horário —
 * #D93616 em alerta, #1877F2 quando está bem —, % grande no centro e a meta embaixo ("Meta >= 75%").
 */
export function Medidor({ valor, alerta, rotulo, texto, testid, tamanho = 132 }: { valor: number; alerta: boolean; rotulo: string; texto: string; testid?: string; tamanho?: number }) {
  const v = Math.max(0, Math.min(100, valor))
  const esp = Math.round(tamanho * 0.078)
  const r = (tamanho - esp) / 2, c = tamanho / 2
  const circ = 2 * Math.PI * r
  return (
    <div className="flex flex-col items-center" style={{ color: CORES_GRAFICO.texto }} data-testid={testid}>
      <div className="relative" style={{ width: tamanho, height: tamanho }}>
        <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} aria-label={`${rotulo}: ${texto}`} role="img">
          <circle cx={c} cy={c} r={r} fill="none" stroke={CORES_GRAFICO.trilho} strokeWidth={esp} />
          {v > 0 && <circle cx={c} cy={c} r={r} fill="none" stroke={alerta ? CORES_GRAFICO.medidorAlerta : CORES_GRAFICO.serie1} strokeWidth={esp}
            strokeDasharray={`${(v / 100) * circ} ${circ}`} transform={`rotate(-90 ${c} ${c})`} />}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-normal" style={{ fontSize: Math.round(tamanho * 0.24), color: CORES_GRAFICO.texto }} data-medidor-texto>{texto}</span>
      </div>
      <span className="mt-2 text-[13px] font-semibold">{rotulo}</span>
    </div>
  )
}
