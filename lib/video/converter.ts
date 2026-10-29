import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { argsCapa, argsConversao } from '@/lib/video-vitrine'

/**
 * Conversão do vídeo da vitrine no servidor (21/10/2026). O original só existe numa pasta temporária e é apagado no
 * fim (dê certo ou não); o bucket recebe só o MP4 convertido e a capa. Um vídeo por vez no servidor (fila simples):
 * várias lojas subindo juntas não derrubam a máquina.
 */
const LIMITE_MS = 120_000
let fila: Promise<unknown> = Promise.resolve()

function rodar(args: string[]): Promise<void> {
  return new Promise((ok, falha) => {
    if (!ffmpegPath) return falha(new Error('ffmpeg indisponível'))
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let erro = ''
    p.stderr.on('data', (d) => { erro = (erro + String(d)).slice(-2000) })
    const t = setTimeout(() => p.kill('SIGKILL'), LIMITE_MS)
    p.on('error', (e) => { clearTimeout(t); falha(e) })
    p.on('close', (code) => { clearTimeout(t); if (code === 0) ok(); else falha(new Error(`ffmpeg saiu com ${code}: ${erro.trim()}`)) })
  })
}

export interface VideoConvertido { mp4: Buffer; capa: Buffer }

/** `inicio` = onde começa o trecho no original; `capa` = segundo do quadro da capa dentro do trecho (escolhidos na tela). */
export function converterVideo(original: Buffer, corte: { inicio?: number; capa?: number } = {}): Promise<VideoConvertido> {
  const tarefa = fila.then(async () => {
    const pasta = await mkdtemp(join(tmpdir(), 'menuzia-video-'))
    try {
      const entrada = join(pasta, 'original')
      const saida = join(pasta, 'video.mp4')
      const quadro = join(pasta, 'capa.jpg')
      await writeFile(entrada, original)
      await rodar(argsConversao(entrada, saida, corte.inicio ?? 0))
      // Quadro escolhido; se ele cair depois do fim (o ffmpeg sai sem gravar nada), a capa é o 1º quadro.
      await rodar(argsCapa(saida, quadro, corte.capa ?? 0)).catch(() => null)
      const jpg = await readFile(quadro).catch(async () => { await rodar(argsCapa(saida, quadro, 0)); return readFile(quadro) })
      const mp4 = await readFile(saida)
      const capa = await sharp(jpg).webp({ quality: 78 }).toBuffer()
      return { mp4, capa }
    } finally {
      await rm(pasta, { recursive: true, force: true }).catch(() => {})
    }
  })
  fila = tarefa.catch(() => {})
  return tarefa
}
