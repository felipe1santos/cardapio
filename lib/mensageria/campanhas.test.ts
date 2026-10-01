import { describe, expect, it } from 'vitest'
import { acessoDeRobo, deduplicarDestinatarios, linkRastreavel, montarTextoCampanha, paraCampoDataHora, problemasDasVariaveis, progressoCampanha, situacaoCampanha, statusDoProvedor, telefoneChave } from './campanhas'
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

describe('horário agendado no formulário', () => {
  it('reabrir e salvar sem mexer não muda o horário (campo datetime-local é hora local)', () => {
    const tzAntes = process.env.TZ
    process.env.TZ = 'America/Sao_Paulo'
    try {
      const agendado = '2026-09-30T23:00:00.000Z' // 20:00 em São Paulo
      const campo = paraCampoDataHora(agendado)
      expect(campo).toBe('2026-09-30T20:00')
      // salvar() faz new Date(campo).toISOString(): tem de voltar ao mesmo instante.
      expect(new Date(campo).toISOString()).toBe(agendado)
    } finally {
      if (tzAntes === undefined) delete process.env.TZ
      else process.env.TZ = tzAntes
    }
  })

  it('vazio ou inválido vira campo vazio', () => {
    expect(paraCampoDataHora(null)).toBe('')
    expect(paraCampoDataHora('lixo')).toBe('')
  })
})

describe('público da campanha: telefone inválido', () => {
  it('fica fora da fila e é contado à parte (não vira "falha" no envio)', () => {
    const r = deduplicarDestinatarios([
      { telefone: '5511912340101' },
      { telefone: '11912340101' },
      { telefone: '123' },
      { telefone: '5511912340102999' },
      { telefone: '' },
      { telefone: '5511912340103' },
    ])
    expect(r.unicos.map((d) => d.telefone)).toEqual(['5511912340101', '5511912340103'])
    expect(r.repetidos).toBe(1)
    expect(r.invalidos).toBe(3)
  })
})

describe('variáveis da mensagem', () => {
  it('{nome} vira o primeiro nome; sem nome, "cliente"', () => {
    expect(montarTextoCampanha('Oi {nome}!', { incluirLink: false, token: null, nome: 'MARIA  da silva' })).toBe('Oi Maria!')
    expect(montarTextoCampanha('Oi {nome}!', { incluirLink: false, token: null, nome: '  ' })).toBe('Oi cliente!')
    expect(montarTextoCampanha('Oi {nome}!', { incluirLink: false, token: null, nome: '😀' })).toBe('Oi cliente!')
  })

  it('variável desconhecida bloqueia; {link} sem o link ligado também', () => {
    expect(problemasDasVariaveis('Oi {Nome}, use {cupom}', { incluirLink: true })).toMatch(/Variável desconhecida: \{Nome\}, \{cupom\}/)
    expect(problemasDasVariaveis('Peça: {link}', { incluirLink: false })).toMatch(/Incluir link/)
    expect(problemasDasVariaveis('Oi {nome}, peça: {link}', { incluirLink: true })).toBeNull()
    expect(problemasDasVariaveis('Sem variável nenhuma', { incluirLink: false })).toBeNull()
  })

  it('rodapé do descadastro fecha a mensagem (depois do link)', () => {
    const t = montarTextoCampanha('Promo!', { incluirLink: true, token: TOKEN, incluirDescadastro: true })
    expect(t).toBe(`Promo!\n\n👉 Peça pelo cardápio: ${linkRastreavel(TOKEN)}\n\nPara não receber mais, responda SAIR.`)
    expect(montarTextoCampanha('Promo!', { incluirLink: false, token: null, incluirDescadastro: false })).toBe('Promo!')
  })
})

describe('situação e progresso da campanha', () => {
  it('"Concluída" com 0 enviados é "Falhou" (caso SDAASD)', () => {
    expect(situacaoCampanha({ status: 'concluida', totalEnviados: 0, totalErros: 4 })).toBe('falhou')
    expect(situacaoCampanha({ status: 'concluida', totalEnviados: 3, totalErros: 1 })).toBe('concluida_com_falhas')
    expect(situacaoCampanha({ status: 'concluida', totalEnviados: 4, totalErros: 0 })).toBe('concluida')
    expect(situacaoCampanha({ status: 'pausada', totalEnviados: 1, totalErros: 0 })).toBe('pausada')
  })

  it('barra separa enviados, falhas e restantes', () => {
    expect(progressoCampanha({ totalDestinatarios: 4, totalEnviados: 0, totalErros: 4 })).toEqual({ total: 4, enviados: 0, falhas: 4, restantes: 0 })
    expect(progressoCampanha({ totalDestinatarios: 10, totalEnviados: 3, totalErros: 1 })).toEqual({ total: 10, enviados: 3, falhas: 1, restantes: 6 })
  })
})

describe('botões da campanha (Fase 4)', () => {
  it('valida: máx. 2, texto até 20, link https', async () => {
    const { validarBotoes } = await import('./campanhas')
    expect(validarBotoes(undefined)).toEqual({ ok: true, botoes: [] })
    expect(validarBotoes([{ texto: 'Ver cardápio', url: 'https://app.menuzia.com.br/loja/x' }])).toMatchObject({ ok: true })
    expect(validarBotoes([{ texto: 'A', url: 'https://a.com' }, { texto: 'B', url: 'https://b.com' }, { texto: 'C', url: 'https://c.com' }])).toMatchObject({ ok: false })
    expect(validarBotoes([{ texto: 'x'.repeat(21), url: 'https://a.com' }])).toMatchObject({ ok: false })
    expect(validarBotoes([{ texto: 'Site', url: 'http://a.com' }])).toMatchObject({ ok: false, erro: expect.stringMatching(/https/) })
    expect(validarBotoes([{ texto: 'Site', url: 'javascript:alert(1)' }])).toMatchObject({ ok: false })
    expect(validarBotoes([{ texto: '', url: '' }])).toEqual({ ok: true, botoes: [] })
  })
  it('saem como links no texto, um por linha, antes do rodapé do SAIR', async () => {
    const { montarTextoCampanha } = await import('./campanhas')
    const t = montarTextoCampanha('Promo hoje!', { incluirLink: false, token: null, incluirDescadastro: true, botoes: [{ texto: 'Ver cardápio', url: 'https://app.menuzia.com.br/loja/x' }, { texto: 'Pegar cupom', url: 'https://app.menuzia.com.br/c/1' }] })
    expect(t).toBe('Promo hoje!\n\n👉 Ver cardápio: https://app.menuzia.com.br/loja/x\n👉 Pegar cupom: https://app.menuzia.com.br/c/1\n\nPara não receber mais, responda SAIR.')
  })
  it('campanha antiga (sem botões) sai igual', async () => {
    const { montarTextoCampanha } = await import('./campanhas')
    expect(montarTextoCampanha('Oi', { incluirLink: false, token: null })).toBe('Oi')
  })
})
