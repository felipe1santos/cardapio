import { describe, expect, it } from 'vitest'
import { confirmacaoDireta, mensagensDaResposta, textosDoClienteDesdeALoja } from './atender'

describe('um resumo só por confirmação (#287)', () => {
  it('servidor mandou o resumo: o "Seu pedido está montado… Posso confirmar?" da IA não vai junto', () => {
    const r = mensagensDaResposta({ resumo: '*🧾 RESUMO DO PEDIDO*\n…\n> Responda *sim*' }, 'Seu pedido está montado: 1x Item 3, total R$ 25,00. Posso confirmar?')
    expect(r).toEqual(['*🧾 RESUMO DO PEDIDO*\n…\n> Responda *sim*'])
  })
  it('troca de pagamento / atendente: só a frase do servidor', () => {
    expect(mensagensDaResposta({ mensagens: ['Pronto! Troquei para *Cartão na entrega*'] }, 'Beleza, troquei!')).toEqual(['Pronto! Troquei para *Cartão na entrega*'])
  })
  it('sem nada do servidor: o texto da IA (sem cabeçalho)', () => {
    expect(mensagensDaResposta({}, 'Show! Vai querer mais alguma coisa?')).toEqual(['Show! Vai querer mais alguma coisa?'])
    expect(mensagensDaResposta({}, '  ')).toEqual([])
  })
})

describe('"sim" depois do resumo cria o pedido no servidor, sem depender da IA (teste real 12/10)', () => {
  const resumoEm = '2026-10-12T04:21:36.629Z'
  it('confirmação clara, posterior ao resumo, com carrinho → cria direto', () => {
    expect(confirmacaoDireta({ texto: 'Sim', em: '2026-10-12T04:22:00.848Z', resumoEm, temCarrinho: true })).toBe(true)
    expect(confirmacaoDireta({ texto: 'pode mandar', em: '2026-10-12T04:22:00.848Z', resumoEm, temCarrinho: true })).toBe(true)
  })
  it('sem resumo, sem carrinho, antes do resumo ou não é confirmação → vai para a IA', () => {
    expect(confirmacaoDireta({ texto: 'Sim', em: '2026-10-12T04:22:00Z', resumoEm: null, temCarrinho: true })).toBe(false)
    expect(confirmacaoDireta({ texto: 'Sim', em: '2026-10-12T04:22:00Z', resumoEm, temCarrinho: false })).toBe(false)
    expect(confirmacaoDireta({ texto: 'Sim', em: '2026-10-12T04:20:00Z', resumoEm, temCarrinho: true })).toBe(false)
    expect(confirmacaoDireta({ texto: 'sim, mas troca pra dinheiro', em: '2026-10-12T04:22:00Z', resumoEm, temCarrinho: true })).toBe(false)
  })
})

describe('pedido em andamento: pergunta do servidor e mensagens seguidas (12/10, teste 19:36)', () => {
  it('a pergunta do servidor vai sozinha; da IA só uma frase curta sem pergunta', () => {
    expect(mensagensDaResposta({ pergunta: 'Como prefere pagar?\n💠 Pix' }, 'Entrega ou retirada? E o pagamento?')).toEqual(['Como prefere pagar?\n💠 Pix'])
    expect(mensagensDaResposta({ pergunta: 'Como prefere pagar?\n💠 Pix' }, 'Show, anotei o endereço 📍')).toEqual(['Show, anotei o endereço 📍', 'Como prefere pagar?\n💠 Pix'])
  })
  it('todas as mensagens do cliente desde a última da loja, na ordem', () => {
    const h = (id: string, direcao: 'entrada' | 'loja', texto: string) => ({ id, direcao, origem: 'x', tipo: 'texto', texto, criadoEm: '2026-10-12T22:38:00Z' })
    expect(textosDoClienteDesdeALoja([h('1', 'entrada', '1 234'), h('2', 'loja', 'Quer frutas?'), h('3', 'entrada', 'Nenhum fruta extra...'), h('4', 'entrada', 'Fica quanto')]))
      .toEqual(['Nenhum fruta extra...', 'Fica quanto'])
  })
})
