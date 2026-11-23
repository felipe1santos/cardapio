import { describe, expect, it, vi } from 'vitest'
import { enviarLembretesEncomenda } from './encomenda-lembrete'

/**
 * Lembrete da véspera (0250): 1 por pedido. A reserva (UPDATE … IS NULL) vem ANTES do envio; quem não conseguiu
 * reservar (outra rodada pegou) não envia. Pedido feito em cima da hora é reservado sem envio (não volta na consulta).
 */
const AGORA = new Date('2026-11-23T13:00:00.000Z')
const H = 3600_000

function fake(pedidos: { id: string; agendado_para: string; criado_em: string }[], reservaOk: (id: string) => boolean) {
  const filtros: unknown[][] = []
  const reservados: string[] = []
  const consulta = {
    select: () => consulta,
    eq: (...a: unknown[]) => { filtros.push(['eq', ...a]); return consulta },
    is: (...a: unknown[]) => { filtros.push(['is', ...a]); return consulta },
    in: (...a: unknown[]) => { filtros.push(['in', ...a]); return consulta },
    gt: (...a: unknown[]) => { filtros.push(['gt', ...a]); return consulta },
    lte: (...a: unknown[]) => { filtros.push(['lte', ...a]); return consulta },
    order: () => consulta,
    limit: async (n: number) => { filtros.push(['limit', n]); return { data: pedidos, error: null } },
  }
  const admin = {
    from: () => ({
      select: consulta.select,
      update: () => {
        let id = ''
        const u = {
          eq: (_c: string, v: string) => { id = v; return u },
          is: () => u,
          select: async () => (reservaOk(id) ? (reservados.push(id), { data: [{ id }], error: null }) : { data: [], error: null }),
        }
        return u
      },
    }),
  }
  return { admin: admin as never, filtros, reservados }
}

describe('enviarLembretesEncomenda', () => {
  it('consulta só encomendas sem lembrete, na janela de 24 h, ativas, com limite', async () => {
    const f = fake([], () => true)
    await enviarLembretesEncomenda(f.admin, { agora: AGORA, enviar: vi.fn() })
    expect(f.filtros).toContainEqual(['eq', 'encomenda', true])
    expect(f.filtros).toContainEqual(['is', 'encomenda_lembrete_em', null])
    expect(f.filtros).toContainEqual(['in', 'status', ['recebido', 'preparando']])
    expect(f.filtros).toContainEqual(['gt', 'agendado_para', new Date(AGORA.getTime() + H).toISOString()])
    expect(f.filtros).toContainEqual(['lte', 'agendado_para', new Date(AGORA.getTime() + 24 * H).toISOString()])
    expect(f.filtros.find((x) => x[0] === 'limit')).toEqual(['limit', 20])
  })

  it('reserva antes de enviar; sem reserva não envia; em cima da hora reserva sem enviar', async () => {
    const ag = new Date(AGORA.getTime() + 20 * H).toISOString()
    const pedidos = [
      { id: 'a', agendado_para: ag, criado_em: new Date(AGORA.getTime() - 48 * H).toISOString() },
      { id: 'b', agendado_para: ag, criado_em: new Date(AGORA.getTime() - 48 * H).toISOString() },
      { id: 'c', agendado_para: new Date(AGORA.getTime() + 5 * H).toISOString(), criado_em: new Date(AGORA.getTime() - 1 * H).toISOString() },
    ]
    const enviar = vi.fn(async () => true)
    const f = fake(pedidos, (id) => id !== 'b')
    const r = await enviarLembretesEncomenda(f.admin, { agora: AGORA, enviar })
    expect(f.reservados).toEqual(['a', 'c'])
    expect(enviar).toHaveBeenCalledTimes(1)
    expect(enviar).toHaveBeenCalledWith('a')
    expect(r).toEqual({ enviados: 1, pulados: 2 })
  })

  it('falha no envio de um não para os outros', async () => {
    const ag = new Date(AGORA.getTime() + 20 * H).toISOString()
    const criado = new Date(AGORA.getTime() - 48 * H).toISOString()
    const enviar = vi.fn(async (id: string) => { if (id === 'a') throw new Error('Evolution caiu'); return true })
    const f = fake([{ id: 'a', agendado_para: ag, criado_em: criado }, { id: 'b', agendado_para: ag, criado_em: criado }], () => true)
    const r = await enviarLembretesEncomenda(f.admin, { agora: AGORA, enviar })
    expect(enviar).toHaveBeenCalledTimes(2)
    expect(r.enviados).toBe(1)
  })
})
