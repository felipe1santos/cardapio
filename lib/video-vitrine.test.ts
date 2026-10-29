import { describe, expect, it } from 'vitest'
import { argsCapa, argsConversao, comVideo, midiasDaFicha, normalizarCorte, validarArquivoVideo, validarDuracaoVideo, VIDEO_ORIGEM_MAX_S, videoDoBanner, videoDoItem, videoNoCard } from './video-vitrine'

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

  it('ffmpeg: começa no trecho escolhido (-ss antes do -i) e comprime por qualidade com teto (teste de 28/10)', () => {
    const a = argsConversao('in', 'out', 12.5)
    expect(a.indexOf('-ss')).toBeLessThan(a.indexOf('-i'))
    expect(a[a.indexOf('-ss') + 1]).toBe('12.5')
    expect(a.slice(a.indexOf('-crf'), a.indexOf('-crf') + 2)).toEqual(['-crf', '28'])
    expect(a.slice(a.indexOf('-preset'), a.indexOf('-preset') + 2)).toEqual(['-preset', 'medium'])
    expect(a.slice(a.indexOf('-maxrate'), a.indexOf('-maxrate') + 2)).toEqual(['-maxrate', '1500k'])
    expect(argsConversao('in', 'out')).not.toContain('-ss')
  })

  it('capa: o quadro escolhido do vídeo já cortado', () => {
    const c = argsCapa('v.mp4', 'c.jpg', 3.2)
    expect(c[c.indexOf('-ss') + 1]).toBe('3.2')
    expect(c.indexOf('-ss')).toBeLessThan(c.indexOf('-i'))
  })

  it('corte e capa sempre dentro do vídeo', () => {
    expect(normalizarCorte(40, 30, 20)).toEqual({ inicio: 25, capa: 14.9 }) // trecho não passa do fim; capa antes do último quadro
    expect(normalizarCorte(8, 5, 6)).toEqual({ inicio: 0, capa: 6 }) // vídeo curto: começa do 0
    expect(normalizarCorte(8, -1, Number.NaN)).toEqual({ inicio: 0, capa: 0 })
    expect(normalizarCorte(Number.NaN, 10, 2)).toEqual({ inicio: 10, capa: 2 }) // sem duração (servidor): confia, o ffmpeg corta
  })

  it('checagem antes de enviar: duração do original', () => {
    expect(validarDuracaoVideo(90)).toBeNull()
    expect(validarDuracaoVideo(VIDEO_ORIGEM_MAX_S + 1)).toMatch(/3 min/)
    expect(validarDuracaoVideo(0.3)).toMatch(/curto/)
  })

  describe('videoNoCard (vídeo no lugar da foto na lista)', () => {
    const v = { url: 'https://x/v.mp4', capa: 'https://x/v.webp', home: false, carrossel: true, posicao: 0 }
    it('marcado "no card da página inicial": usa o vídeo', () => {
      expect(videoNoCard({ imagemUrl: 'https://x/f.jpg', video: { ...v, home: true } })).toBe(true)
    })
    it('item sem foto e com vídeo: usa o vídeo mesmo desmarcado (senão o card fica sem imagem)', () => {
      expect(videoNoCard({ imagemUrl: null, video: v })).toBe(true)
    })
    it('com foto e desmarcado: fica a foto', () => {
      expect(videoNoCard({ imagemUrl: 'https://x/f.jpg', video: v })).toBe(false)
    })
    it('sem vídeo: não', () => {
      expect(videoNoCard({ imagemUrl: null, video: null })).toBe(false)
    })
  })
})
