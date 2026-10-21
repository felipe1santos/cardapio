import { it, expect } from 'vitest'
import { readFileSync, writeFileSync } from 'node:fs'
import { converterVideo } from './converter'
it.runIf(!!process.env.VIDEO_TESTE)('converte o vídeo de celular', async () => {
  const t = Date.now()
  const r = await converterVideo(readFileSync(process.env.VIDEO_TESTE!))
  writeFileSync(process.env.VIDEO_TESTE! + '.out.mp4', r.mp4); writeFileSync(process.env.VIDEO_TESTE! + '.capa.webp', r.capa)
  console.log('ms', Date.now() - t, 'mp4', r.mp4.length, 'capa', r.capa.length)
  expect(r.mp4.length).toBeLessThan(4e6)
}, 180000)
