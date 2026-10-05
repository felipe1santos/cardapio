'use client'

import { useEffect, useRef, useState } from 'react'
import { CORES_GRAFICO } from './grafico'

/**
 * Rosca no estilo do kit (item 55): fatias na paleta, legenda com quadradinho e tooltip do kit.
 * A fatia em foco SALTA para fora (mouse, toque ou teclado). Toque: a dica fica até tocar fora.
 * Teclado: Tab chega à rosca; ← → passam pelas fatias; Esc fecha.
 */
export interface FatiaRosca { id: string; rotulo: string; valor: number; cor: string; linhas: string[] }

const TAU = Math.PI * 2
function arco(cx: number, cy: number, rExt: number, rInt: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`
  const grande = a1 - a0 > Math.PI ? 1 : 0
  if (a1 - a0 >= TAU - 1e-6) {
    // fatia única: dois semicírculos (o SVG não desenha arco de 360°)
    return `M ${p(rExt, 0)} A ${rExt} ${rExt} 0 1 1 ${p(rExt, Math.PI)} A ${rExt} ${rExt} 0 1 1 ${p(rExt, TAU - 1e-4)} L ${p(rInt, TAU - 1e-4)} A ${rInt} ${rInt} 0 1 0 ${p(rInt, Math.PI)} A ${rInt} ${rInt} 0 1 0 ${p(rInt, 0)} Z`
  }
  return `M ${p(rExt, a0)} A ${rExt} ${rExt} 0 ${grande} 1 ${p(rExt, a1)} L ${p(rInt, a1)} A ${rInt} ${rInt} 0 ${grande} 0 ${p(rInt, a0)} Z`
}

export function Rosca({ fatias, centro, subcentro, testid, tamanho = 220 }: { fatias: FatiaRosca[]; centro: string; subcentro?: string; testid?: string; tamanho?: number }) {
  const [foco, setFoco] = useState<number | null>(null)
  const [estreita, setEstreita] = useState(false)
  useEffect(() => {
    const ver = () => setEstreita(window.innerWidth < 640)
    ver(); window.addEventListener('resize', ver)
    return () => window.removeEventListener('resize', ver)
  }, [])
  const raiz = useRef<HTMLDivElement>(null)
  const total = fatias.reduce((s, f) => s + Math.max(0, f.valor), 0)
  const c = tamanho / 2, rExt = c - 12, rInt = rExt * 0.62
  let ac = 0
  const geo = fatias.map((f) => {
    const a0 = ac, a1 = ac + (total ? (Math.max(0, f.valor) / total) * TAU : 0)
    ac = a1
    return { a0, a1, meio: (a0 + a1) / 2 }
  })

  // Toque/clique: a dica fica até tocar fora.
  useEffect(() => {
    if (foco === null) return
    const fora = (e: PointerEvent) => { if (!raiz.current?.contains(e.target as Node)) setFoco(null) }
    window.addEventListener('pointerdown', fora, true)
    return () => window.removeEventListener('pointerdown', fora, true)
  }, [foco])

  const atual = foco !== null ? fatias[foco] : null
  const g = foco !== null ? geo[foco] : null
  // Dica do lado de fora da fatia em foco.
  const dica = g ? { x: c + (rExt + 8) * Math.sin(g.meio), y: c - (rExt + 8) * Math.cos(g.meio) } : null

  return (
    <div ref={raiz} className="relative inline-flex flex-col items-center" data-testid={testid}>
      <div
        className="relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#1877F2]"
        tabIndex={fatias.length ? 0 : -1}
        role="group"
        aria-label={`Gráfico de rosca: ${fatias.map((f) => `${f.rotulo} ${f.linhas[0] ?? ''}`).join('; ')}. Use as setas para ver cada fatia.`}
        onKeyDown={(e) => {
          const ir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
          if (ir && fatias.length) { e.preventDefault(); setFoco((f) => (f === null ? (ir > 0 ? 0 : fatias.length - 1) : (f + ir + fatias.length) % fatias.length)) }
          else if (e.key === 'Escape') setFoco(null)
        }}
        onBlur={(e) => { if (!raiz.current?.contains(e.relatedTarget as Node)) setFoco(null) }}
      >
        <svg width={tamanho} height={tamanho} viewBox={`0 0 ${tamanho} ${tamanho}`} role="img" aria-hidden="true" style={{ touchAction: 'manipulation', overflow: 'visible' }}>
          {total === 0 && <circle cx={c} cy={c} r={(rExt + rInt) / 2} fill="none" stroke={CORES_GRAFICO.trilho} strokeWidth={rExt - rInt} />}
          {fatias.map((f, i) => {
            const { a0, a1, meio } = geo[i]
            if (a1 - a0 <= 0) return null
            const salto = foco === i ? 9 : 0
            return (
              <path
                key={f.id}
                d={arco(c, c, rExt, rInt, a0, a1)}
                fill={f.cor}
                stroke="#fff"
                strokeWidth={2}
                data-fatia={f.id}
                data-foco={foco === i ? 'sim' : 'nao'}
                style={{ transform: `translate(${(salto * Math.sin(meio)).toFixed(2)}px, ${(-salto * Math.cos(meio)).toFixed(2)}px)`, transition: 'transform 150ms ease', cursor: 'pointer', opacity: foco === null || foco === i ? 1 : 0.55 }}
                onPointerEnter={(e) => { if (e.pointerType === 'mouse') setFoco(i) }}
                onPointerLeave={(e) => { if (e.pointerType === 'mouse') setFoco(null) }}
                onPointerDown={() => setFoco(i)}
              />
            )
          })}
          <text x={c} y={c - 2} textAnchor="middle" fontSize={22} fontWeight={700} fill={CORES_GRAFICO.texto}>{centro}</text>
          {subcentro && <text x={c} y={c + 18} textAnchor="middle" fontSize={12} fill={CORES_GRAFICO.eixo}>{subcentro}</text>}
        </svg>
        {atual && dica && (
          <div
            role="tooltip"
            data-testid={testid ? `${testid}-tooltip` : undefined}
            className="pointer-events-none absolute z-[9999] min-w-[170px] rounded-[8px] bg-white px-[12px] py-[10px] text-left shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
            style={{ border: `1px solid ${CORES_GRAFICO.bordaTooltip}`, color: CORES_GRAFICO.texto, ...(estreita
              // Tela estreita (celular): embaixo da rosca, centralizada — ao lado ela sairia da tela.
              ? { left: c, top: tamanho - 6, transform: 'translate(-50%, 0)' }
              : { left: Math.min(Math.max(dica.x, 0), tamanho), top: dica.y, transform: `translate(${dica.x > c ? '8px' : 'calc(-100% - 8px)'}, -50%)` }) }}
          >
            <p className="mb-[4px] flex items-center gap-[6px] text-[14px] font-bold"><span className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: atual.cor }} />{atual.rotulo}</p>
            {atual.linhas.map((l) => <p key={l} className="text-[12.5px] leading-[18px]">{l}</p>)}
          </div>
        )}
      </div>
      <ul className="mt-[12px] flex flex-wrap justify-center gap-x-[14px] gap-y-[6px] text-[12px] font-bold" style={{ color: CORES_GRAFICO.texto }} data-testid={testid ? `${testid}-legenda` : undefined}>
        {fatias.filter((f) => f.valor > 0).map((f) => (
          <li key={f.id} className="flex items-center gap-[6px]"><span className="inline-block h-[10px] w-[10px] rounded-[2px]" style={{ background: f.cor }} />{f.rotulo}</li>
        ))}
      </ul>
    </div>
  )
}
