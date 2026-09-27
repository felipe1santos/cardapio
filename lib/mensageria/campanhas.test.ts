import { describe, expect, it } from 'vitest'
import { acessoDeRobo, deduplicarDestinatarios, linkRastreavel, montarTextoCampanha, statusDoProvedor, telefoneChave } from './campanhas'
import { interpretarWebhookEvolution } from './provedor'

const TOKEN = 'a1b2c3d4e5f6a1b2c3d4e5f6'

describe('link rastreável', () => {
  it('link não leva dado do cliente, só o token', () => {
    expect(linkRastreavel(TOKEN)).toBe(`https://app.menuzia.com.br/c/${TOKEN}`)
  })

  it('troca {link} (todas as ocorrências) ou acrescenta no fim', () => {
    expect(montarTextoCampanha('Peça: {link} ou {link}', { incluirLink: true, token: TOKEN }))
      .toBe(`Peça: ${linkRastreavel(TOKEN)} ou ${linkRastreavel(TOKEN)}`)
    expect(montarTextoCampanha('Promoção hoje!  ', { incluirLink: true, token: TOKEN }))
      .toBe(`Promoção hoje!\n\n👉 Peça pelo cardápio: ${linkRastreavel(TOKEN)}`)
    expect(montarTextoCampanha('', { incluirLink: true, token: TOKEN })).toBe(linkRastreavel(TOKEN))
  })

  it('link desligado, token ausente ou inválido: mensagem exatamente como a loja escreveu', () => {
    expect(montarTextoCampanha('Oi {link}', { incluirLink: false, token: TOKEN })).toBe('Oi {link}')
    expect(montarTextoCampanha('Oi', { incluirLink: true, token: null })).toBe('Oi')
    expect(montarTextoCampanha('Oi', { incluirLink: true, token: '../admin' })).toBe('Oi')
  })
})

describe('telefone normalizado', () => {
  it('com/sem 55 e com/sem o 9 dão a mesma chave', () => {
    const k = telefoneChave('5527999887766')
    expect(k).toBe('2799887766')
    expect(telefoneChave('27999887766')).toBe(k)
    expect(telefoneChave('552799887766')).toBe(k)
    expect(telefoneChave('(27) 9 9988-7766')).toBe(k)
  })

  it('DDD 55 (Santa Maria) não é confundido com o DDI', () => {
    expect(telefoneChave('55999887766')).toBe('5599887766')
    expect(telefoneChave('5555999887766')).toBe('5599887766')
  })

  it('outro tamanho não vira chave', () => {
    expect(telefoneChave('123')).toBeNull()
    expect(telefoneChave('55279950921011')).toBeNull()
    expect(telefoneChave(null)).toBeNull()
  })

  it('deduplica destinatários pelo telefone normalizado', () => {
    const r = deduplicarDestinatarios([
      { telefone: '5527999887766', nome: 'A' },
      { telefone: '27999887766', nome: 'A de novo' },
      { telefone: '552799887766', nome: 'A sem 9' },
      { telefone: '5527988887777', nome: 'B' },
    ])
    expect(r.unicos.map((d) => d.nome)).toEqual(['A', 'B'])
    expect(r.repetidos).toBe(2)
  })
})

describe('status do provedor', () => {
  it('entrega e leitura; o resto não interessa', () => {
    expect(statusDoProvedor('DELIVERY_ACK')).toBe('entregue')
    expect(statusDoProvedor('READ')).toBe('lido')
    expect(statusDoProvedor('PLAYED')).toBe('lido')
    expect(statusDoProvedor(3)).toBe('entregue')
    expect(statusDoProvedor(4)).toBe('lido')
    expect(statusDoProvedor('SERVER_ACK')).toBeNull()
    expect(statusDoProvedor('ERROR')).toBeNull()
    expect(statusDoProvedor(undefined)).toBeNull()
  })

  it('webhook messages.update nos dois formatos; mensagem recebida (fromMe=false) fica de fora', () => {
    const v2 = interpretarWebhookEvolution({ event: 'messages.update', instance: 'loja', data: { keyId: 'ABC', remoteJid: '5527999887766@s.whatsapp.net', fromMe: true, status: 'READ' } })
    expect(v2.atualizacoes).toEqual([{ waId: 'ABC', status: 'READ' }])
    expect(v2.mensagens).toEqual([])
    const baileys = interpretarWebhookEvolution({ event: 'MESSAGES_UPDATE', data: [{ key: { id: 'X1', fromMe: true }, update: { status: 3 } }, { key: { id: 'X2', fromMe: false }, update: { status: 4 } }] })
    expect(baileys.atualizacoes).toEqual([{ waId: 'X1', status: 3 }])
    const upsert = interpretarWebhookEvolution({ event: 'messages.upsert', data: { key: { remoteJid: '5527999887766@s.whatsapp.net', id: 'M1' }, message: { conversation: 'oi' } } })
    expect(upsert.atualizacoes).toEqual([])
    expect(upsert.mensagens).toHaveLength(1)
  })
})

describe('clique de robô', () => {
  it('pré-visualização e ferramentas não contam; navegador conta', () => {
    expect(acessoDeRobo('WhatsApp/2.23.20.0 A')).toBe(true)
    expect(acessoDeRobo('facebookexternalhit/1.1')).toBe(true)
    expect(acessoDeRobo('curl/8.0')).toBe(true)
    expect(acessoDeRobo('')).toBe(true)
    expect(acessoDeRobo(null)).toBe(true)
    expect(acessoDeRobo('Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36')).toBe(false)
    expect(acessoDeRobo('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe(false)
  })
})
