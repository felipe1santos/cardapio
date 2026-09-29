import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ehSaidaNossa, hashTexto } from './historico'

/** Conversas e mensagens em memória, com os filtros eq/in/neq/gte que ehSaidaNossa usa. */
function bancoFalso(tabelas: Record<string, Record<string, unknown>[]>): SupabaseClient {
  const from = (tabela: string) => {
    const filtros: ((l: Record<string, unknown>) => boolean)[] = []
    const b: Record<string, unknown> = {
      select: () => b,
      limit: () => b,
      eq: (k: string, v: unknown) => { filtros.push((l) => l[k] === v); return b },
      neq: (k: string, v: unknown) => { filtros.push((l) => l[k] !== v); return b },
      in: (k: string, vs: unknown[]) => { filtros.push((l) => vs.includes(l[k])); return b },
      gte: (k: string, v: string) => { filtros.push((l) => String(l[k]) >= v); return b },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: (tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l))), error: null }).then(ok),
    }
    return b
  }
  return { from } as unknown as SupabaseClient
}

describe('ehSaidaNossa — eco de mensagem que a Menuzia mandou', () => {
  it('reconhece o eco quando o WhatsApp informa o número SEM o 9 (saída gravada com o 9)', async () => {
    const texto = 'Seu pedido #12 foi aceito!'
    const banco = bancoFalso({
      whatsapp_conversas: [{ id: 'conv-13', restaurante_id: 'r1', telefone: '5531912340701' }],
      whatsapp_mensagens: [{
        id: 'm1', restaurante_id: 'r1', conversa_id: 'conv-13', wa_id: 'local:x', origem: 'automatico',
        texto_hash: await hashTexto(texto), criado_em: new Date().toISOString(),
      }],
    })
    expect(await ehSaidaNossa(banco, 'r1', '553112340701', 'WAID-ECO', texto)).toBe(true)
  })

  it('texto diferente não é eco', async () => {
    const banco = bancoFalso({
      whatsapp_conversas: [{ id: 'conv-13', restaurante_id: 'r1', telefone: '5531912340701' }],
      whatsapp_mensagens: [{ id: 'm1', restaurante_id: 'r1', conversa_id: 'conv-13', wa_id: 'local:x', origem: 'automatico', texto_hash: await hashTexto('outro'), criado_em: new Date().toISOString() }],
    })
    expect(await ehSaidaNossa(banco, 'r1', '553112340701', 'WAID', 'Oi, tudo bem?')).toBe(false)
  })

  it('conversa de outra loja não conta', async () => {
    const texto = 'Seu pedido #12 foi aceito!'
    const banco = bancoFalso({
      whatsapp_conversas: [{ id: 'conv-b', restaurante_id: 'r2', telefone: '5531912340701' }],
      whatsapp_mensagens: [{ id: 'm1', restaurante_id: 'r2', conversa_id: 'conv-b', wa_id: 'local:x', origem: 'automatico', texto_hash: await hashTexto(texto), criado_em: new Date().toISOString() }],
    })
    expect(await ehSaidaNossa(banco, 'r1', '553112340701', 'WAID', texto)).toBe(false)
  })
})
