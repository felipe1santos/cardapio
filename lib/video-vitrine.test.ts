import { describe, expect, it } from 'vitest'
import { argsConversao, comVideo, midiasDaFicha, validarArquivoVideo, videoDoBanner, videoDoItem } from './video-vitrine'

const v = { url: 'https://x/v.mp4', capa: 'https://x/c.webp' }

describe('vídeo da vitrine', () => {
  it('lê o vídeo do item com padrões seguros', () => {
    expect(videoDoItem(null)).toBeNull()
    expect(videoDoItem({ url: 'javascript:x', capa: v.capa })).toBeNull()
    expect(videoDoItem({ ...v })).toEqual({ ...v, home: false, carrossel: true, posicao: 0 })
    expect(videoDoItem({ ...v, home: true, carrossel: false, posicao: 2.7 })).toEqual({ ...v, home: true, carrossel: false, posicao: 2 })
    expect(videoDoBanner({ ...v, posicao: -1 })).toEqual({ ...v, posicao: 0 })
  })

  it('põe o vídeo na posição escolhida entre as fotos', () => {
    expect(comVideo(['a', 'b'], { ...v, posicao: 1 }).map((m) => m.url)).toEqual(['a', v.url, 'b'])
    expect(comVideo(['a', 'b'], { ...v, posicao: 0 }).map((m) => m.url)).toEqual([v.url, 'a', 'b'])
    expect(comVideo(['a'], { ...v, posicao: 9 }).map((m) => m.url)).toEqual(['a', v.url])
    expect(comVideo([], { ...v, posicao: 3 })).toEqual([{ tipo: 'video', ...v }])
  })

  it('carrossel da ficha só com o vídeo marcado para ele', () => {
    expect(midiasDaFicha(['a'], { ...v, home: true, carrossel: false, posicao: 0 })).toEqual([{ tipo: 'foto', url: 'a' }])
    expect(midiasDaFicha(['a'], { ...v, home: false, carrossel: true, posicao: 0 })).toHaveLength(2)
  })

  it('aceita só vídeo até 50 MB', () => {
    expect(validarArquivoVideo({ type: 'video/quicktime', size: 49e6 })).toBeNull()
    expect(validarArquivoVideo({ type: 'image/png', size: 10 })).toMatch(/vídeo/)
    expect(validarArquivoVideo({ type: 'video/mp4', size: 60 * 1024 * 1024 })).toMatch(/50 MB/)
  })

  it('ffmpeg: corta em 15 s, sem áudio, H.264 com faststart', () => {
    const a = argsConversao('in', 'out')
    expect(a.slice(a.indexOf('-t'), a.indexOf('-t') + 2)).toEqual(['-t', '15'])
    expect(a).toContain('-an')
    expect(a).toContain('libx264')
    expect(a).toContain('+faststart')
    expect(a.at(-1)).toBe('out')
  })
})
