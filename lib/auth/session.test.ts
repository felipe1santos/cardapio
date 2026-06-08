import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentSession } from './session'

function buildSupabaseStub(opts: {
  authUser: { id: string } | null
  usuarioRow: { restaurante_id: string; papel: string; nome: string } | null
}) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: opts.authUser }, error: null })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: opts.usuarioRow, error: null })),
        })),
      })),
    })),
  }
}

describe('getCurrentSession', () => {
  it('returns null when there is no authenticated user', async () => {
    const supabase = buildSupabaseStub({ authUser: null, usuarioRow: null })
    const session = await getCurrentSession(supabase as unknown as SupabaseClient)
    expect(session).toBeNull()
  })

  it('returns the tenant id, role and name for an authenticated user', async () => {
    const supabase = buildSupabaseStub({
      authUser: { id: 'user-1' },
      usuarioRow: { restaurante_id: 'tenant-1', papel: 'dono', nome: 'Carlos Silva' },
    })
    const session = await getCurrentSession(supabase as unknown as SupabaseClient)
    expect(session).toEqual({
      userId: 'user-1',
      restauranteId: 'tenant-1',
      papel: 'dono',
      nome: 'Carlos Silva',
    })
  })
})
