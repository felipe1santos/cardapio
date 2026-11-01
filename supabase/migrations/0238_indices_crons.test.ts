import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 01/11/2026 (Fase 6): índices para as consultas que rodam todo minuto nos crons e a cada mensagem do robô, e para as
 * FKs de `pedidos` que o rollback de pedido varre. Hoje as tabelas são pequenas (1 ms); com 50 mil pedidos cada
 * varredura vira 30 ms × 1.440/dia por rotina.
 */
const sql = readFileSync('supabase/migrations/0238_indices_crons.sql', 'utf8')

describe('0238 índices dos crons', () => {
  it('só cria se não existir (reaplicável)', () => {
    expect(sql).toMatch(/create index/i)
    expect(sql.match(/create index/gi)!.length).toBe(sql.match(/create index if not exists/gi)!.length)
  })
  it('Pix do parceiro aguardando (cron 1/min, todas as lojas)', () => {
    expect(sql).toMatch(/on public\.pedidos \(\(parceiro_pix->>'desde'\)\) where \(parceiro_pix->>'estado'\) = 'aguardando' and pago = false/)
  })
  it('corridas ativas dos parceiros (cron 1/min)', () => {
    expect(sql).toMatch(/on public\.entregas_provedor \(atualizado_em\) where status in \('ASSIGNING_DRIVER', 'ON_GOING', 'PICKED_UP'\)/)
  })
  it('pedidos por telefone (robô/IA a cada mensagem; vitrine na aba Pedidos)', () => {
    expect(sql).toMatch(/on public\.pedidos \(restaurante_id, cliente_telefone, criado_em desc\)/)
  })
  it('FKs de pedidos que o rollback varre', () => {
    for (const t of ['whatsapp_envios', 'push_envios', 'pedido_itens_custo', 'cupom_usos']) expect(sql).toMatch(new RegExp(`on public\\.${t} \\(pedido_id\\)`))
  })
})
