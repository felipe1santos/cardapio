import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { comCacheDaLoja, _limparCacheAgente } from './cache-agente'

/**
 * Egress (26/10): a cada volta da espera longa (~20 s) a rota do Assistente relia impressoras e dados da loja para o
 * rodapé (nome, logo, endereço) — ~16 mil consultas/dia. São dados de enfeite: 60 s de cache por loja bastam.
 */

describe('comCacheDaLoja', () => {
  beforeEach(() => { vi.useFakeTimers(); _limparCacheAgente() })
  afterEach(() => { vi.useRealTimers() })

  it('segunda volta dentro de 60 s não consulta o banco', async () => {
    const ler = vi.fn(async () => ({ nome: 'Loja' }))
    expect(await comCacheDaLoja('loja-rodape', 'r1', ler)).toEqual({ nome: 'Loja' })
    expect(await comCacheDaLoja('loja-rodape', 'r1', ler)).toEqual({ nome: 'Loja' })
    expect(ler).toHaveBeenCalledTimes(1)
  })

  it('cada loja e cada dado têm o seu cache', async () => {
    const ler = vi.fn(async () => 1)
    await comCacheDaLoja('impressoras', 'r1', ler)
    await comCacheDaLoja('impressoras', 'r2', ler)
    await comCacheDaLoja('loja-rodape', 'r1', ler)
    expect(ler).toHaveBeenCalledTimes(3)
  })

  it('depois de 60 s lê de novo', async () => {
    const ler = vi.fn(async () => 1)
    await comCacheDaLoja('impressoras', 'r1', ler)
    vi.advanceTimersByTime(60_001)
    await comCacheDaLoja('impressoras', 'r1', ler)
    expect(ler).toHaveBeenCalledTimes(2)
  })

  it('erro não fica guardado: a próxima volta tenta de novo', async () => {
    const ler = vi.fn().mockRejectedValueOnce(new Error('rede')).mockResolvedValueOnce(5)
    await expect(comCacheDaLoja('impressoras', 'r1', ler)).rejects.toThrow('rede')
    expect(await comCacheDaLoja('impressoras', 'r1', ler)).toBe(5)
  })
})
