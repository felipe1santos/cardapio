import { describe, expect, it } from 'vitest'
import { limparTom, problemasDeTom } from './tom'

/** Tom da IA (12/10): humano, curto, sem cabeçalhos nem listas fora do resumo, sem exemplos de pedido na entrada. */
describe('tom das mensagens da IA', () => {
  it('mensagem boa: curta, natural, uma pergunta', () => {
    expect(problemasDeTom('Beleza, vamos fazer por aqui mesmo! Me diz o que você vai querer que eu anoto 😊', { entrada: true })).toEqual([])
    expect(problemasDeTom('Não temos x-tudo, Felipe. Tem o Hamburguer Supremo (R$ 33,00) ou o combo (R$ 32,30). Quer algum deles?')).toEqual([])
  })
  it('entrada com exemplo de pedido é proibida', () => {
    expect(problemasDeTom('Me diz o que você quer (ex.: 1 Hamburguer Supremo, 1 pizza calabresa)', { entrada: true })).toContain('exemplo_de_pedido')
    expect(problemasDeTom('Qual item você quer? Me diga o nome do lanche, pizza ou bebida e a quantidade.', { entrada: true })).toContain('exemplo_de_pedido')
  })
  it('cabeçalho em negrito/maiúsculas fora do resumo é proibido', () => {
    expect(problemasDeTom('*📦 SEU PEDIDO*\nVamos lá')).toContain('cabecalho')
    expect(problemasDeTom('*Cardápio de pizzas:*\nCalabresa')).toContain('cabecalho')
  })
  it('mensagem longa (> 400 caracteres) fora do resumo é proibida', () => {
    expect(problemasDeTom('a'.repeat(401))).toContain('longa')
  })
  it('12/10: lista de OPÇÕES uma por linha é a regra; lista de PERGUNTAS e mais de 1 emoji na mesma linha, não', () => {
    expect(problemasDeTom('Tem estas pizzas:\n1. 🍕 *Calabresa* `R$ 40,00`\n2. 🍕 *Mussarela* `R$ 38,00`\nQual você prefere? Pode responder o número.')).toEqual([])
    expect(problemasDeTom('Agora preciso saber:\n1. É entrega ou retirada?\n2. Forma de pagamento?')).toContain('lista')
    expect(problemasDeTom('Oba 😊🍔 vamos lá')).toContain('emojis')
  })
  it('limparTom tira lista numerada também (teste do Felipe: "1. É entrega ou retirada?")', () => {
    expect(limparTom('Agora preciso saber:\n1. É entrega ou retirada?\n2. Forma de pagamento?')).toBe('Agora preciso saber:\nÉ entrega ou retirada?\nForma de pagamento?')
  })
  it('limparTom tira linhas que são só cabeçalho e marcadores de lista, mantendo o conteúdo', () => {
    expect(limparTom('*🍕 PIZZAS*\n- Calabresa R$ 40,00\n- Mussarela R$ 38,00\nQual você prefere?')).toBe('Calabresa R$ 40,00\nMussarela R$ 38,00\nQual você prefere?')
    // Opções numeradas (para escolher) ficam; só lista de perguntas perde o número.
    expect(limparTom('Qual delas?\n1. Calabresa\n2. Mussarela')).toBe('Qual delas?\n1. Calabresa\n2. Mussarela')
  })
})
