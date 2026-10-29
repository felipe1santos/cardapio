import { describe, expect, it, vi } from 'vitest'
import { batidaDevida, umaPorVez, TRAVA_MAX_MS } from './cron'

describe('umaPorVez (entregas, Pix, vigia)', () => {
  it('duas rodadas juntas: só a primeira roda', async () => {
    let solta: () => void = () => {}
    const lenta = vi.fn(() => new Promise<string>((ok) => { solta = () => ok('feito') }))
    const p1 = umaPorVez('t1', lenta)
    const p2 = await umaPorVez('t1', lenta)
    expect(p2).toEqual({ pulou: 'ainda rodando' })
    solta()
    expect(await p1).toBe('feito')
    expect(lenta).toHaveBeenCalledTimes(1)
    // Terminou: a próxima roda.
    expect(await umaPorVez('t1', async () => 'de novo')).toBe('de novo')
  })
  it('rodada que deu erro solta a trava', async () => {
    await expect(umaPorVez('t2', async () => { throw new Error('caiu') })).rejects.toThrow('caiu')
    expect(await umaPorVez('t2', async () => 'ok')).toBe('ok')
  })
  it(`rodada TRAVADA (nunca termina) solta a trava sozinha depois de ${TRAVA_MAX_MS / 60_000} min`, async () => {
    let agora = 1_000_000
    void umaPorVez('t3', () => new Promise(() => {}), () => agora)
    expect(await umaPorVez('t3', async () => 'x', () => agora + 60_000)).toEqual({ pulou: 'ainda rodando' })
    agora += TRAVA_MAX_MS + 1
    expect(await umaPorVez('t3', async () => 'liberou', () => agora)).toBe('liberou')
  })
})

describe('batida dos crons', () => {
  it('grava no máximo 1 vez a cada 5 min por cron (antes: 1 por minuto em 9 crons = 540/h)', () => {
    const m = new Map<string, number>()
    expect(batidaDevida(m, 'pix', 0)).toBe(true)
    expect(batidaDevida(m, 'pix', 60_000)).toBe(false)
    expect(batidaDevida(m, 'entregas', 60_000)).toBe(true)
    expect(batidaDevida(m, 'pix', 5 * 60_000)).toBe(true)
  })
})
