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

  it('sessão (ping, travar, PIN) tem retorno próprio na tela travada', () => {
    for (const r of ['/api/sessao/ping', '/api/sessao/sair', '/api/sessao/desbloquear', '/api/sessao/pin-entrar', '/api/admin/financeiro/caixa']) expect(ehGravacaoDoUsuario('POST', r, 0)).toBe(false)
  })

  it('a central de atendimento do WhatsApp tem retorno próprio (sem "Salvando…" por mensagem)', () => {
    expect(ehGravacaoDoUsuario('POST', '/api/admin/whatsapp/atendimento/conversas/7b1f/mensagens', 0)).toBe(false)
    expect(ehGravacaoDoUsuario('POST', '/api/admin/whatsapp/atendimento/tags', 0)).toBe(false)
    // O resto do WhatsApp (ligar o robô) continua contando.
    expect(ehGravacaoDoUsuario('PUT', '/api/admin/whatsapp/robo', 0)).toBe(true)
  })

  it('efeitos colaterais do clique não são o "salvar" (aviso de WhatsApp, cotação do Nexta)', () => {
    // Atribuir motoboy grava o pedido e, no mesmo tick, dispara o aviso ao cliente e
    // recota o Nexta. Se o WhatsApp da loja cai ou a cotação falha, o pedido FOI salvo —
    // o indicador não pode dizer "Não foi possível salvar".
    expect(ehGravacaoDoUsuario('POST', '/api/pedidos/7b1f/notificar', 0)).toBe(false)
    expect(ehGravacaoDoUsuario('POST', '/api/admin/nexta/cotacao', 0)).toBe(false)
    // A gravação de verdade continua contando.
    expect(ehGravacaoDoUsuario('PATCH', `${SB}/rest/v1/pedidos?id=eq.1`, 0)).toBe(true)
    expect(ehGravacaoDoUsuario('POST', '/api/admin/nexta/despachar', 0)).toBe(true)
  })

  it('outro domínio qualquer não conta', () => {
    expect(ehGravacaoDoUsuario('POST', 'https://www.google-analytics.com/g/collect', 100)).toBe(false)
  })
})
