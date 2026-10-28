import { describe, expect, it } from 'vitest'
import { eventoConexaoRepetido, podeReconectarSozinho, RECONEXOES_POR_HORA } from './conexao-repetida'

describe('evento de conexão repetido (27/10: 75 mil eventos em 2 h da mesma loja)', () => {
  it('mesmo segredo, estado e motivo em 60 s é repetido; depois de 60 s, ou com outro estado, passa', () => {
    const m = new Map<string, number>()
    expect(eventoConexaoRepetido(m, 's1', { estado: 'connecting', motivo: 200 }, 1000)).toBe(false)
    expect(eventoConexaoRepetido(m, 's1', { estado: 'connecting', motivo: 200 }, 30_000)).toBe(true)
    expect(eventoConexaoRepetido(m, 's1', { estado: 'close', motivo: 440 }, 30_000)).toBe(false)
    expect(eventoConexaoRepetido(m, 's2', { estado: 'connecting', motivo: 200 }, 30_000)).toBe(false)
    expect(eventoConexaoRepetido(m, 's1', { estado: 'connecting', motivo: 200 }, 62_000)).toBe(false)
  })
})

describe('reconexão automática', () => {
  const agora = 10 * 3600_000
  it('440 (sessão aberta em outro lugar) e 401 (deslogado no celular): não reconecta — só alimentaria o pingue-pongue', () => {
    expect(podeReconectarSozinho(440, [], agora)).toBe(false)
    expect(podeReconectarSozinho(401, [], agora)).toBe(false)
    expect(podeReconectarSozinho(503, [], agora)).toBe(true)
    expect(podeReconectarSozinho(null, [], agora)).toBe(true)
  })
  it(`no máximo ${RECONEXOES_POR_HORA} por hora por loja`, () => {
    const tres = [agora - 50 * 60_000, agora - 20 * 60_000, agora - 60_000]
    expect(podeReconectarSozinho(503, tres, agora)).toBe(false)
    expect(podeReconectarSozinho(503, tres.slice(1), agora)).toBe(true)
    expect(podeReconectarSozinho(503, [agora - 2 * 3600_000, ...tres.slice(1)], agora)).toBe(true)
  })
})
