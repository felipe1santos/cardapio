import { beforeEach, describe, expect, it, vi } from 'vitest'

const envio = vi.hoisted(() => ({ ok: true, chamadas: 0 }))
vi.mock('@/lib/whatsapp', async (orig) => ({
  ...(await orig<typeof import('@/lib/whatsapp')>()),
  enviarWhatsapp: vi.fn(async () => { envio.chamadas++; return envio.ok }),
}))

import { enviarCodigoVerificacao, verificarCodigo } from './clientes'

type Linha = Record<string, unknown>

/** cliente_codigos em memória, com o encadeamento que clientes.ts usa. */
function bancoFalso() {
  const codigos: Linha[] = []
  let seq = 0
  const from = (tabela: string) => {
    if (tabela === 'restaurantes') {
      const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { nome: 'Loja', evolution_instance: 'inst' }, error: null }) }
      return b
    }
    if (tabela === 'clientes') {
      const b = { select: () => b, eq: () => b, insert: () => b, maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: { id: 'c1', telefone: '5527999990000', token: 't' }, error: null }) }
      return b
    }
    if (tabela !== 'cliente_codigos') throw new Error(tabela)
    const filtros: [string, unknown][] = []
    let op: 'select' | 'delete' | 'update' | 'insert' = 'select'
    let patch: Linha = {}
    const alvo = () => codigos.filter((l) => filtros.every(([k, v]) => l[k] === v))
    const b: Record<string, unknown> = {
      select: () => b, order: () => b, limit: () => b,
      eq: (k: string, v: unknown) => { filtros.push([k, v]); return b },
      delete: () => { op = 'delete'; return b },
      update: (p: Linha) => { op = 'update'; patch = p; return b },
      insert: (p: Linha) => { op = 'insert'; patch = { id: `c${++seq}`, tentativas: 0, criado_em: new Date().toISOString(), ...p }; return b },
      maybeSingle: async () => ({ data: [...alvo()].pop() ?? null, error: null }),
      single: async () => { codigos.push(patch); return { data: patch, error: null } },
      then: (ok: (v: unknown) => unknown) => {
        const linhas = alvo()
        if (op === 'delete') for (const l of linhas) codigos.splice(codigos.indexOf(l), 1)
        if (op === 'update') for (const l of linhas) Object.assign(l, patch)
        return Promise.resolve({ data: linhas, error: null }).then(ok)
      },
    }
    return b
  }
  return { admin: { from } as never, codigos }
}

beforeEach(() => { envio.ok = true; envio.chamadas = 0 })

describe('código de verificação do cardápio', () => {
  it('segundo pedido de código em menos de 60 s não manda outro WhatsApp', async () => {
    const { admin } = bancoFalso()
    expect(await enviarCodigoVerificacao(admin, 'r1', '27999990000')).toEqual({ ok: true })
    const r = await enviarCodigoVerificacao(admin, 'r1', '27999990000')
    expect(r.ok).toBe(false)
    expect(r).toMatchObject({ podeFallback: false, aguarde: true })
    expect(envio.chamadas).toBe(1)
  })

  it('pedido depois do intervalo manda um novo', async () => {
    const { admin, codigos } = bancoFalso()
    await enviarCodigoVerificacao(admin, 'r1', '27999990000')
    codigos[0].criado_em = new Date(Date.now() - 61_000).toISOString()
    expect(await enviarCodigoVerificacao(admin, 'r1', '27999990000')).toEqual({ ok: true })
    expect(envio.chamadas).toBe(2)
    expect(codigos).toHaveLength(1)
  })

  it('WhatsApp fora do ar: o código não enviado é apagado (não prende o fallback)', async () => {
    const { admin, codigos } = bancoFalso()
    envio.ok = false
    expect(await enviarCodigoVerificacao(admin, 'r1', '27999990000')).toMatchObject({ ok: false, podeFallback: true })
    expect(codigos).toHaveLength(0)
    expect(await enviarCodigoVerificacao(admin, 'r1', '27999990000')).toMatchObject({ podeFallback: true })
  })

  it('código errado conta tentativa; a 6ª é recusada mesmo com o código certo', async () => {
    const { admin, codigos } = bancoFalso()
    await enviarCodigoVerificacao(admin, 'r1', '27999990000')
    const certo = String(codigos[0].codigo)
    const errado = certo === '111111' ? '222222' : '111111'
    for (let i = 0; i < 5; i++) expect(await verificarCodigo(admin, 'r1', '27999990000', errado)).toMatchObject({ ok: false, error: 'Código incorreto.' })
    expect(await verificarCodigo(admin, 'r1', '27999990000', certo)).toMatchObject({ ok: false, error: expect.stringMatching(/Muitas tentativas/) })
  })

  it('código tem 6 dígitos', async () => {
    const { admin, codigos } = bancoFalso()
    await enviarCodigoVerificacao(admin, 'r1', '27999990000')
    expect(String(codigos[0].codigo)).toMatch(/^[1-9]\d{5}$/)
  })
})
