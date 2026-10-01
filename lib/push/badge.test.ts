import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { BADGE_LADO, gerarBadgePng } from './badge'

async function alfa(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let opacos = 0, naoBrancos = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 0) { opacos++; if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) naoBrancos++ }
  }
  return { opacos: opacos / (info.width * info.height), naoBrancos, w: info.width, h: info.height }
}

describe('badge monocromático', () => {
  it('logo escura em fundo branco vira silhueta branca transparente', async () => {
    const logo = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } })
      .composite([{ input: Buffer.from('<svg width="200" height="200"><circle cx="100" cy="100" r="60" fill="#c0392b"/></svg>') }])
      .png().toBuffer()
    const { png, origem } = await gerarBadgePng(logo)
    const a = await alfa(png)
    expect(origem).toBe('logo')
    expect([a.w, a.h]).toEqual([BADGE_LADO, BADGE_LADO])
    expect(a.naoBrancos).toBe(0)
    expect(a.opacos).toBeGreaterThan(0.1)
    expect(a.opacos).toBeLessThan(0.5)
  })
  it('foto/quadrado cheio cai no talher neutro', async () => {
    const foto = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } })
      .composite([{ input: Buffer.from('<svg width="200" height="200"><rect x="2" y="2" width="196" height="196" fill="#333"/></svg>') }])
      .png().toBuffer()
    expect((await gerarBadgePng(foto)).origem).toBe('neutro')
  })
  it('sem logo: talher neutro, branco', async () => {
    const { png, origem } = await gerarBadgePng(null)
    const a = await alfa(png)
    expect(origem).toBe('neutro')
    expect(a.naoBrancos).toBe(0)
    expect(a.opacos).toBeGreaterThan(0.05)
  })
})
