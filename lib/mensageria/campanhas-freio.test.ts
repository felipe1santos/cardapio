import { describe, expect, it, vi } from 'vitest'

const alertas: { tipo: string; mensagem: string }[] = []
vi.mock('@/lib/financeiro/alertas', () => ({ criarAlerta: vi.fn(async (_a: unknown, x: { tipo: string; mensagem: string }) => { alertas.push(x); return 'id' }) }))
vi.mock('@/lib/modulos', () => ({ moduloLiberado: vi.fn(async () => true) }))
vi.mock('./historico', () => ({ registrarSaida: vi.fn(async () => ({ mensagemId: 'm' })), concluirSaida: vi.fn(async () => {}) }))

import { processarCampanhas } from './campanhas-envio'
import type { ProvedorWhatsapp } from './provedor'

/** Supabase falso: guarda os updates em `campanhas` e responde às RPCs da fila. */
function cenario(o: { conexao: 'aberto' | 'fechado'; freio?: { enviados: number; erros: number; sair: number }; ativas?: { id: string; status: string; pausa_motivo?: string | null }[] }) {
  const updates: { tabela: string; dados: Record<string, unknown> }[] = []
  const envio = { id: 'e1', campanha_id: 'c1', restaurante_id: 'L', telefone: '27999990001', nome_cliente: 'Ana', token: null, tipo_mensagem: 'texto', mensagem: 'Oi {nome}', imagem_url: null, audio_url: null, incluir_link: false, evolution_instance: 'inst', slug: 'menuzia', incluir_descadastro: true, ultimo_item: null, nome_loja: 'Menuzia' }
  const chain = (tabela: string, dados?: Record<string, unknown>) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'in', 'lte', 'eq', 'neq', 'not', 'order', 'limit']) b[m] = () => b
    b.maybeSingle = async () => ({ data: dados ? { restaurante_id: 'L', nome: 'Campanha teste' } : null })
    b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabela === 'campanhas' && !dados ? (o.ativas ?? []).map((c) => ({ ...c, restaurante_id: 'L', restaurantes: { evolution_instance: 'inst' } })) : [], error: null }).then(ok)
    return b
  }
  const admin = {
    from: (t: string) => ({
      select: () => chain(t),
      update: (d: Record<string, unknown>) => { updates.push({ tabela: t, dados: d }); return chain(t, d) },
    }),
    rpc: async (nome: string) => {
      if (nome === 'campanha_reservar_envios') return { data: o.conexao === 'aberto' ? [envio] : [], error: null }
      if (nome === 'campanha_concluir_envio') return { data: 'enviado', error: null }
      if (nome === 'campanha_freio_numeros') return { data: [o.freio ?? { enviados: 1, erros: 0, sair: 0 }], error: null }
      return { data: null, error: null }
    },
  }
  const enviados: string[] = []
  const provedor = {
    conexao: async () => o.conexao,
    enviarTexto: async (_i: string, _n: string, texto: string) => { enviados.push(texto); return { ok: true as const, idExterno: 'x' } },
  } as unknown as ProvedorWhatsapp
  return { admin: admin as never, provedor, updates, enviados }
}

describe('freio automático das campanhas', () => {
  it('WhatsApp desconectado: a campanha ativa é pausada (motivo whatsapp_desconectado) e nada sai', async () => {
    const s = cenario({ conexao: 'fechado', ativas: [{ id: 'c1', status: 'enviando' }] })
    const r = await processarCampanhas(s.admin, s.provedor, { limite: 5, intervalo: () => 0 })
    expect(r.campanhasPausadas).toBe(1)
    expect(s.updates.some((u) => u.tabela === 'campanhas' && u.dados.status === 'pausada' && u.dados.pausa_motivo === 'whatsapp_desconectado')).toBe(true)
    expect(s.enviados).toEqual([])
  })
  it('erro acima de 5%: pausa pelo freio e avisa a loja', async () => {
    alertas.length = 0
    const s = cenario({ conexao: 'aberto', freio: { enviados: 30, erros: 3, sair: 0 } })
    await processarCampanhas(s.admin, s.provedor, { limite: 5, intervalo: () => 0 })
    expect(s.updates.some((u) => u.tabela === 'campanhas' && u.dados.status === 'pausada' && u.dados.pausa_motivo === 'erro_alto')).toBe(true)
    expect(alertas[0]?.tipo).toBe('campanha_pausada')
    // A mensagem enviada leva o rodapé obrigatório.
    expect(s.enviados[0]).toMatch(/^Oi Ana\n\nResponda SAIR para não receber mais\.$/)
  })
  it('SAIR acima de 3%: pausa pelo freio', async () => {
    const s = cenario({ conexao: 'aberto', freio: { enviados: 40, erros: 0, sair: 2 } })
    await processarCampanhas(s.admin, s.provedor, { limite: 5, intervalo: () => 0 })
    expect(s.updates.some((u) => u.dados.pausa_motivo === 'sair_alto')).toBe(true)
  })
  it('pausa manual ou do freio NÃO volta sozinha quando a conexão está boa', async () => {
    const s = cenario({ conexao: 'aberto', ativas: [{ id: 'c9', status: 'pausada', pausa_motivo: 'manual' }] })
    const r = await processarCampanhas(s.admin, s.provedor, { limite: 5, intervalo: () => 0 })
    expect(r.campanhasRetomadas).toBe(0)
  })
})
