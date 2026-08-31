import { describe, expect, it } from 'vitest'
import { otimizarImagem, CACHE_CONTROL_SEGUNDOS } from './imagem'

/**
 * O jsdom não implementa canvas, então aqui o que se prova é a rede de proteção:
 * em qualquer ambiente onde a otimização não é possível, o upload segue com o
 * arquivo original em vez de quebrar. A redução de tamanho é medida em navegador
 * real (ver relatório da Fase 2).
 */

function arquivo(nome: string, tipo: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], nome, { type: tipo })
}

describe('otimizarImagem', () => {
  it('devolve o mesmo arquivo quando não é imagem (áudio de campanha)', async () => {
    const f = arquivo('audio.mp3', 'audio/mpeg')
    expect(await otimizarImagem(f, 'produto')).toBe(f)
  })

  it('não mexe em GIF — recodificar mataria a animação', async () => {
    const f = arquivo('animado.gif', 'image/gif')
    expect(await otimizarImagem(f, 'produto')).toBe(f)
  })

  it('não mexe em SVG — é vetor, não tem o que redimensionar', async () => {
    const f = arquivo('icone.svg', 'image/svg+xml')
    expect(await otimizarImagem(f, 'logo')).toBe(f)
  })

  // Os casos abaixo caem no fallback de decodificação via <img>, que o jsdom
  // nunca resolve — é exatamente o cenário que o timeout interno cobre.
  it('devolve o original quando o ambiente não decodifica a imagem (ex.: HEIC)', async () => {
    const f = arquivo('foto.heic', 'image/heic')
    expect(await otimizarImagem(f, 'produto')).toBe(f)
  }, 15_000)

  it('nunca lança: falha de decodificação vira passagem do original', async () => {
    const f = arquivo('quebrada.png', 'image/png')
    expect(await otimizarImagem(f, 'produto')).toBeInstanceOf(File)
  }, 15_000)

  it('não fica pendurado quando o ambiente não sinaliza sucesso nem erro', async () => {
    const f = arquivo('foto.jpg', 'image/jpeg')
    const inicio = Date.now()
    expect(await otimizarImagem(f, 'produto')).toBe(f)
    expect(Date.now() - inicio).toBeLessThan(12_000)
  }, 15_000)
})

describe('CACHE_CONTROL_SEGUNDOS', () => {
  it('é 1 ano em segundos, no formato que o storage-js espera (só o número)', () => {
    expect(CACHE_CONTROL_SEGUNDOS).toBe('31536000')
    expect(Number(CACHE_CONTROL_SEGUNDOS)).toBe(365 * 24 * 60 * 60)
  })
})
