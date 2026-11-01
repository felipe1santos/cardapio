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

/**
 * 01/11/2026 (Fase 5): loja já marcada como desconectada (`whatsapp_estado = 'close'`, o monitor parou de olhar) com
 * campanha pausada era consultada na Evolution TODO MINUTO, por até 7 dias. Regra 3: desligado = zero consulta.
 */
describe('sincronizar pausas: loja desconectada não consulta a Evolution', () => {
  it('campanha pausada de loja com whatsapp_estado close → nenhuma chamada a provedor.conexao', async () => {
    const campanha = { id: 'c9', status: 'pausada', pausa_motivo: 'whatsapp_desconectado', restaurante_id: 'r9', restaurantes: { evolution_instance: 'inst9', whatsapp_estado: 'close' } }
    const vazio: Record<string, unknown> = {}
    for (const m of ['select', 'in', 'update', 'eq']) vazio[m] = () => vazio
    vazio.lte = async () => ({ data: [campanha] })
    const admin = { from: () => vazio, rpc: vi.fn(async () => ({ data: [], error: null })) }
    const conexao = vi.fn(async () => 'aberto')
    await processarCampanhas(admin as never, { conexao, enviarTexto: vi.fn() } as unknown as ProvedorWhatsapp, { limite: 10, intervalo: () => 0 })
    expect(conexao).not.toHaveBeenCalled()
  })
})
