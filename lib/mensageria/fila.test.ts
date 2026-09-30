import { describe, it, expect, vi, beforeEach } from 'vitest'

const { enviarTexto, registrarSaida, concluirSaida } = vi.hoisted(() => ({
  enviarTexto: vi.fn(async () => ({ ok: true, idExterno: 'wa1' })),
  registrarSaida: vi.fn(async () => ({ mensagemId: 'nova', conversaId: 'c1' })),
  concluirSaida: vi.fn(async () => undefined),
}))
vi.mock('./provedor', () => ({ provedorAtual: () => ({ enviarTexto }), logFalhaEnvio: vi.fn() }))
vi.mock('./robo', () => ({ roboLiberadoNoServidor: () => true }))
vi.mock('./historico', () => ({ registrarSaida, concluirSaida, hashTexto: async () => 'h' }))

import { processarFila } from './fila'

type Envio = { id: string; restaurante_id: string; conversa_id: string; telefone: string; texto: string; tipo: string; criado_em: string; tentativas: number }
const envio = (id: string, tentativas = 1): Envio => ({ id, restaurante_id: 'r1', conversa_id: 'c1', telefone: '5527999990000', texto: 'Oi', tipo: 'aviso_pedido', criado_em: '2026-09-30T20:00:00Z', tentativas })

/** Builder encadeável: cada tabela responde com o que o teste mandar. */
function adminFalso(envios: Envio[], opts: { tomados?: Set<string>; anterior?: string | null } = {}) {
  const renovacoes: string[][] = []
  const tabela = (nome: string) => {
    const estado: { ids?: string[]; update?: boolean } = {}
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'gte', 'order', 'limit']) b[m] = () => b
    b.update = () => { estado.update = true; return b }
    b.in = (_c: string, ids: string[]) => { estado.ids = ids; return b }
    b.then = (ok: (v: unknown) => unknown) => {
      if (nome === 'restaurantes') return Promise.resolve({ data: [{ id: 'r1', evolution_instance: 'inst' }] }).then(ok)
      if (nome === 'whatsapp_envios' && estado.update) {
        renovacoes.push(estado.ids ?? [])
        return Promise.resolve({ data: (estado.ids ?? []).filter((i) => !opts.tomados?.has(i)).map((id) => ({ id })), error: null }).then(ok)
      }
      if (nome === 'whatsapp_mensagens') return Promise.resolve({ data: opts.anterior ? [{ id: opts.anterior }] : [] }).then(ok)
      return Promise.resolve({ data: [] }).then(ok)
    }
    return b
  }
  const rpc = vi.fn(async (fn: string) => (fn === 'whatsapp_reivindicar_envios' ? { data: envios, error: null } : { data: null, error: null }))
  return { admin: { from: tabela, rpc } as never, renovacoes, rpc }
}

beforeEach(() => { enviarTexto.mockClear(); registrarSaida.mockClear(); concluirSaida.mockClear() })

describe('processarFila', () => {
  it('B10: renova a trava do resto do lote antes de cada envio', async () => {
    const { admin, renovacoes } = adminFalso([envio('a'), envio('b'), envio('c')])
    const r = await processarFila(admin)
    expect(r.enviados).toBe(3)
    expect(renovacoes).toEqual([['a', 'b', 'c'], ['b', 'c'], ['c']])
  })

  it('B10: envio já tomado por outro processador (trava vencida) não é enviado', async () => {
    const { admin } = adminFalso([envio('a'), envio('b')], { tomados: new Set(['b']) })
    const r = await processarFila(admin)
    expect(enviarTexto).toHaveBeenCalledTimes(1)
    expect(r.enviados).toBe(1)
  })

  it('B8: nova tentativa reaproveita a mensagem do histórico em vez de criar outra', async () => {
    const { admin } = adminFalso([envio('a', 2)], { anterior: 'antiga' })
    await processarFila(admin)
    expect(registrarSaida).not.toHaveBeenCalled()
    expect(concluirSaida).toHaveBeenCalledWith(admin, 'antiga', true, 'wa1', null)
  })

  it('B8: 1ª tentativa registra normalmente', async () => {
    const { admin } = adminFalso([envio('a', 1)], { anterior: 'antiga' })
    await processarFila(admin)
    expect(registrarSaida).toHaveBeenCalledTimes(1)
    expect(concluirSaida).toHaveBeenCalledWith(admin, 'nova', true, 'wa1', null)
  })
})
