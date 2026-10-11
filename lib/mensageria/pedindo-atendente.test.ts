import { describe, expect, it } from 'vitest'
import { contarResumo, estaPedindoAtendente, PEDINDO_ATENDENTE_JANELA_MS } from './atendimento'

const AGORA = new Date('2026-10-11T22:00:00Z')
const ha = (min: number) => new Date(AGORA.getTime() - min * 60_000).toISOString()

describe('cliente pedindo atendente (0182)', () => {
  it('destaca enquanto a loja não marca Resolvido (aguardando ou já respondendo)', () => {
    expect(estaPedindoAtendente({ pediu_atendente_em: ha(5), atendimento: 'aguardando' }, AGORA)).toBe(true)
    expect(estaPedindoAtendente({ pediu_atendente_em: ha(5), atendimento: 'humano' }, AGORA)).toBe(true)
  })
  it('não destaca: sem pedido, devolvida ao robô/encerrada por outro botão, ou pedido com mais de 12 h', () => {
    expect(estaPedindoAtendente({ pediu_atendente_em: null, atendimento: 'aguardando' }, AGORA)).toBe(false)
    expect(estaPedindoAtendente({ pediu_atendente_em: ha(5), atendimento: 'robo' }, AGORA)).toBe(false)
    expect(estaPedindoAtendente({ pediu_atendente_em: ha(5), atendimento: 'encerrada' }, AGORA)).toBe(false)
    expect(PEDINDO_ATENDENTE_JANELA_MS).toBe(12 * 3600_000)
    expect(estaPedindoAtendente({ pediu_atendente_em: ha(12 * 60 + 1), atendimento: 'aguardando' }, AGORA)).toBe(false)
  })
  it('selo separado: quem pede atendente conta só no selo amarelo; o vermelho fica com as outras pendências', () => {
    const r = contarResumo([
      { pediu_atendente_em: ha(1), atendimento: 'aguardando', nao_lidas: 3 },
      { pediu_atendente_em: ha(2), atendimento: 'humano', nao_lidas: 0 },
      { pediu_atendente_em: null, atendimento: 'aguardando', nao_lidas: 0 },
      { pediu_atendente_em: null, atendimento: 'humano', nao_lidas: 2 },
      { pediu_atendente_em: null, atendimento: 'humano', nao_lidas: 0 },
    ], AGORA)
    expect(r).toEqual({ pedindoAtendente: 2, aguardando: 1, naoLidas: 1 })
  })
})
