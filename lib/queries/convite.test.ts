import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { completarPrimeiroAcesso, convidarLojista, novoLinkDoConvite } from './lojistas'

/**
 * Achado #3 da auditoria (25/10): o cadastro por convite concluía só pelo e-mail — quem soubesse o e-mail de um convite
 * pendente definia a senha e virava dono. Agora o convite tem um token aleatório (só o hash fica guardado, no
 * app_metadata da conta, que o usuário não altera); sem o token certo, nada muda. O token vale uma vez.
 */

type Linha = Record<string, unknown>

function ambiente() {
  const usuarios: Linha[] = []
  const restaurantes: Linha[] = []
  const metadados = new Map<string, Record<string, unknown>>()
  const senhas = new Map<string, string>()
  const auth = {
    admin: {
      createUser: vi.fn(async (p: { email: string; app_metadata?: Record<string, unknown> }) => {
        const id = `u${metadados.size + 1}`
        metadados.set(id, { ...(p.app_metadata ?? {}) })
        return { data: { user: { id, email: p.email } }, error: null }
      }),
      getUserById: vi.fn(async (id: string) => ({ data: { user: metadados.has(id) ? { id, app_metadata: metadados.get(id) } : null }, error: null })),
      updateUserById: vi.fn(async (id: string, p: { password?: string; app_metadata?: Record<string, unknown> }) => {
        if (p.password) senhas.set(id, p.password)
        if (p.app_metadata) metadados.set(id, { ...(metadados.get(id) ?? {}), ...p.app_metadata })
        return { data: {}, error: null }
      }),
      deleteUser: vi.fn(async () => ({ error: null })),
    },
  }
  const tabela = (nome: string) => (nome === 'usuarios' ? usuarios : restaurantes)
  const from = (nome: string) => {
    const filtros: ((l: Linha) => boolean)[] = []
    let patch: Linha | null = null
    const achadas = () => tabela(nome).filter((l) => filtros.every((f) => f(l)))
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { filtros.push((l) => l[c] === v); return q },
      like: () => q,
      limit: () => q,
      update: (p: Linha) => { patch = p; return q },
      insert: (l: Linha) => {
        const nova = { id: nome === 'restaurantes' ? `r${restaurantes.length + 1}` : l.id, ...l }
        tabela(nome).push(nova)
        const r = { select: () => r, single: async () => ({ data: nova, error: null }), then: (ok: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(ok) }
        return r
      },
      delete: () => q,
      maybeSingle: async () => ({ data: achadas()[0] ?? null, error: null }),
      single: async () => ({ data: achadas()[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown) => {
        const l = achadas()
        if (patch) for (const x of l) Object.assign(x, patch)
        return Promise.resolve({ data: l, error: null }).then(ok)
      },
    }
    return q
  }
  return { admin: { auth, from } as unknown as SupabaseClient, usuarios, senhas, metadados }
}

const dados = { email: 'dono@loja.com', senha: 'segredo123', nome: 'Ana', telefone: '27999990000', nomeLoja: 'Loja Nova', usuario: 'ana.loja' }

describe('convite com token', () => {
  it('pré-cadastro devolve o token e guarda só o hash', async () => {
    const { admin, metadados } = ambiente()
    const r = await convidarLojista(admin, { email: dados.email })
    expect(r.ok).toBe(true)
    const token = (r as { token?: string }).token!
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const meta = metadados.get('u1')!
    expect(meta.convite_hash).toBeTruthy()
    expect(JSON.stringify(meta)).not.toContain(token)
  })

  it('sem token (ou com token errado) não conclui e não troca a senha', async () => {
    const { admin, senhas, usuarios } = ambiente()
    await convidarLojista(admin, { email: dados.email })
    expect((await completarPrimeiroAcesso(admin, { ...dados, convite: '' })).ok).toBe(false)
    expect((await completarPrimeiroAcesso(admin, { ...dados, convite: 'chute-de-token-com-mais-de-32-letras' })).ok).toBe(false)
    expect(senhas.size).toBe(0)
    expect(usuarios[0].restaurante_id).toBeNull()
  })

  it('com o token certo conclui — e o token não vale de novo', async () => {
    const { admin, senhas, metadados } = ambiente()
    const { token } = (await convidarLojista(admin, { email: dados.email })) as { token: string }
    expect((await completarPrimeiroAcesso(admin, { ...dados, convite: token })).ok).toBe(true)
    expect(senhas.get('u1')).toBe(dados.senha)
    expect(metadados.get('u1')!.convite_hash).toBeNull()
  })

  it('novo link invalida o anterior', async () => {
    const { admin } = ambiente()
    const { token: velho } = (await convidarLojista(admin, { email: dados.email })) as { token: string }
    const r = await novoLinkDoConvite(admin, 'u1')
    expect(r.ok).toBe(true)
    expect((await completarPrimeiroAcesso(admin, { ...dados, convite: velho })).ok).toBe(false)
    expect((await completarPrimeiroAcesso(admin, { ...dados, convite: (r as { token: string }).token })).ok).toBe(true)
  })
})
