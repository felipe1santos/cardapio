import { describe, expect, it } from 'vitest'
import { ehGravacaoDoUsuario, JANELA_GESTO_MS } from './indicador-salvar'

const SB = 'https://abc.supabase.co'

describe('ehGravacaoDoUsuario', () => {
  it('conta escrita no PostgREST, upload e API do painel logo após um clique', () => {
    expect(ehGravacaoDoUsuario('PATCH', `${SB}/rest/v1/itens_cardapio?id=eq.1`, 100)).toBe(true)
    expect(ehGravacaoDoUsuario('POST', `${SB}/rest/v1/entregadores?select=id`, 100)).toBe(true)
    expect(ehGravacaoDoUsuario('DELETE', `${SB}/rest/v1/grupos_cardapio?id=eq.1`, 100)).toBe(true)
    expect(ehGravacaoDoUsuario('POST', `${SB}/storage/v1/object/cardapio/x.webp`, 100)).toBe(true)
    expect(ehGravacaoDoUsuario('post', '/api/admin/pedidos/1/saiu-entrega', 100)).toBe(true)
  })

  it('leitura não conta', () => {
    expect(ehGravacaoDoUsuario('GET', `${SB}/rest/v1/pedidos`, 100)).toBe(false)
    expect(ehGravacaoDoUsuario('HEAD', `${SB}/rest/v1/pedidos`, 100)).toBe(false)
  })

  it('sem gesto recente não conta (aceite automático, heartbeat, sincronização)', () => {
    expect(ehGravacaoDoUsuario('PATCH', `${SB}/rest/v1/pedidos?id=eq.1`, JANELA_GESTO_MS + 1)).toBe(false)
    expect(ehGravacaoDoUsuario('PATCH', `${SB}/rest/v1/pedidos?id=eq.1`, Number.POSITIVE_INFINITY)).toBe(false)
    expect(ehGravacaoDoUsuario('PATCH', `${SB}/rest/v1/pedidos?id=eq.1`, -5)).toBe(false)
  })

  it('RPC, auth, realtime, analytics e consulta de frete ficam de fora', () => {
    expect(ehGravacaoDoUsuario('POST', `${SB}/rest/v1/rpc/painel_analytics_vitrine`, 100)).toBe(false)
    expect(ehGravacaoDoUsuario('POST', `${SB}/auth/v1/token?grant_type=refresh_token`, 100)).toBe(false)
    expect(ehGravacaoDoUsuario('POST', '/api/loja/villa/eventos', 100)).toBe(false)
    expect(ehGravacaoDoUsuario('POST', '/api/loja/villa/frete', 100)).toBe(false)
    expect(ehGravacaoDoUsuario('POST', '/api/geo/cep', 100)).toBe(false)
  })

  it('outro domínio qualquer não conta', () => {
    expect(ehGravacaoDoUsuario('POST', 'https://www.google-analytics.com/g/collect', 100)).toBe(false)
  })
})
