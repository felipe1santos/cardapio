'use client'

import { useEffect, useRef, useState } from 'react'
import { Clapperboard, Loader2, X } from 'lucide-react'
import { normalizarCorte, validarArquivoVideo, validarDuracaoVideo, VIDEO_DURACAO_MAX_S, type VideoArquivo } from '@/lib/video-vitrine'

/**
 * Vídeo em loop da vitrine no painel (21/10/2026): item (card da home e/ou carrossel da ficha) e banner promocional.
 * O lojista escolhe o trecho de 15 s e o quadro da capa numa linha do tempo (28/10/2026); tipo, tamanho e duração são
 * conferidos ANTES de enviar. O servidor corta, tira o som e converte (/api/midia/video). A posição conta entre as fotos.
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
  const [rascunho, setRascunho] = useState<{ arquivo: File; url: string; duracao: number } | null>(null)

  /** Escolheu o arquivo: confere tipo e tamanho, lê a duração no próprio navegador e abre a linha do tempo. */
  function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0]
    e.target.value = ''
    if (!arquivo) return
    const problema = validarArquivoVideo(arquivo)
    if (problema) { setErro(problema); return }
    setErro(null)
    const url = URL.createObjectURL(arquivo)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      const invalido = validarDuracaoVideo(v.duration)
      if (invalido) { URL.revokeObjectURL(url); setErro(invalido); return }
      setRascunho({ arquivo, url, duracao: v.duration })
    }
    v.onerror = () => { URL.revokeObjectURL(url); setErro('Não foi possível ler este vídeo. Tente MP4 ou MOV.') }
    v.src = url
  }

  function fecharRascunho() {
    if (rascunho) URL.revokeObjectURL(rascunho.url)
    setRascunho(null)
  }

  async function enviar(inicio: number, capa: number) {
    if (!rascunho) return
    const arquivo = rascunho.arquivo
    fecharRascunho()
    setEnviando(true)
    try {
      const corpo = new FormData()
      corpo.append('arquivo', arquivo)
      corpo.append('destino', destino)
      corpo.append('inicio', String(inicio))
      corpo.append('capa', String(capa))
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
            <button type="button" onClick={() => entrada.current?.click()} disabled={enviando || !!rascunho} className="self-start text-[12px] font-semibold text-[#0688D4] hover:underline disabled:opacity-50">Trocar vídeo</button>
          </div>
        </div>
      ) : !rascunho && (
        <button type="button" onClick={() => entrada.current?.click()} disabled={enviando} data-testid={`video-${destino}-adicionar`}
          className="flex items-center justify-center gap-2 rounded-[6px] border border-dashed border-[#cbd5e1] px-3 py-3 text-[12.5px] font-semibold text-[#0570AE] hover:bg-[#f0f9ff] disabled:opacity-60">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
          {enviando ? 'Enviando e convertendo… (até 1 min)' : 'Adicionar vídeo'}
        </button>
      )}
      {valor && enviando && <p className="flex items-center gap-1.5 text-[12px] text-[#6B7280]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Convertendo o vídeo novo…</p>}
      {rascunho && <EditorCorte url={rascunho.url} duracao={rascunho.duracao} destino={destino} onCancelar={fecharRascunho} onUsar={enviar} />}
      <p className="text-[11.5px] leading-[15px] text-[#6B7280]">Vídeo sem som, em loop: você escolhe o trecho de {VIDEO_DURACAO_MAX_S} s e a capa. Arquivo de até 50 MB e 3 min.</p>
      {erro && <p className="rounded-[3px] bg-[#FEE2E2] px-2 py-1.5 text-[12px] text-[#B91C1C]" data-testid={`video-${destino}-erro`}>{erro}</p>}
    </div>
  )
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Linha do tempo: arrasta o início do trecho (prévia em loop) e o quadro da capa (prévia parada). */
function EditorCorte({ url, duracao, destino, onCancelar, onUsar }: {
  url: string
  duracao: number
  destino: string
  onCancelar: () => void
  onUsar: (inicio: number, capa: number) => void
}) {
  const [inicio, setInicio] = useState(0)
  const [capa, setCapa] = useState(0)
  const previa = useRef<HTMLVideoElement>(null)
  const quadro = useRef<HTMLVideoElement>(null)
  const trecho = Math.min(VIDEO_DURACAO_MAX_S, duracao)
  const maxInicio = Math.max(0, Math.round((duracao - VIDEO_DURACAO_MAX_S) * 10) / 10)
  const corte = normalizarCorte(duracao, inicio, capa)

  // A prévia toca só o trecho escolhido, em loop.
  useEffect(() => {
    const v = previa.current
    if (!v) return
    v.currentTime = corte.inicio
    void v.play().catch(() => {})
    const voltar = () => { if (v.currentTime >= corte.inicio + trecho - 0.05 || v.currentTime < corte.inicio) v.currentTime = corte.inicio }
    v.addEventListener('timeupdate', voltar)
    return () => v.removeEventListener('timeupdate', voltar)
  }, [corte.inicio, trecho])

  useEffect(() => {
    if (quadro.current) quadro.current.currentTime = corte.inicio + corte.capa
  }, [corte.inicio, corte.capa])

  const esq = (corte.inicio / duracao) * 100
  const larg = (trecho / duracao) * 100
  return (
    <div className="flex flex-col gap-3 rounded-[6px] border border-[#e5e7eb] bg-white p-3" data-testid={`video-${destino}-editor`}>
      <div className="flex gap-3">
        <div className="flex flex-col items-center gap-1">
          <video ref={previa} src={url} muted playsInline className="h-[160px] w-[120px] rounded-[6px] bg-black object-cover" />
          <span className="text-[11px] text-[#6B7280]">Trecho</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          <video ref={quadro} src={url} muted playsInline preload="auto" className="h-[160px] w-[120px] rounded-[6px] bg-black object-cover" />
          <span className="text-[11px] text-[#6B7280]">Capa</span>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-[12.5px] text-[#1F2937]">
        <span>Começa em <b className="font-semibold tabular-nums">{fmt(corte.inicio)}</b> · usa {Math.round(trecho)} s de {fmt(duracao)}</span>
        <div className="relative h-[28px]">
          <div className="absolute inset-x-0 top-[11px] h-[6px] rounded-full bg-[#E5E7EB]" />
          <div className="absolute top-[11px] h-[6px] rounded-full bg-[#0688D4]" style={{ left: `${esq}%`, width: `${larg}%` }} />
          <input type="range" min={0} max={maxInicio} step={0.1} value={corte.inicio} disabled={maxInicio === 0}
            onChange={(e) => setInicio(Number(e.target.value))} aria-label="Início do trecho"
            className="absolute inset-0 h-[28px] w-full cursor-pointer opacity-0 disabled:cursor-default" data-testid={`video-${destino}-inicio`} />
        </div>
        {maxInicio === 0 && <span className="text-[11.5px] text-[#6B7280]">O vídeo tem até {VIDEO_DURACAO_MAX_S} s: entra inteiro.</span>}
      </label>

      <label className="flex flex-col gap-1 text-[12.5px] text-[#1F2937]">
        <span>Capa no segundo <b className="font-semibold tabular-nums">{corte.capa.toFixed(1)}</b> do trecho</span>
        <input type="range" min={0} max={Math.max(0, Math.round((trecho - 0.1) * 10) / 10)} step={0.1} value={corte.capa}
          onChange={(e) => setCapa(Number(e.target.value))} aria-label="Quadro da capa"
          className="h-[28px] w-full cursor-pointer accent-[#0688D4]" data-testid={`video-${destino}-capa`} />
      </label>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="h-[34px] rounded-[3px] border border-[#e5e7eb] px-3 text-[11px] font-semibold uppercase tracking-wide text-[#1F2937] hover:bg-[#F3F4F6]">Cancelar</button>
        <button type="button" onClick={() => onUsar(corte.inicio, corte.capa)} data-testid={`video-${destino}-usar`}
          className="h-[34px] rounded-[3px] bg-[#0688D4] px-3 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-[#0570AE]">Usar este trecho</button>
      </div>
    </div>
  )
}
