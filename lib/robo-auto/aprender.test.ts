import { describe, expect, it } from 'vitest'
import { conflitosDaPalavra, jaEntende, palavraEhDaLoja, palavrasDaFrase, sugestaoPorRegras } from './aprender'
import { classificar } from './classificador'

/** "Perguntas que o robô não entendeu" refeito (16/10/2026): sugestão automática e ensino por palavra. */
describe('palavras clicáveis da frase', () => {
  it('normaliza e tira as palavras vazias', () => {
    expect(palavrasDaFrase('Vocês tão FUNCIONANDOOO hoje?')).toEqual(['funcionando', 'hoje'])
    expect(palavrasDaFrase('a b de o')).toEqual([])
  })
})

describe('sugestão por regras', () => {
  it.each(['ah', 'ok', 'pode deixar', 'hum', 'kkk'])('"%s" → ignorar', (t) => expect(sugestaoPorRegras(t).acao).toBe('ignorar'))
  it('pedido escrito → é pedido', () => expect(sugestaoPorRegras('1 x-bacon caprichado').acao).toBe('pedido'))
  it('erro de digitação perto de uma palavra do robô → robô, com o assunto e a palavra', () => {
    const s = sugestaoPorRegras('vcs tao funsionando')
    expect(s).toMatchObject({ acao: 'robo', assunto: 'horario' })
    expect(s.palavras).toContain('funsionando')
  })
  it('pergunta de conteúdo → IA responde', () => expect(sugestaoPorRegras('fazem suco natural?').acao).toBe('ia'))
})

describe('já entende (reprocessar a lista)', () => {
  it('frase que o robô passou a entender sai da lista', () => {
    expect(jaEntende('vcs tão trabalhando hoje')).toBe(true)
    expect(jaEntende('fazem suco natural?')).toBe(false)
  })
  it('palavra ensinada pela loja passa a valer', () => {
    expect(jaEntende('mano')).toBe(false)
    expect(jaEntende('mano', { atendente: ['mano'] })).toBe(true)
  })
  it('frase de pedido ensinada: pedido parecido vai para a IA', () => {
    const c = classificar('2 bacon caprichado', { pedir: ['bacon caprichado'] })
    expect(c.intencao).toBe('pedir')
    expect(c.pedidoSemLink).toBe(true)
  })
})

describe('conflitos antes de salvar', () => {
  it('avisa as outras frases da lista que a palavra também pega e o assunto que já usa a palavra', () => {
    const r = conflitosDaPalavra('entrega', 'horario', ['qual a taxa de entrega', 'entrega no centro?', 'fazem suco?'])
    expect(r.frases).toEqual(['qual a taxa de entrega', 'entrega no centro?'])
    expect(r.outrosAssuntos).toContain('entrega')
  })
})

describe('palavra da loja não vira sugestão global', () => {
  it('nome de produto ou de bairro fica só na loja', () => {
    expect(palavraEhDaLoja('burgao', ['X-Burgão', 'Coca 2L'], ['Centro'])).toBe(true)
    expect(palavraEhDaLoja('centro', [], ['Centro Aimorés'])).toBe(true)
    expect(palavraEhDaLoja('funcionando', ['X-Burgão'], ['Centro'])).toBe(false)
  })
})
