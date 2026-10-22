import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { LARGURA_PERFIL } from './imagem'
import { otimizarBuffer, PERFIS_SCRIPT } from '../scripts/imagens/otimizar.mjs'

/** O otimizador dos scripts segue as MESMAS regras do painel (lib/imagem.ts) — 22/10/2026. */
describe('otimizador de imagem dos scripts', () => {
  it('limites iguais aos do painel', () => {
    for (const [perfil, largura] of Object.entries(LARGURA_PERFIL)) {
      expect(PERFIS_SCRIPT[perfil as keyof typeof PERFIS_SCRIPT].maxLado, perfil).toBe(largura)
    }
  })

  it('PNG grande vira WebP no limite, mais leve, mantendo proporção e transparência', async () => {
    const png = await sharp({ create: { width: 2400, height: 1600, channels: 4, background: { r: 200, g: 40, b: 40, alpha: 0.5 } } }).png().toBuffer()
    const r = await otimizarBuffer(png, 'produto', 'image/png')
    expect(r.mudou).toBe(true)
    expect(r.contentType).toBe('image/webp')
    expect([r.largura, r.altura]).toEqual([1200, 800])
    expect(r.buffer.length).toBeLessThan(png.length)
    expect((await sharp(r.buffer).metadata()).hasAlpha).toBe(true)
  })

  it('nunca aumenta imagem pequena', async () => {
    const jpg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } }).jpeg({ quality: 95 }).toBuffer()
    const r = await otimizarBuffer(jpg, 'produto', 'image/jpeg')
    expect(r.largura).toBeLessThanOrEqual(300)
  })

  it('miniatura fica no limite de 400 px', async () => {
    const png = await sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#ffffff' } }).png().toBuffer()
    const r = await otimizarBuffer(png, 'thumb', 'image/png')
    expect(Math.max(r.largura, r.altura)).toBe(400)
  })
})
