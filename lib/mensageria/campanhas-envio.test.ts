import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { _resetChecagemCards, processarCampanhas } from './campanhas-envio'
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

/**
 * 03/11/2026 (0245): os cards recorrentes viram rodadas por uma RPC que o cron chama no máximo a cada 10 min —
 * nunca a cada tique — e cuja falha não derruba o envio do lote.
 */
describe('processarCampanhas: rodadas dos cards a cada 10 min', () => {
  // O provedor é compartilhado com os describes abaixo: não deixa chamada contada para trás.
  beforeEach(() => { _resetChecagemCards(); (provedor.enviarTexto as ReturnType<typeof vi.fn>).mockClear() })
  afterEach(() => (provedor.enviarTexto as ReturnType<typeof vi.fn>).mockClear())
  function adminComRodadas(rpcRodadas: () => { data?: unknown; error?: unknown }) {
    const chamadas: string[] = []
    const vazio = { select: () => vazio, in: () => vazio, lte: async () => ({ data: [] }), update: () => vazio, eq: () => vazio }
    const admin = {
      from: () => vazio,
      rpc: vi.fn(async (fn: string) => {
        chamadas.push(fn)
        if (fn === 'campanha_reservar_envios') return { data: [envio('e1')], error: null }
        if (fn === 'modulo_liberado') return { data: true, error: null }
        if (fn === 'campanha_recorrentes_gerar_rodadas') return rpcRodadas()
        return { data: 'enviado', error: null }
      }),
    }
    return { admin: admin as never, chamadas }
  }
  it('duas chamadas seguidas → a RPC das rodadas roda UMA vez; o resumo conta as rodadas criadas', async () => {
    const { admin, chamadas } = adminComRodadas(() => ({ data: [{ motivo: 'ok' }, { motivo: 'sem_publico' }, { motivo: 'ok' }], error: null }))
    const r1 = await processarCampanhas(admin, provedor, { limite: 10, intervalo: () => 0 })
    await processarCampanhas(admin, provedor, { limite: 10, intervalo: () => 0 })
    expect(chamadas.filter((c) => c === 'campanha_recorrentes_gerar_rodadas')).toHaveLength(1)
    expect(r1.rodadas).toBe(2)
  })
  it('depois de zerar a lembrança (deploy) a RPC roda de novo', async () => {
    const { admin, chamadas } = adminComRodadas(() => ({ data: [], error: null }))
    await processarCampanhas(admin, provedor, { limite: 10, intervalo: () => 0 })
    _resetChecagemCards()
    await processarCampanhas(admin, provedor, { limite: 10, intervalo: () => 0 })
    expect(chamadas.filter((c) => c === 'campanha_recorrentes_gerar_rodadas')).toHaveLength(2)
  })
  it('RPC com erro não derruba o lote: os envios saem do mesmo jeito', async () => {
    ;(provedor.enviarTexto as ReturnType<typeof vi.fn>).mockClear()
    const { admin } = adminComRodadas(() => ({ data: null, error: { message: 'boom' } }))
    const r = await processarCampanhas(admin, provedor, { limite: 10, intervalo: () => 0 })
    expect(provedor.enviarTexto).toHaveBeenCalledTimes(1)
    expect(r.processados).toBe(1)
    expect(r.rodadas).toBe(0)
  })
})

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

/**
 * 04/11/2026 (0249): sessão "zumbi" — a Evolution diz que a instância está conectada, mas o envio falha com
 * "Connection Closed". Antes: pausa → no minuto seguinte retoma (estado aberto) → falha → pausa… sem fim e sem gastar
 * tentativa. Agora a retomada automática respeita `retomar_apos` (espera crescente gravada pelo banco) e, depois de 4
 * pausas seguidas, o motivo vira 'whatsapp_instavel', que não retoma sozinho.
 */
describe('sincronizar pausas: sessão zumbi não vira loop', () => {
  function adminCom(campanha: Record<string, unknown>) {
    const updates: unknown[] = []
    const vazio: Record<string, unknown> = {}
    for (const m of ['select', 'in', 'eq']) vazio[m] = () => vazio
    vazio.update = (v: unknown) => { updates.push(v); return vazio }
    vazio.lte = async () => ({ data: [campanha] })
    const admin = { from: () => vazio, rpc: vi.fn(async () => ({ data: [], error: null })) }
    return { admin, updates }
  }
  const base = { id: 'c7', status: 'pausada', restaurante_id: 'r7', restaurantes: { evolution_instance: 'inst7', whatsapp_estado: 'open' } }
  const conexao = vi.fn(async () => 'aberto')

  it('pausada por desconexão com retomar_apos no futuro: NÃO retoma, mesmo com a instância "aberta"', async () => {
    const { admin, updates } = adminCom({ ...base, pausa_motivo: 'whatsapp_desconectado', retomar_apos: new Date(Date.now() + 10 * 60_000).toISOString() })
    const r = await processarCampanhas(admin as never, { conexao, enviarTexto: vi.fn() } as unknown as ProvedorWhatsapp, { limite: 10, intervalo: () => 0 })
    expect(r.campanhasRetomadas).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('retomar_apos já passou: retoma', async () => {
    const { admin } = adminCom({ ...base, pausa_motivo: 'whatsapp_desconectado', retomar_apos: new Date(Date.now() - 60_000).toISOString() })
    const r = await processarCampanhas(admin as never, { conexao, enviarTexto: vi.fn() } as unknown as ProvedorWhatsapp, { limite: 10, intervalo: () => 0 })
    expect(r.campanhasRetomadas).toBe(1)
  })

  it("motivo 'whatsapp_instavel' (4 pausas seguidas): nunca retoma sozinho", async () => {
    const { admin } = adminCom({ ...base, pausa_motivo: 'whatsapp_instavel', retomar_apos: null })
    const r = await processarCampanhas(admin as never, { conexao, enviarTexto: vi.fn() } as unknown as ProvedorWhatsapp, { limite: 10, intervalo: () => 0 })
    expect(r.campanhasRetomadas).toBe(0)
  })
})
