import { describe, it, expect, vi } from 'vitest'
import { processarCampanhas } from './campanhas-envio'
import type { ProvedorWhatsapp } from './provedor'

vi.mock('./historico', () => ({ registrarSaida: vi.fn(async () => ({ mensagemId: 'm' })), concluirSaida: vi.fn(async () => undefined) }))

const envio = (id: string) => ({
  id, campanha_id: 'c1', restaurante_id: 'r1', telefone: '5527999990000', nome_cliente: 'Ana', token: null,
  tipo_mensagem: 'texto', mensagem: 'Oi', imagem_url: null, audio_url: null, incluir_link: false,
  evolution_instance: 'inst', slug: 'loja',
})

function adminFalso(concluir: (id: string) => { data?: unknown; error?: unknown } | Promise<never>) {
  const vazio = { select: () => vazio, in: () => vazio, lte: async () => ({ data: [] }), update: () => vazio, eq: () => vazio }
  return {
    from: () => vazio,
    rpc: vi.fn(async (fn: string, args: { p_id?: string }) => {
      if (fn === 'campanha_reservar_envios') return { data: [envio('e1'), envio('e2'), envio('e3')], error: null }
      if (fn === 'modulo_liberado') return { data: true, error: null } // módulo Disparos liberado (0176)
      return concluir(args.p_id!)
    }),
  }
}

const provedor = {
  conexao: vi.fn(async () => 'aberto'),
  enviarTexto: vi.fn(async () => ({ ok: true, idExterno: 'x' })),
} as unknown as ProvedorWhatsapp

describe('processarCampanhas (B13)', () => {
  it('erro ao gravar o resultado de um envio não aborta o lote', async () => {
    const admin = adminFalso((id) => (id === 'e1' ? { data: null, error: { message: 'timeout' } } : { data: 'enviado', error: null }))
    const r = await processarCampanhas(admin as never, provedor, { limite: 10, intervalo: () => 0 })
    expect(provedor.enviarTexto).toHaveBeenCalledTimes(3)
    expect(r.processados).toBe(3)
    expect(r.enviados).toBe(2)
    expect(r.incertos).toBe(1)
  })

  it('exceção (rede) na gravação também não aborta', async () => {
    ;(provedor.enviarTexto as ReturnType<typeof vi.fn>).mockClear()
    const admin = adminFalso((id) => (id === 'e2' ? Promise.reject(new Error('fetch failed')) : { data: 'enviado', error: null }))
    const r = await processarCampanhas(admin as never, provedor, { limite: 10, intervalo: () => 0 })
    expect(provedor.enviarTexto).toHaveBeenCalledTimes(3)
    expect(r.enviados).toBe(2)
    expect(r.incertos).toBe(1)
  })
})

describe('processarCampanhas: módulo Disparos bloqueado (0176)', () => {
  it('loja bloqueada não envia nada', async () => {
    const enviar = vi.fn(async () => ({ ok: true, idExterno: 'x' }))
    const prov = { conexao: vi.fn(async () => 'aberto'), enviarTexto: enviar } as unknown as ProvedorWhatsapp
    const vazio2 = { select: () => ({ in: async () => ({ data: [], error: null }) }) }
    const admin = {
      from: () => vazio2,
      rpc: vi.fn(async (fn: string) => {
        if (fn === 'campanha_reservar_envios') return { data: [{ id: 'e9', campanha_id: 'c9', restaurante_id: 'L9', telefone: '27999990000', texto: 'oi', evolution_instance: 'i' }], error: null }
        if (fn === 'modulo_liberado') return { data: false, error: null }
        return { data: { concluido: true }, error: null }
      }),
    }
    await processarCampanhas(admin as never, prov, { limite: 10, intervalo: () => 0 }).catch(() => null)
    expect(enviar).not.toHaveBeenCalled()
  })
})
