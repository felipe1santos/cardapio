import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _zerarGuarda } from './guarda'
import { cancelarAssinaturaAsaas } from './asaas'

/**
 * 03/11/2026 (auditoria da assinatura, achado alto): quando o cadastro falha depois de criar a assinatura no Asaas, ou
 * quando o Super Admin exclui o lojista, a assinatura continuava VIVA no Asaas, cobrando todo mês um CPF sem conta.
 * Agora existe o cancelamento (DELETE /subscriptions/{id}), pela guarda como tudo que fala com o Asaas.
 */
function banco() {
  return { rpc: vi.fn(async () => ({ data: { permitido: true, chamadas: 1, limite: 200 }, error: null })), from: () => ({ insert: async () => ({ error: null }) }) } as never
}
const fetchFalso = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>()
beforeEach(() => { _zerarGuarda(); process.env.ASAAS_API_KEY = 'chave-teste'; vi.stubGlobal('fetch', fetchFalso); fetchFalso.mockReset() })
afterEach(() => { vi.unstubAllGlobals(); delete process.env.ASAAS_API_KEY })

describe('cancelarAssinaturaAsaas', () => {
  it('DELETE /subscriptions/{id} com a chave no cabeçalho; devolve true quando o Asaas confirma', async () => {
    fetchFalso.mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true, id: 'sub_1' }), { status: 200 }))
    expect(await cancelarAssinaturaAsaas(banco(), 'sub_1')).toBe(true)
    const [url, init] = fetchFalso.mock.calls[0]
    expect(url).toBe('https://api.asaas.com/v3/subscriptions/sub_1')
    expect(init?.method).toBe('DELETE')
    expect((init?.headers as Record<string, string>).access_token).toBe('chave-teste')
  })
  it('já não existe no Asaas (404) → true (nada a cancelar); outro erro → false, sem lançar', async () => {
    fetchFalso.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    expect(await cancelarAssinaturaAsaas(banco(), 'sub_x')).toBe(true)
    fetchFalso.mockResolvedValueOnce(new Response('{}', { status: 500 }))
    expect(await cancelarAssinaturaAsaas(banco(), 'sub_y')).toBe(false)
  })
})
