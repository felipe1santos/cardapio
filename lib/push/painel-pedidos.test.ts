import { afterEach, describe, expect, it, vi } from 'vitest'
import { avisarPainelPedidoNovo, textoPushPainel } from './painel-pedidos'
import { textoDoTituloPiscando } from '@/lib/alarme-pedidos'

describe('textos do alarme do painel', () => {
  it('título piscando: um pedido mostra o número; vários mostram a contagem', () => {
    expect(textoDoTituloPiscando([12])).toBe('🔔 Pedido novo #12')
    expect(textoDoTituloPiscando([12, 13, 14])).toBe('🔔 3 pedidos novos')
    expect(textoDoTituloPiscando([])).toBe('🔔 Pedido novo')
  })
  it('push do painel: número e canal', () => {
    expect(textoPushPainel({ numero: 7, canal: 'entrega' })).toEqual({ title: '🔔 Pedido novo #7', body: 'Pedido para entrega esperando aceite no painel.' })
    expect(textoPushPainel({ numero: null }).title).toBe('🔔 Pedido novo')
  })
})

/** Supabase falso só com o que o envio usa (select das assinaturas, update e delete por id). */
function adminFalso(assinaturas: { id: string; endpoint: string; p256dh: string; auth: string; falhas: number }[]) {
  const mudancas: { op: string; id: string; dados?: unknown }[] = []
  const from = () => ({
    select: () => ({ eq: async () => ({ data: assinaturas }) }),
    update: (dados: unknown) => ({ eq: async (_c: string, id: string) => { mudancas.push({ op: 'update', id, dados }); return {} } }),
    delete: () => ({ eq: async (_c: string, id: string) => { mudancas.push({ op: 'delete', id }); return {} } }),
  })
  return { admin: { from } as never, mudancas }
}

describe('envio do push do painel', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  it('sem chaves VAPID e fora do simulado: não envia nada', async () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', ''); vi.stubEnv('VAPID_PRIVATE_KEY', ''); vi.stubEnv('PUSH_PROVEDOR', '')
    const { admin } = adminFalso([{ id: 'a', endpoint: 'https://x', p256dh: 'p', auth: 'a', falhas: 0 }])
    const remetente = vi.fn()
    expect(await avisarPainelPedidoNovo(admin, 'loja', { id: 'p1', numero: 1 }, remetente)).toEqual({ enviados: 0, removidas: 0 })
    expect(remetente).not.toHaveBeenCalled()
  })
  it('envia a cada aparelho; assinatura expirada (410) é removida; falha temporária soma', async () => {
    vi.stubEnv('PUSH_PROVEDOR', 'simulado')
    const { admin, mudancas } = adminFalso([
      { id: 'ok', endpoint: 'https://ok', p256dh: 'p', auth: 'a', falhas: 2 },
      { id: 'velha', endpoint: 'https://velha', p256dh: 'p', auth: 'a', falhas: 0 },
      { id: 'instavel', endpoint: 'https://instavel', p256dh: 'p', auth: 'a', falhas: 1 },
    ])
    const remetente = vi.fn(async (d: { endpoint: string }, payload: string) => {
      expect(JSON.parse(payload)).toMatchObject({ title: '🔔 Pedido novo #9', tag: 'menuzia-pedido', data: { url: '/admin/pedidos' } })
      if (d.endpoint.includes('velha')) return { ok: false as const, status: 410, erro: 'gone' }
      if (d.endpoint.includes('instavel')) return { ok: false as const, status: 503, erro: 'x' }
      return { ok: true as const }
    })
    expect(await avisarPainelPedidoNovo(admin, 'loja', { id: 'p9', numero: 9 }, remetente)).toEqual({ enviados: 1, removidas: 1 })
    expect(mudancas).toContainEqual({ op: 'delete', id: 'velha' })
    expect(mudancas).toContainEqual({ op: 'update', id: 'instavel', dados: { falhas: 2 } })
    expect(mudancas.find((m) => m.id === 'ok')).toMatchObject({ op: 'update', dados: { falhas: 0 } })
  })
})
