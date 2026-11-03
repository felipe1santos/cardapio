import { describe, expect, it, vi } from 'vitest'
import { garantirRecorrentes, mapRecorrente } from './recorrentes'

/** 03/11/2026: os 3 cards nascem na primeira abertura da tela, desligados, na ordem fixa. */

function supabaseFalso(linhas: Record<string, unknown>[], campanhas: Record<string, unknown>[] = []) {
  const upsert = vi.fn(async () => ({ error: null }))
  const chain = (tabela: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'order']) b[m] = () => b
    b.upsert = upsert
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabela === 'campanha_recorrentes' ? linhas : campanhas, error: null }).then(ok)
    return b
  }
  return { client: { from: (t: string) => chain(t) } as never, upsert }
}

const linha = (tipo: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${tipo}`, tipo, ativa: false, mensagem: 'm', incluir_link: true, imagens: [], imagem_indice: 0,
  dias_semana: [0, 1, 2, 3, 4, 5, 6], hora: '17:00:00', janela_fim: '19:00:00', pular_ate: null, proximo_disparo_em: null,
  ultima_rodada_em: null, ultima_campanha_id: null, ultima_rodada_motivo: null, desligado_motivo: null, ...extra,
})

describe('garantirRecorrentes', () => {
  it('faz upsert das 3 linhas sem sobrescrever (ignoreDuplicates) e devolve na ordem recuperacao, nunca_compraram, promocoes', async () => {
    const { client, upsert } = supabaseFalso([linha('promocoes'), linha('recuperacao'), linha('nunca_compraram')])
    const lista = await garantirRecorrentes(client, 'L1')
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsert.mock.calls[0] as unknown as [Record<string, unknown>[], Record<string, unknown>]
    expect(rows.map((r) => r.tipo)).toEqual(['recuperacao', 'nunca_compraram', 'promocoes'])
    expect(rows.every((r) => r.restaurante_id === 'L1' && typeof r.mensagem === 'string' && (r.mensagem as string).includes('{nome}'))).toBe(true)
    expect(opts).toMatchObject({ onConflict: 'restaurante_id,tipo', ignoreDuplicates: true })
    expect(lista.map((r) => r.tipo)).toEqual(['recuperacao', 'nunca_compraram', 'promocoes'])
  })
  it('card com última campanha traz os números da rodada', async () => {
    const { client } = supabaseFalso(
      [linha('recuperacao', { ultima_campanha_id: 'c1', ultima_rodada_motivo: 'ok' }), linha('nunca_compraram'), linha('promocoes')],
      [{ id: 'c1', total_destinatarios: 40, total_enviados: 12, total_erros: 1, status: 'enviando' }],
    )
    const [rec] = await garantirRecorrentes(client, 'L1')
    expect(rec.ultimaRodada).toEqual({ destinatarios: 40, enviados: 12, erros: 1, status: 'enviando' })
  })
})

describe('mapRecorrente', () => {
  it('hora sem segundos, dias e imagens como arrays', () => {
    const r = mapRecorrente(linha('promocoes', { imagens: ['https://x/a.jpg'], dias_semana: [1, 3] }))
    expect(r).toMatchObject({ tipo: 'promocoes', hora: '17:00', janelaFim: '19:00', imagens: ['https://x/a.jpg'], diasSemana: [1, 3], ultimaRodada: null })
  })
})
