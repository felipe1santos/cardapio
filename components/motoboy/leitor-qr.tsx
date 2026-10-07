'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff } from 'lucide-react'

/**
 * Câmera do app do motoboy (item 59): lê o QR da comanda de entrega. Usa o leitor do próprio
 * navegador (BarcodeDetector, Chrome no Android) e, sem ele (iPhone), o jsQR carregado só aqui.
 * A câmera só abre depois que o motoboy toca em "Abrir câmera" — o pedido de permissão vem
 * explicado antes. Nada é gravado: cada quadro é lido e descartado.
 */
type Estado = 'pedir' | 'abrindo' | 'lendo' | 'negado' | 'sem-camera'
type Detector = (v: HTMLVideoElement) => Promise<string | null>

interface BarcodeDetectorLike { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> }

async function criarDetector(canvas: HTMLCanvasElement): Promise<Detector> {
  const BD = (globalThis as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): BarcodeDetectorLike; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector
  if (BD) {
    const formatos = await BD.getSupportedFormats?.().catch(() => [] as string[])
    if (!formatos || formatos.includes('qr_code')) {
      const d = new BD({ formats: ['qr_code'] })
      return async (v) => (await d.detect(v).catch(() => []))[0]?.rawValue ?? null
    }
  }
  const jsQR = (await import('jsqr')).default
  return async (v) => {
    const w = Math.min(640, v.videoWidth)
    const h = Math.round((v.videoHeight / v.videoWidth) * w)
    if (!w || !h) return null
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, w, h)
    const img = ctx.getImageData(0, 0, w, h)
    return jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null
  }
}

export function LeitorQr({ onLer, pausado }: { onLer: (texto: string) => void; pausado: boolean }) {
  const [estado, setEstado] = useState<Estado>('pedir')
  const video = useRef<HTMLVideoElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const fluxo = useRef<MediaStream | null>(null)
  const ultimo = useRef<{ t: string; em: number } | null>(null)
  const pausadoRef = useRef(pausado)
  const onLerRef = useRef(onLer)
  useEffect(() => { pausadoRef.current = pausado; onLerRef.current = onLer }, [pausado, onLer])

  const parar = useCallback(() => {
    fluxo.current?.getTracks().forEach((t) => t.stop())
    fluxo.current = null
  }, [])
  useEffect(() => parar, [parar])

  async function abrir() {
    if (!navigator.mediaDevices?.getUserMedia) { setEstado('sem-camera'); return }
    setEstado('abrindo')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      fluxo.current = s
      setEstado('lendo')
    } catch (err) {
      setEstado((err as { name?: string }).name === 'NotAllowedError' || (err as { name?: string }).name === 'SecurityError' ? 'negado' : 'sem-camera')
    }
  }

  // Com a câmera aberta: liga o vídeo e lê alguns quadros por segundo.
  useEffect(() => {
    if (estado !== 'lendo' || !video.current || !fluxo.current || !canvas.current) return
    const v = video.current
    v.srcObject = fluxo.current
    void v.play().catch(() => {})
    let vivo = true
    let detectar: Detector | null = null
    void criarDetector(canvas.current).then((d) => { detectar = d })
    const passo = async () => {
      if (!vivo) return
      if (detectar && !pausadoRef.current && v.readyState >= 2) {
        const t = await detectar(v).catch(() => null)
        const agora = Date.now()
        // O mesmo QR parado na frente da câmera não dispara de novo por alguns segundos.
        if (t && !(ultimo.current && ultimo.current.t === t && agora - ultimo.current.em < 4000)) {
          ultimo.current = { t, em: agora }
          onLerRef.current(t)
        }
      }
      if (vivo) setTimeout(() => void passo(), 220)
    }
    void passo()
    return () => { vivo = false }
  }, [estado])

  if (estado === 'lendo' || estado === 'abrindo') {
    return (
      <div className="relative overflow-hidden rounded-menuzia bg-black" data-testid="motoboy-camera">
        <video ref={video} playsInline muted className="block aspect-square w-full object-cover" />
        <canvas ref={canvas} className="hidden" />
        <div className="pointer-events-none absolute inset-[14%] rounded-menuzia border-[3px] border-white/90" />
        <p className="absolute inset-x-0 bottom-0 bg-black/60 px-3 py-2 text-center text-[13px] font-medium text-white">
          {estado === 'abrindo' ? 'Abrindo a câmera…' : pausado ? 'Leitura pausada' : 'Aponte para o QR da comanda'}
        </p>
      </div>
    )
  }
  if (estado === 'negado' || estado === 'sem-camera') {
    return (
      <div className="rounded-menuzia border border-warn/60 bg-warn-bg p-4 text-[13px] leading-relaxed text-[#92400E]" data-testid="motoboy-camera-indisponivel">
        <p className="flex items-center gap-2 font-semibold"><CameraOff className="h-5 w-5" /> {estado === 'negado' ? 'A câmera foi bloqueada' : 'Câmera indisponível'}</p>
        <p className="mt-1">
          {estado === 'negado'
            ? 'Para ler o QR, libere a câmera para este site nas configurações do navegador e toque em "Tentar de novo". Ou digite o número do pedido abaixo.'
            : 'Não deu para abrir a câmera neste celular. Digite o número do pedido abaixo.'}
        </p>
        <button type="button" onClick={() => void abrir()} className="mt-3 min-h-[44px] rounded-menuzia border border-[#92400E] px-4 text-[13px] font-semibold">Tentar de novo</button>
      </div>
    )
  }
  return (
    <div className="rounded-menuzia border border-border bg-white p-4" data-testid="motoboy-camera-pedir">
      <p className="text-[14px] font-semibold text-text-main">Ler o QR da comanda</p>
      <p className="mt-1 text-[13px] leading-relaxed text-text-subtle">
        Vamos pedir permissão para usar a câmera do celular. Ela serve só para ler o QR impresso na comanda de entrega — nada é gravado nem enviado.
      </p>
      <button type="button" onClick={() => void abrir()} data-testid="motoboy-abrir-camera"
        className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-menuzia bg-primary text-[15px] font-semibold text-white">
        <Camera className="h-5 w-5" /> Abrir câmera
      </button>
    </div>
  )
}
