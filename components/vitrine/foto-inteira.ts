'use client'

import { useCallback, useState, type SyntheticEvent } from 'react'

/**
 * Foto de embalagem (lata, garrafa, caixa) inteira no quadro (26/10/2026).
 *
 * O quadro da vitrine é quadrado e corta a foto com `object-cover` — ótimo para prato, péssimo para
 * a garrafa fotografada em pé num fundo branco, que perdia tampa e rótulo. Quando a foto tem formato
 * bem diferente do quadro E pelo menos dois cantos brancos (fundo de estúdio), ela passa a ser
 * mostrada inteira (`object-contain` sobre branco). Foto de comida continua preenchendo o quadro.
 *
 * Para ler os cantos a imagem precisa vir com CORS: só fotos do storage do Supabase (responde
 * `Access-Control-Allow-Origin: *`). URL de outro lugar (cardápio importado) segue como antes.
 * Nenhum download extra: é a mesma requisição da foto, lida num canvas de 16×16.
 */

function podeLerPixels(src: string): boolean {
  return src.includes('.supabase.co/storage/')
}

function ehFotoDeEmbalagem(img: HTMLImageElement, proporcaoQuadro: number): boolean {
  const w = img.naturalWidth
  const h = img.naturalHeight
  if (!w || !h) return false
  const r = h / w / proporcaoQuadro
  if (r < 1.2 && r > 1 / 1.2) return false
  try {
    const c = document.createElement('canvas')
    c.width = 16
    c.height = 16
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return false
    ctx.drawImage(img, 0, 0, 16, 16)
    const d = ctx.getImageData(0, 0, 16, 16).data
    const branco = (x: number, y: number) => {
      const i = (y * 16 + x) * 4
      return d[i] > 232 && d[i + 1] > 232 && d[i + 2] > 232
    }
    const cantos = [branco(0, 0), branco(15, 0), branco(0, 15), branco(15, 15)].filter(Boolean).length
    return cantos >= 2
  } catch {
    return false
  }
}

/** Props para o `<img>` e se a foto deve ir inteira. `proporcaoQuadro` = altura ÷ largura do quadro. */
export function useFotoInteira(src: string | null | undefined, proporcaoQuadro = 1) {
  const [inteira, setInteira] = useState(false)
  const avaliar = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && img.complete && img.naturalWidth) setInteira(ehFotoDeEmbalagem(img, proporcaoQuadro))
    },
    [proporcaoQuadro],
  )
  if (!src || !podeLerPixels(src)) return { inteira: false, imgProps: {} }
  return {
    inteira,
    imgProps: {
      crossOrigin: 'anonymous' as const,
      // Foto que já estava carregada antes da hidratação não dispara onLoad: o ref confere na montagem.
      ref: avaliar,
      onLoad: (e: SyntheticEvent<HTMLImageElement>) => avaliar(e.currentTarget),
    },
  }
}
