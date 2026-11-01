import { describe, expect, it } from 'vitest'
import { agruparAlertas, type AlertaHistorico } from './historico-alertas'

/**
 * Histórico de alertas do Super Admin (01/11/2026): uma linha por assunto, com quantas vezes saiu e se já resolveu,
 * para o dono ver o que importa e não 9 linhas iguais da mesma impressora.
 */
const a = (p: Partial<AlertaHistorico> & { id: number; assunto: string; criado_em: string }): AlertaHistorico =>
  ({ nivel: 'amarelo', texto: '🟡 Menuzia — x\no que\nQuanto: 1\nO que fazer: y', resolvido_em: null, ...p })

describe('agruparAlertas', () => {
  it('junta o mesmo assunto numa linha: o mais recente na frente, com contador e a primeira ocorrência', () => {
    const grupos = agruparAlertas([
      a({ id: 3, assunto: 'assistente-BURGUER MAX', criado_em: '2026-11-01T16:11:00Z', nivel: 'vermelho' }),
      a({ id: 2, assunto: 'requisicoes', criado_em: '2026-11-01T12:00:00Z', resolvido_em: '2026-11-01T12:10:00Z' }),
      a({ id: 1, assunto: 'assistente-BURGUER MAX', criado_em: '2026-10-29T08:18:00Z', nivel: 'vermelho' }),
    ])
    expect(grupos.map((g) => [g.assunto, g.vezes, g.primeiro.id, g.ultimo.id])).toEqual([
      ['assistente-BURGUER MAX', 2, 1, 3],
      ['requisicoes', 1, 2, 2],
    ])
  })
  it('situação: ativo enquanto o último não tem resolvido_em; resolvido quando tem', () => {
    const [g1, g2] = agruparAlertas([
      a({ id: 2, assunto: 'requisicoes', criado_em: '2026-11-01T12:00:00Z', resolvido_em: '2026-11-01T12:10:00Z' }),
      a({ id: 1, assunto: 'vps-disco', criado_em: '2026-11-01T11:00:00Z' }),
    ])
    expect(g1.situacao).toBe('resolvido')
    expect(g2.situacao).toBe('ativo')
  })
  it('resumo e teste não agrupam nem têm situação (cada um é um aviso avulso)', () => {
    const g = agruparAlertas([
      a({ id: 2, assunto: 'resumo-diario', nivel: 'resumo', criado_em: '2026-11-01T12:00:00Z' }),
      a({ id: 1, assunto: 'resumo-diario', nivel: 'resumo', criado_em: '2026-10-31T12:00:00Z' }),
    ])
    expect(g.map((x) => [x.ultimo.id, x.vezes, x.situacao])).toEqual([[2, 1, null], [1, 1, null]])
  })
})
