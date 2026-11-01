import { describe, expect, it } from 'vitest'
import { historicoDaLoja, pedidosPorTelefone } from './motor'
import { postgrestFalso } from '@/lib/teste/postgrest-falso'

/**
 * 01/11/2026 (Fase 4): o dedup das automações de push lia `push_envios` e `pedidos` com `.limit(50000)`, mas o PostgREST
 * corta em 1.000 — loja com mais de 1.000 pedidos "esquecia" chaves já enviadas (push repetido) e clientes antigos
 * viravam "primeira compra". Agora lê de 1.000 em 1.000 (lib/queries/ler-todas.ts).
 */
describe('dedup das automações lê além de 1.000 linhas', () => {
  it('historicoDaLoja: a chave enviada na linha 1.001 continua conhecida', async () => {
    const envios = Array.from({ length: 1001 }, (_, i) => ({ destinatario: `tel${i}`, chave_dedup: `k${i}`, avulsa_id: null, origem: 'automacao', status: 'enviado', criado_em: '2026-10-20T12:00:00Z' }))
    const admin = postgrestFalso({ push_envios: envios })
    const h = await historicoDaLoja(admin, 'L1', 0)
    expect(h.chaves.get('tel1000')?.has('k1000')).toBe(true)
  })
  it('pedidosPorTelefone: cliente com o 1.001º pedido conta', async () => {
    const pedidos = Array.from({ length: 1001 }, (_, i) => ({ id: `p${i}`, cliente_telefone: `1199999${String(i).padStart(4, '0')}`, cliente_nome: 'x', criado_em: '2026-10-20T12:00:00Z' }))
    const admin = postgrestFalso({ pedidos })
    const m = await pedidosPorTelefone(admin, 'L1')
    expect(m.size).toBe(1001)
  })
})
