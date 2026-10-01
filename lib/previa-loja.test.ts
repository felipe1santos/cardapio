// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import sharp from 'sharp'
import { gerarPreviaJpeg, versaoPrevia, PREVIA_MAX_BYTES } from './previa-loja'

/** Foto "difícil" (ruído colorido) em WebP grande, como as capas que as lojas sobem. */
async function capaWebpGrande(): Promise<Buffer> {
  const w = 2400, h = 1600
  const px = Buffer.alloc(w * h * 3)
  for (let i = 0; i < px.length; i++) px[i] = (i * 2654435761) >>> 24
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).webp({ quality: 90 }).toBuffer()
}

afterEach(() => vi.unstubAllGlobals())

describe('prévia do link da vitrine (1.3)', () => {
  it('capa WebP grande vira JPEG 1200×630 abaixo de 300 KB', async () => {
    const capa = await capaWebpGrande()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(capa))))
    const out = await gerarPreviaJpeg({ nome: 'Loja', bannerUrl: 'https://x/capa.webp', logoUrl: null, cor: '#E11D48' })
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect([meta.width, meta.height]).toEqual([1200, 630])
    expect(out.length).toBeLessThanOrEqual(PREVIA_MAX_BYTES)
  }, 30000)

  it('sem capa: compõe logo + nome na cor da loja (JPEG 1200×630)', async () => {
    const logo = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer()
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(logo))))
    const out = await gerarPreviaJpeg({ nome: 'Villa <Lanches> & Cia', bannerUrl: null, logoUrl: 'https://x/logo.png', cor: '#DC2626' })
    const meta = await sharp(out).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1200, 630])
    // Canto da imagem = cor da loja.
    const { data } = await sharp(out).extract({ left: 5, top: 5, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true })
    expect(data[0]).toBeGreaterThan(180)
    expect(data[2]).toBeLessThan(90)
  }, 30000)

  it('capa que não baixa: cai na composição em vez de falhar', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 404 })))
    const out = await gerarPreviaJpeg({ nome: 'Loja', bannerUrl: 'https://x/sumiu.webp', logoUrl: null, cor: '#0688D4' })
    expect((await sharp(out).metadata()).width).toBe(1200)
  }, 30000)

  it('versão muda quando a capa muda e é estável sem mudança', () => {
    const a = { nome: 'L', bannerUrl: 'https://x/1.webp', logoUrl: null, cor: '#000' }
    expect(versaoPrevia(a)).toBe(versaoPrevia({ ...a }))
    expect(versaoPrevia(a)).not.toBe(versaoPrevia({ ...a, bannerUrl: 'https://x/2.webp' }))
  })
})
