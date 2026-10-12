import { describe, expect, it } from 'vitest'
import { assistenteTocaAlarme, dentroDaJanelaDeAtualizacao, versaoTemAlarme } from './alarme-assistente'

describe('alarme pelo Assistente: um alarme só (12/10)', () => {
  const agora = new Date('2026-10-12T22:00:00Z')
  const ha = (s: number) => new Date(agora.getTime() - s * 1000).toISOString()
  const ag = (x: Partial<{ versao: string | null; visto_em: string | null; revogado_em: string | null }> = {}) => ({ versao: '1.2.0', visto_em: ha(5), revogado_em: null, ...x })

  it('só versões com alarme (1.2.0+); Villa 1.1.0, 1.1.2 e beta.13 tocam pelo painel', () => {
    expect(versaoTemAlarme('1.2.0')).toBe(true)
    expect(versaoTemAlarme('1.10.1')).toBe(true)
    expect(versaoTemAlarme('2.0.0')).toBe(true)
    for (const v of ['1.1.0', '1.1.2', '0.2.0-beta.13', '', null, 'x']) expect(versaoTemAlarme(v), String(v)).toBe(false)
  })
  it('Assistente dono da cozinha ONLINE (sinal < 30 s) e com alarme → só ele toca (painel mudo)', () => {
    expect(assistenteTocaAlarme(ag(), agora)).toBe(true)
  })
  it('offline, revogado, sem Assistente ou versão antiga → o painel toca (nunca nenhum)', () => {
    expect(assistenteTocaAlarme(ag({ visto_em: ha(31) }), agora)).toBe(false)
    expect(assistenteTocaAlarme(ag({ visto_em: null }), agora)).toBe(false)
    expect(assistenteTocaAlarme(ag({ revogado_em: ha(100) }), agora)).toBe(false)
    expect(assistenteTocaAlarme(ag({ versao: '1.1.0' }), agora)).toBe(false)
    expect(assistenteTocaAlarme(null, agora)).toBe(false)
  })
  it('janela da atualização automática (Brasília): 03:00–10:30 e 14:30–17:00', () => {
    const sp = (hm: string) => new Date(`2026-10-12T${hm}:00-03:00`)
    for (const hm of ['03:00', '07:15', '10:29', '14:30', '16:59']) expect(dentroDaJanelaDeAtualizacao(sp(hm)), hm).toBe(true)
    for (const hm of ['02:59', '10:30', '12:00', '14:29', '17:00', '20:00', '23:30']) expect(dentroDaJanelaDeAtualizacao(sp(hm)), hm).toBe(false)
  })
})
