import { describe, expect, it } from 'vitest'
import { interpretarWebhookEvolution } from './provedor'

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
