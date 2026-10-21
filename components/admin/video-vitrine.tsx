'use client'

import { useRef, useState } from 'react'
import { Clapperboard, Loader2, X } from 'lucide-react'
import { validarArquivoVideo, VIDEO_DURACAO_MAX_S, type VideoArquivo } from '@/lib/video-vitrine'

/**
 * Vídeo em loop da vitrine no painel (21/10/2026): item (card da home e/ou carrossel da ficha) e banner promocional.
 * Só upload: o servidor corta em 15 s, tira o som e converte (/api/midia/video). A posição conta entre as fotos/imagens.
 */
type Valor = VideoArquivo & { posicao: number; home?: boolean; carrossel?: boolean }

export function VideoDaVitrine<T extends Valor>({ valor, onChange, destino, totalImagens, rotuloPosicao }: {
  valor: T | null
  onChange: (v: T | null) => void
  destino: 'item' | 'banner'
  /** Fotos do item / imagens do banner: define as posições possíveis. */
  totalImagens: number
  rotuloPosicao: string
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    const problema = validarArquivoVideo(arquivo)
    if (problema) { setErro(problema); return }
    setErro(null)
    setEnviando(true)
    try {
      const corpo = new FormData()
      corpo.append('arquivo', arquivo)
      corpo.append('destino', destino)
      const r = await fetch('/api/midia/video', { method: 'POST', body: corpo })
      const j = (await r.json().catch(() => ({}))) as { url?: string; capa?: string; error?: string }
      if (!r.ok || !j.url || !j.capa) { setErro(j.error ?? 'Não foi possível enviar o vídeo. Tente de novo.'); return }
      const base = { url: j.url, capa: j.capa, posicao: valor?.posicao ?? totalImagens }
      onChange((destino === 'item' ? { ...base, home: valor?.home ?? false, carrossel: valor?.carrossel ?? true } : base) as T)
    } catch {
      setErro('Não foi possível enviar o vídeo. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  const posicoes = Array.from({ length: totalImagens + 1 }, (_, i) => i)
  return (
    <div className="flex flex-col gap-2" data-testid={`video-${destino}`}>
      <input ref={entrada} type="file" accept="video/*" className="hidden" onChange={escolher} data-testid={`video-${destino}-arquivo`} />
      {valor ? (
        <div className="flex gap-3">
          <div className="relative h-[120px] w-[90px] flex-shrink-0 overflow-hidden rounded-[6px] border border-[#e5e7eb] bg-black">
            <video src={valor.url} poster={valor.capa} muted loop playsInline autoPlay className="h-full w-full object-cover" data-testid={`video-${destino}-previa`} />
            <button type="button" aria-label="Remover vídeo" onClick={() => onChange(null)} data-toque-livre data-testid={`video-${destino}-remover`}
              className="absolute right-1 top-1 flex h-[24px] w-[24px] items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/75"><X className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-2 text-[12.5px] text-[var(--adm-texto,#1F2937)]">
            {destino === 'item' && (
              <>
                <label className="flex items-center gap-2"><input type="checkbox" checked={valor.home === true} onChange={(e) => onChange({ ...valor, home: e.target.checked })} data-testid="video-item-home" /> No card da página inicial (no lugar da foto)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={valor.carrossel !== false} onChange={(e) => onChange({ ...valor, carrossel: e.target.checked })} data-testid="video-item-carrossel" /> No carrossel de fotos do produto</label>
              </>
            )}
            {(destino === 'banner' || valor.carrossel !== false) && (
              <label className="flex items-center gap-2">{rotuloPosicao}
                <select value={Math.min(valor.posicao, totalImagens)} onChange={(e) => onChange({ ...valor, posicao: Number(e.target.value) })} className="h-[30px] rounded-[3px] border border-[#e5e7eb] bg-white px-1" data-testid={`video-${destino}-posicao`}>
                  {posicoes.map((p) => <option key={p} value={p}>{p + 1}º</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={() => entrada.current?.click()} disabled={enviando} className="self-start text-[12px] font-semibold text-[#0688D4] hover:underline disabled:opacity-50">Trocar vídeo</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => entrada.current?.click()} disabled={enviando} data-testid={`video-${destino}-adicionar`}
          className="flex items-center justify-center gap-2 rounded-[6px] border border-dashed border-[#cbd5e1] px-3 py-3 text-[12.5px] font-semibold text-[#0570AE] hover:bg-[#f0f9ff] disabled:opacity-60">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
          {enviando ? 'Enviando e convertendo… (até 1 min)' : 'Adicionar vídeo'}
        </button>
      )}
      {valor && enviando && <p className="flex items-center gap-1.5 text-[12px] text-[#6B7280]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Convertendo o vídeo novo…</p>}
      <p className="text-[11.5px] leading-[15px] text-[#6B7280]">Vídeo curto, sem som, em loop. Usamos até {VIDEO_DURACAO_MAX_S} s (o resto é cortado); arquivo de até 50 MB.</p>
      {erro && <p className="rounded-[3px] bg-[#FEE2E2] px-2 py-1.5 text-[12px] text-[#B91C1C]" data-testid={`video-${destino}-erro`}>{erro}</p>}
    </div>
  )
}
