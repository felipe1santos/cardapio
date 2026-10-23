'use client'

/**
 * Carrossel das fotos do item na ficha (tela de adicionais) — Bloco 1, 10/10/2026, só com "Novidades em teste" (0178).
 * Deslizar nativo (scroll-snap) no celular, setas no computador e bolinhas. A 1ª foto carrega na hora (é o conteúdo
 * principal da ficha); as outras só quando chegam perto (loading="lazy"). Com 1 foto a ficha usa a imagem de sempre.
 * Vídeo (0213): entra na posição escolhida pela loja e só toca quando está à vista.
 */
import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Midia } from '@/lib/video-vitrine'
import { VideoLoop } from '@/components/vitrine/video-loop'

export function FotosCarrossel({ midias, nome }: { midias: Midia[]; nome: string }) {
  const urls = midias.map((m) => m.url)
  const trilho = useRef<HTMLDivElement>(null)
  const [atual, setAtual] = useState(0)

  function aoRolar() {
    const t = trilho.current
    if (!t || !t.clientWidth) return
    const i = Math.round(t.scrollLeft / t.clientWidth)
    if (i !== atual) setAtual(i)
  }

  function irPara(i: number) {
    const t = trilho.current
    if (!t) return
    const inicio = t.scrollLeft
    const alvo = Math.max(0, Math.min(urls.length - 1, i))
    const left = alvo * t.clientWidth
    // Rolagem suave respeitando "reduzir movimento". Se ela não andar (aba sem quadros de animação), completa na hora.
    const suave = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    t.scrollTo({ left, behavior: suave ? 'smooth' : 'auto' })
    if (suave) window.setTimeout(() => { if (Math.abs(t.scrollLeft - left) > 2 && t.scrollLeft === inicio) t.scrollTo({ left }) }, 450)
    setAtual(alvo)
  }

  return (
    <div className="relative" data-testid="fotos-carrossel" aria-roledescription="carrossel" aria-label={`Fotos de ${nome}`}>
      <div
        ref={trilho}
        onScroll={aoRolar}
        className="flex h-[min(85vw,510px)] w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] lg:h-[260px] [&::-webkit-scrollbar]:hidden"
      >
        {midias.map((m, i) => m.tipo === 'video' ? (
          <VideoLoop key={m.url} url={m.url} capa={m.capa} alt={`${nome} — vídeo`} className="h-full w-full flex-shrink-0 snap-center object-cover" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={m.url}
            src={m.url}
            alt={`${nome} — foto ${i + 1} de ${urls.length}`}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
            fetchPriority={i === 0 ? 'high' : 'low'}
            className="h-full w-full flex-shrink-0 snap-center object-cover"
            draggable={false}
          />
        ))}
      </div>
      <button type="button" aria-label="Foto anterior" onClick={() => irPara(atual - 1)} disabled={atual === 0}
        className="absolute left-2 top-1/2 hidden h-[34px] w-[34px] -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#1F1F1F] shadow-md transition-opacity disabled:opacity-0 lg:flex">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button type="button" aria-label="Próxima foto" onClick={() => irPara(atual + 1)} disabled={atual === urls.length - 1}
        className="absolute right-2 top-1/2 hidden h-[34px] w-[34px] -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-[#1F1F1F] shadow-md transition-opacity disabled:opacity-0 lg:flex">
        <ChevronRight className="h-5 w-5" />
      </button>
      <div className="absolute inset-x-0 bottom-2 flex justify-center gap-[6px]" data-testid="fotos-carrossel-bolinhas">
        {urls.map((u, i) => (
          <button key={u} type="button" aria-label={`Ver foto ${i + 1}`} aria-current={i === atual ? 'true' : undefined} onClick={() => irPara(i)}
            className={`h-[8px] rounded-full transition-[width,background-color] ${i === atual ? 'w-[18px] bg-white' : 'w-[8px] bg-white/60'} shadow-[0_0_2px_rgba(0,0,0,0.4)]`} />
        ))}
      </div>
    </div>
  )
}
