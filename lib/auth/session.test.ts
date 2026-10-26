import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getCurrentSession } from './session'
import { assinarSessao, CABECALHO_SESSAO } from './sessao-assinada'

const cabecalhos = new Map<string, string>()
vi.mock('next/headers', () => ({ headers: async () => ({ get: (n: string) => cabecalhos.get(n) ?? null }) }))

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
      // Sem e-mail no login: null (o suporte é reconhecido pelo e-mail).
      email: null,
    })
  })
})

describe('getCurrentSession com a sessão já conferida pelo middleware (egress, 26/10)', () => {
  const sessao = { userId: 'user-1', restauranteId: 'tenant-1', papel: 'gerente', nome: 'Bia', email: 'b@x.com' }
  beforeEach(() => {
    cabecalhos.clear()
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'segredo-teste'
  })

  it('cabeçalho assinado válido: usa a sessão sem chamar Auth nem `usuarios`', async () => {
    cabecalhos.set(CABECALHO_SESSAO, await assinarSessao(sessao, 'segredo-teste'))
    const supabase = buildSupabaseStub({ authUser: null, usuarioRow: null })
    expect(await getCurrentSession(supabase as unknown as SupabaseClient)).toEqual(sessao)
    expect(supabase.auth.getUser).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('cabeçalho forjado (outro segredo): ignora e confere como sempre', async () => {
    cabecalhos.set(CABECALHO_SESSAO, await assinarSessao({ ...sessao, papel: 'dono' }, 'chute'))
    const supabase = buildSupabaseStub({ authUser: { id: 'user-1' }, usuarioRow: { restaurante_id: 'tenant-1', papel: 'garcom', nome: 'Bia' } })
    const s = await getCurrentSession(supabase as unknown as SupabaseClient)
    expect(supabase.auth.getUser).toHaveBeenCalled()
    expect(s?.papel).toBe('garcom')
  })

  it('sem cabeçalho: confere como sempre', async () => {
    const supabase = buildSupabaseStub({ authUser: null, usuarioRow: null })
    expect(await getCurrentSession(supabase as unknown as SupabaseClient)).toBeNull()
    expect(supabase.auth.getUser).toHaveBeenCalled()
  })
})
