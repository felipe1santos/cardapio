import { describe, expect, it } from 'vitest'
import { mensagensDaResposta } from './atender'

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
