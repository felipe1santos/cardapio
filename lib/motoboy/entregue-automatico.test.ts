import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/queries/pedidos', () => ({ atribuirEntregadorEmLoteSeguro: vi.fn() }))
vi.mock('@/lib/pedido-eventos', () => ({ aplicarEfeitosStatusPedidoComTrava: vi.fn() }))
vi.mock('@/lib/auditoria', () => ({ registrarAuditoria: vi.fn(async () => undefined) }))
vi.mock('@/lib/fidelidade', () => ({ processarFidelidadePedidoEntregue: vi.fn(async () => undefined) }))
import type { SupabaseClient } from '@supabase/supabase-js'
import { ENTREGUE_AUTOMATICO_MS, marcarEntreguesAutomaticos } from './despacho-automatico'

/**
 * "Entregue automático" com o relógio injetado (auditoria 09/10): o banco de verdade é trocado por
 * uma tabela em memória que entende os mesmos filtros que a função usa (eq/not/lt/limit e o update
 * condicionado a status = em_rota). O dinheiro (pendência do motoboy) é do gatilho do banco e foi
 * testado à parte, em produção, dentro de uma transação desfeita (.medidas/fin/28-entregue-auto.mjs).
 */
type Pedido = { id: string; numero: number; restaurante_id: string; entregador_id: string | null; em_rota_em: string | null; status: string; entregue_automatico?: boolean }

function bancoFalso(pedidos: Pedido[]) {
  const updates: string[] = []
  const admin = {
    from: () => {
      const filtros: ((p: Pedido) => boolean)[] = []
      let patch: Partial<Pedido> | null = null
      const q = {
        select: () => q,
        update: (v: Partial<Pedido>) => { patch = v; return q },
        eq: (c: keyof Pedido, v: unknown) => { filtros.push((p) => p[c] === v); return q },
        not: (c: keyof Pedido, op: string, v: unknown) => { filtros.push((p) => !(op === 'is' && v === null ? p[c] === null : p[c] === v)); return q },
        lt: (c: keyof Pedido, v: string) => { filtros.push((p) => p[c] !== null && String(p[c]) < v); return q },
        limit: () => q,
        then: (ok: (r: { data: unknown }) => unknown) => {
          const alvo = pedidos.filter((p) => filtros.every((f) => f(p)))
          if (patch) { for (const p of alvo) { Object.assign(p, patch); updates.push(p.id) } return Promise.resolve(ok({ data: alvo.map((p) => ({ id: p.id })) })) }
          return Promise.resolve(ok({ data: alvo.map((p) => ({ ...p })) }))
        },
      }
      return q
    },
  } as unknown as SupabaseClient
  return { admin, updates }
}

const T0 = new Date('2026-10-09T20:00:00Z').getTime()
const saiu = (minAtras: number) => new Date(T0 - minAtras * 60_000).toISOString()
const ped = (id: string, minAtras: number, status = 'em_rota', entregador: string | null = 'moto-1'): Pedido =>
  ({ id, numero: Number(id.replace(/\D/g, '')) || 1, restaurante_id: 'loja', entregador_id: entregador, em_rota_em: saiu(minAtras), status })

describe('entregue automático em 1h30 (relógio injetado)', () => {
  it('o limite é 90 minutos', () => { expect(ENTREGUE_AUTOMATICO_MS).toBe(90 * 60_000) })

  it('aos 89 min não marca; passou de 90 min marca', async () => {
    const p89 = ped('p89', 89), p90 = ped('p90', 90.01)
    const { admin } = bancoFalso([p89, p90])
    expect(await marcarEntreguesAutomaticos(admin, T0)).toBe(1)
    expect(p89.status).toBe('em_rota')
    expect(p90).toMatchObject({ status: 'entregue', entregue_automatico: true })
  })

  it('o mesmo pedido de 89 min é marcado quando o relógio anda 1 min', async () => {
    const p = ped('p1', 89)
    const { admin } = bancoFalso([p])
    expect(await marcarEntreguesAutomaticos(admin, T0)).toBe(0)
    expect(await marcarEntreguesAutomaticos(admin, T0 + 61_000)).toBe(1)
    expect(p.status).toBe('entregue')
  })

  it('"Não entregue", cancelado, já entregue ou sem motoboy: não mexe', async () => {
    const lista = [ped('n1', 200, 'cancelado'), ped('n2', 200, 'entregue'), ped('n3', 200, 'pronto'), ped('n4', 200, 'em_rota', null)]
    const antes = lista.map((p) => p.status)
    const { admin, updates } = bancoFalso(lista)
    expect(await marcarEntreguesAutomaticos(admin, T0)).toBe(0)
    expect(lista.map((p) => p.status)).toEqual(antes)
    expect(updates).toEqual([])
  })

  it('rodar 2 vezes (dois crons ao mesmo tempo) não marca em dobro', async () => {
    const p = ped('p2', 120)
    const { admin, updates } = bancoFalso([p])
    const [a, b] = await Promise.all([marcarEntreguesAutomaticos(admin, T0), marcarEntreguesAutomaticos(admin, T0)])
    expect(a + b).toBe(1)
    expect(await marcarEntreguesAutomaticos(admin, T0 + 60_000)).toBe(0)
    expect(updates).toEqual(['p2'])
  })
})
