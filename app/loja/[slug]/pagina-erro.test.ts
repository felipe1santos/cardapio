import { describe, expect, it, vi } from 'vitest'

/**
 * 29/10: com o banco fora, a vitrine respondia "loja não encontrada" (404) — o catch virava `loja = null` → notFound().
 * Agora o erro sobe: o Next serve a última página boa do cache (revalidate 60) ou o error.tsx ("Voltamos já").
 */
const buscar = vi.fn()
vi.mock('@/lib/queries/cardapio', () => ({ buscarRestaurantePorSlug: (...a: unknown[]) => buscar(...a) }))
vi.mock('@/lib/supabase/vitrine', () => ({ getVitrineSupabase: () => ({}) }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NEXT_NOT_FOUND') } }))
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()), cache: <T,>(f: T) => f }))

describe('vitrine com o banco fora', { timeout: 30_000 }, () => {
  it('erro do banco NÃO vira 404: a página lança para o error.tsx', async () => {
    buscar.mockRejectedValueOnce(new Error('Service for this project is restricted'))
    const { default: PaginaDaLoja } = await import('./page')
    await expect(PaginaDaLoja({ params: Promise.resolve({ slug: 'menuzia-erro' }) })).rejects.toThrow(/indispon|restricted/i)
  })
  it('loja que não existe continua 404', async () => {
    buscar.mockResolvedValueOnce(null)
    const { default: PaginaDaLoja } = await import('./page')
    await expect(PaginaDaLoja({ params: Promise.resolve({ slug: 'nao-existe' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})
