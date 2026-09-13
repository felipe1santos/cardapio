'use client'

import { useRef, useState } from 'react'
import { objectPosition, type Foco } from '@/lib/foco-imagem'

/**
 * Mira arrastável sobre uma imagem: o lojista marca o que NÃO pode ser cortado.
 *
 * Não sobe imagem e não salva — só emite o foco. Quem persiste é a tela que usa.
 * As molduras mostram, em cima da foto inteira, o pedaço que sobra em cada
 * proporção em que a imagem vai aparecer, porque a mesma foto é recortada
 * diferente no celular e no desktop.
 */
export function SeletorFoco({
  src,
  foco,
  onChange,
  proporcoes,
}: {
  src: string
  foco: Foco
  onChange: (f: Foco) => void
  proporcoes: { rotulo: string; ratio: number }[]
}) {
  const caixaRef = useRef<HTMLDivElement>(null)
  const [arrastando, setArrastando] = useState(false)
  // Proporção real da foto, medida no onLoad. 2 é um chute que só vale até a
  // imagem carregar; a moldura se corrige sozinha no primeiro render depois.
  const [ratioFoto, setRatioFoto] = useState(2)

  function pontoDoEvento(clientX: number, clientY: number) {
    const el = caixaRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return
    const x = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))
    const y = Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100))
    onChange({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 })
  }

  function teclado(e: React.KeyboardEvent) {
    const passo = e.shiftKey ? 10 : 1
    const mapa: Record<string, [number, number]> = {
      ArrowLeft: [-passo, 0], ArrowRight: [passo, 0], ArrowUp: [0, -passo], ArrowDown: [0, passo],
    }
    const d = mapa[e.key]
    if (!d) return
    e.preventDefault()
    onChange({
      x: Math.min(100, Math.max(0, foco.x + d[0])),
      y: Math.min(100, Math.max(0, foco.y + d[1])),
    })
  }

  return (
    <div>
      <div
        ref={caixaRef}
        className="relative w-full cursor-crosshair overflow-hidden rounded-menuzia border border-border bg-page select-none"
        onPointerDown={(e) => {
          ;(e.target as Element).setPointerCapture?.(e.pointerId)
          setArrastando(true)
          pontoDoEvento(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => { if (arrastando) pontoDoEvento(e.clientX, e.clientY) }}
        onPointerUp={() => setArrastando(false)}
        onPointerCancel={() => setArrastando(false)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="block w-full"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget
            if (img.naturalHeight > 0) setRatioFoto(img.naturalWidth / img.naturalHeight)
          }}
        />

        {/* Escurece o que fica fora do recorte mais estreito, pra dar a noção do corte. */}
        {proporcoes.map((p) => (
          <div key={p.rotulo} className="pointer-events-none absolute inset-0">
            <div
              className="absolute border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
              style={molduraStyle(p.ratio, ratioFoto, foco)}
            />
            <span className="absolute left-1 top-1 rounded-menuzia bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              {p.rotulo}
            </span>
          </div>
        ))}

        {/* A mira. Redonda de propósito: é um alvo, não um card (CLAUDE.md §3). */}
        <button
          type="button"
          aria-label="Ponto de foco da imagem"
          onKeyDown={teclado}
          className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white bg-primary/70 shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
          style={{ left: `${foco.x}%`, top: `${foco.y}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-text-subtle">
        Arraste a mira até o que não pode ser cortado. Use as setas do teclado para ajuste fino
        (Shift para passos maiores). Posição atual: {objectPosition(foco)}.
      </p>
    </div>
  )
}

/**
 * Moldura do recorte: a maior área da proporção pedida que cabe na foto,
 * centrada no foco e presa dentro das bordas — a mira nunca sai do quadro.
 *
 * Precisa da proporção REAL da foto pra acertar: uma capa 3:1 recortada em 2:1
 * perde das laterais, e a mesma capa recortada em 3,8:1 perde de cima e de
 * baixo. Sem medir a imagem, a moldura apontaria o corte errado justamente no
 * caso que o lojista está tentando resolver.
 */
function molduraStyle(ratioAlvo: number, ratioFoto: number, foco: Foco): React.CSSProperties {
  // Em fração da caixa (que tem a proporção da foto). Se o alvo é mais largo
  // que a foto, a largura satura em 100% e sobra altura; se é mais estreito,
  // o contrário.
  const larguraPct = ratioAlvo >= ratioFoto ? 100 : (ratioAlvo / ratioFoto) * 100
  const alturaPct = ratioAlvo >= ratioFoto ? (ratioFoto / ratioAlvo) * 100 : 100
  const left = Math.min(100 - larguraPct, Math.max(0, foco.x - larguraPct / 2))
  const top = Math.min(100 - alturaPct, Math.max(0, foco.y - alturaPct / 2))
  return { width: `${larguraPct}%`, height: `${alturaPct}%`, left: `${left}%`, top: `${top}%` }
}
