import { describe, expect, it } from 'vitest'
import { interpretarWebhookEvolution } from './provedor'

/** Achado #10 da auditoria (25/10): o sistema não recebia o evento de conexão — nunca sabia por que o WhatsApp caiu. */
describe('webhook: evento de conexão (connection.update)', () => {
  it('lê o estado e o motivo (statusReason) da Evolution', () => {
    const e = interpretarWebhookEvolution({ event: 'connection.update', instance: 'loja-x', data: { instance: 'loja-x', state: 'close', statusReason: 401 } })
    expect(e.conexao).toEqual({ estado: 'close', motivo: 401 })
    expect(e.mensagens).toEqual([])
  })
  it('aceita o nome do evento em maiúsculas (CONNECTION_UPDATE)', () => {
    expect(interpretarWebhookEvolution({ event: 'CONNECTION_UPDATE', instance: 'x', data: { state: 'open' } }).conexao).toEqual({ estado: 'open', motivo: null })
  })
  it('estado desconhecido não vira conexão', () => {
    expect(interpretarWebhookEvolution({ event: 'connection.update', data: { state: 'qualquer' } }).conexao).toBeUndefined()
  })
  it('evento de mensagem não traz conexão', () => {
    expect(interpretarWebhookEvolution({ event: 'messages.upsert', data: {} }).conexao).toBeUndefined()
  })
})

const upsert = (message: Record<string, unknown>, messageType?: string) => ({
  event: 'messages.upsert', instance: 'loja',
  data: { key: { remoteJid: '5527999887766@s.whatsapp.net', fromMe: false, id: `ID${Math.random()}` }, message, messageType, messageTimestamp: 1700000000 },
})

describe('webhook: eventos sem conteúdo não viram mensagem', () => {
  it('reação, edição, apagada e voto de enquete são ignorados', () => {
    expect(interpretarWebhookEvolution(upsert({ reactionMessage: { text: '👍', key: { id: 'X' } } }, 'reactionMessage')).mensagens).toHaveLength(0)
    expect(interpretarWebhookEvolution(upsert({ protocolMessage: { type: 0, key: { id: 'X' } } })).mensagens).toHaveLength(0)
    expect(interpretarWebhookEvolution(upsert({ editedMessage: { message: { conversation: 'oi' } } })).mensagens).toHaveLength(0)
    expect(interpretarWebhookEvolution(upsert({ pollUpdateMessage: {} })).mensagens).toHaveLength(0)
  })

  it('texto, foto e áudio continuam chegando', () => {
    expect(interpretarWebhookEvolution(upsert({ conversation: 'quero pedir' })).mensagens[0]).toMatchObject({ tipo: 'texto', texto: 'quero pedir' })
    expect(interpretarWebhookEvolution(upsert({ imageMessage: {} })).mensagens[0]).toMatchObject({ tipo: 'imagem' })
    expect(interpretarWebhookEvolution(upsert({ audioMessage: {} })).mensagens[0]).toMatchObject({ tipo: 'audio' })
  })
})
