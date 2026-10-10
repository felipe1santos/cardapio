import { beforeEach, describe, expect, it, vi } from 'vitest'
import { _zerarCacheRestauranteId, buscarRestauranteIdDoUsuario } from './cardapio'

/** Desempenho (10/10): na abertura do painel, layout, página e topo pedem o id da loja ao mesmo tempo. */
function supabaseFalso() {
  const getUser = vi.fn(async () => ({ data: { user: { id: 'u1' } } }))
  const single = vi.fn(async () => ({ data: { restaurante_id: 'loja-1' }, error: null }))
  const sb = { auth: { getUser }, from: () => ({ select: () => ({ eq: () => ({ single }) }) }) }
  return { sb: sb as never, getUser, single }
}

beforeEach(() => _zerarCacheRestauranteId())

describe('buscarRestauranteIdDoUsuario no navegador', () => {
  it('chamadas simultâneas compartilham UMA ida ao servidor', async () => {
    const f = supabaseFalso()
    const r = await Promise.all([buscarRestauranteIdDoUsuario(f.sb), buscarRestauranteIdDoUsuario(f.sb), buscarRestauranteIdDoUsuario(f.sb)])
    expect(r).toEqual(['loja-1', 'loja-1', 'loja-1'])
    expect(f.getUser).toHaveBeenCalledTimes(1)
    expect(f.single).toHaveBeenCalledTimes(1)
  })
  it('passados alguns segundos, consulta de novo (troca de login não fica presa)', async () => {
    vi.useFakeTimers()
    try {
      const f = supabaseFalso()
      await buscarRestauranteIdDoUsuario(f.sb)
      vi.advanceTimersByTime(6000)
      await buscarRestauranteIdDoUsuario(f.sb)
      expect(f.getUser).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })
  it('sem login (null) não fica guardado', async () => {
    const f = supabaseFalso()
    f.getUser.mockResolvedValueOnce({ data: { user: null } } as never)
    expect(await buscarRestauranteIdDoUsuario(f.sb)).toBeNull()
    expect(await buscarRestauranteIdDoUsuario(f.sb)).toBe('loja-1')
  })
})
