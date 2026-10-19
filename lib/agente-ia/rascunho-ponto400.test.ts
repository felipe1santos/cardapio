import { describe, expect, it } from 'vitest'
import { ajustarTipoAceito, interpretarEscolhas, mesclarDoIa, novoRascunho, responderPeloRascunho, type Rascunho } from './rascunho'
import type { CardapioIa, ItemIa } from './cardapio'

/** Casos reais da Ponto 400 (17–18/10/2026), anonimizados. */
const ADICIONAIS = ['Bife de hamburguer', 'Bife caseiro', 'Frango', 'Calabresa', 'Bacon', 'Queijo mussarela', 'Queijo Cheddar', 'Presunto', 'Ovo', 'Bife de Picanha', 'Molho caseiro verde', 'Molho caseiro rose', 'Prensar meu lanche']
const xbacon: ItemIa = {
  id: '11111111-1111-1111-1111-111111111111', nome: 'X - BACON', descricao: '', categoria: 'Lanches', posicao: 0, preco: 23, precoCheio: null, situacao: 'disponivel', tipo: 'simples', tamanhos: [], sabores: [],
  grupos: [{ nome: 'ADICIONAIS', obrigatorio: false, min: 0, max: 13, opcoes: ADICIONAIS.map((nome) => ({ nome, preco: 4, pausado: false })) }],
}
const coca: ItemIa = { ...xbacon, id: '22222222-2222-2222-2222-222222222222', nome: 'COCA-COLA 2L', categoria: 'Bebidas', preco: 15, grupos: [] }
const guarana: ItemIa = { ...xbacon, id: '33333333-3333-3333-3333-333333333333', nome: 'IATE GUARANÁ 2L', categoria: 'Bebidas', preco: 8, grupos: [] }
const cardapio: CardapioIa = { itens: [xbacon, coca, guarana], pizza: { tamanhos: [], bordas: [], massas: [] } }
const loja = { aceitaEntrega: true, aceitaRetirada: false, pix: true }
const EM = '2026-10-18T22:00:00.000Z'
const comXbacon = (): Rascunho => ({ ...novoRascunho(EM), itens: [{ itemId: xbacon.id, quantidade: 1, escolhas: {}, respondidos: [] }] })

describe('"tudo bem" não é "todos" (Nego Shell 17/10 23:31: marcou os 13 adicionais)', () => {
  it('"todos"/"tudo"/"quero todos" (resposta curta) = todas as opções', () => {
    expect(interpretarEscolhas('todos', ADICIONAIS)).toHaveLength(13)
    expect(interpretarEscolhas('quero tudo', ADICIONAIS)).toHaveLength(13)
    expect(interpretarEscolhas('pode ser todos', ADICIONAIS)).toHaveLength(13)
  })
  it('"tudo" no meio de uma frase longa NÃO marca nada (vai para a IA)', () => {
    expect(interpretarEscolhas('Si não tem como entregar tudo bem desculpa ai', ADICIONAIS)).toBeNull()
    expect(interpretarEscolhas('tudo bem, pode ser sem bacon então', ADICIONAIS)).toBeNull()
  })
})

describe('"quero não" / "não quero" é NÃO (Hudson 18/10: "Quero não" → "Qual delas? 😊")', () => {
  it('na oferta de bebida: encerra a oferta sem item', () => {
    const r: Rascunho = { ...comXbacon(), soIsso: true, oferta: { tipo: 'bebida', ids: [coca.id, guarana.id], respondida: false } }
    r.itens[0].respondidos = ['ADICIONAIS']
    for (const t of ['Quero não', 'não quero', 'Não quero bebida', 'nenhuma', 'não']) {
      const a = responderPeloRascunho(r, [t], cardapio, loja)
      expect(a, t).not.toBeNull()
      expect(a!.rascunho.oferta?.respondida, t).toBe(true)
      expect(a!.rascunho.itens, t).toHaveLength(1)
      expect(a!.mensagens.join(' '), t).not.toContain('Qual delas')
    }
  })
  it('nos adicionais: "quero não" = nenhum', () => {
    expect(interpretarEscolhas('quero não', ADICIONAIS)).toBe('nenhum')
    expect(interpretarEscolhas('não quero nenhum', ADICIONAIS)).toBe('nenhum')
  })
})

describe('pagamento/entrega/troco ditos na pergunta dos adicionais (Valmir 18/10: "Paga com cartão de crédito" → "Não entendi bem")', () => {
  it('anota o pagamento e repete só a pergunta pendente', () => {
    const a = responderPeloRascunho(comXbacon(), ['Paga com cartão de crédito'], cardapio, loja)
    expect(a).not.toBeNull()
    expect(a!.rascunho.pagamento).toBe('cartao')
    expect(a!.mensagens.join('\n')).toContain('Anotei o pagamento')
    expect(a!.mensagens.join('\n')).toContain('Quer turbinar seu *X - BACON*')
    expect(a!.completo).toBe(false)
  })
  it('"bacon e entrega" (opção + entrega juntos) continua indo para a IA, sem anotar tipo por engano', () => {
    expect(responderPeloRascunho(comXbacon(), ['bacon e entrega'], cardapio, loja)).toBeNull()
  })
  it('"vou retirar" com retirada desligada não vira tipo (e não vira "anotei a retirada")', () => {
    expect(responderPeloRascunho(comXbacon(), ['vou retirar'], cardapio, loja)).toBeNull()
  })
})

describe('tipo que a loja não aceita (bárbarah 18/10: "vou retirar aí" com retirada desligada)', () => {
  it('a IA mandou tipo=retirada: o servidor ignora, avisa que é só entrega e segue para o endereço', () => {
    const m = mesclarDoIa(null, { itens: [{ item_id: xbacon.id, quantidade: 2 }], tipo: 'retirada', pagamento: 'pix' }, cardapio, EM)
    expect(m.ok).toBe(true)
    const aj = ajustarTipoAceito(m.ok ? m.rascunho : novoRascunho(EM), loja)
    expect(aj.rascunho.tipo).toBe('entrega')
    expect(aj.aviso).toBe('No momento estamos só com entrega 🛵 Posso mandar pro seu endereço?')
    expect(ajustarTipoAceito({ ...novoRascunho(EM), tipo: 'entrega' }, loja).aviso).toBeNull()
  })
})
