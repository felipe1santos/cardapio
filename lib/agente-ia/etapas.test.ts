/**
 * Fluxo do pedido pela conversa (14/10/2026, teste do Felipe 19:41–19:43): a ORDEM é do servidor.
 * itens (complementos → extras → "mais alguma coisa ou é só isso?", repetindo) → peça também (1x) → entrega/retirada →
 * endereço → pagamento → troco → resumo.
 */
import { describe, expect, it } from 'vitest'
import { interpretarEscolhas, itemDoTexto, mesclarDoIa, montarOferta, novoRascunho, proximaPergunta, rascunhoParaCarrinho, responderPeloRascunho, valorParcial, type Rascunho } from './rascunho'
import { modoIaAtivo, rotaDaMensagem } from './gatilho'
import { emojiDoItem } from '@/lib/mensageria/formato'
import type { CardapioIa, ItemIa } from './cardapio'

const base = { descricao: '', posicao: 0, precoCheio: null, situacao: 'disponivel', tipo: 'simples', tamanhos: [], sabores: [] }
const mega: ItemIa = {
  ...base, id: '11111111-1111-1111-1111-111111111111', nome: 'Mega Burguer', categoria: 'Gourmet', preco: 24,
  grupos: [{ nome: 'adicionais geral', obrigatorio: false, min: 0, max: 4, opcoes: ['Catupiry', 'Picles', 'Bacon gratinado', 'Cheedar'].map((nome) => ({ nome, preco: 2, pausado: false })) }],
}
const coca: ItemIa = { ...base, id: '22222222-2222-2222-2222-222222222222', nome: 'coca lata', categoria: 'Bebidas', preco: 5, grupos: [] }
const guarana: ItemIa = { ...base, id: '33333333-3333-3333-3333-333333333333', nome: 'Guaraná 2L', categoria: 'Bebidas', preco: 12, grupos: [] }
const batata: ItemIa = { ...base, id: '44444444-4444-4444-4444-444444444444', nome: 'Batata frita', categoria: 'Porções', preco: 15, grupos: [] }
const cardapio: CardapioIa = { itens: [mega, coca, guarana, batata], pizza: { tamanhos: [], bordas: [], massas: [] } }
const semBebida: CardapioIa = { ...cardapio, itens: [mega, batata] }
const loja = { aceitaEntrega: true, aceitaRetirada: true, pix: true }
const EM = '2026-10-14T22:00:00.000Z'
const comMega = (): Rascunho => ({ ...novoRascunho(EM), itens: [{ itemId: mega.id, quantidade: 1, escolhas: {}, respondidos: [] }] })
const responder = (r: Rascunho, t: string, c = cardapio) => responderPeloRascunho(r, [t], c, loja)!

describe('extras: frase natural e emoji tolerante a erro de digitação', () => {
  it('"Quer turbinar seu *Mega Burguer*?" sem o nome interno do grupo', () => {
    const p = proximaPergunta(comMega(), cardapio, loja)!
    expect(p.texto).toBe('Quer turbinar seu *Mega Burguer*? Adicionais `+R$ 2,00` cada, até 4:\n\n🧀 Catupiry\n🥒 Picles\n🥓 Bacon gratinado\n🧀 Cheedar\n\n_Se não quiser, é só dizer "nenhuma"._')
    expect(p.texto).not.toContain('adicionais geral')
  })
  it.each([['Cheedar', '🧀'], ['catupiry', '🧀'], ['Catupiri', '🧀'], ['picles', '🥒'], ['Chedar', '🧀'], ['bacom', '🥓']])('%s → %s', (n, e) => expect(emojiDoItem(n)).toBe(e))
  it('"bacon" escolhe "Bacon gratinado" (palavra da opção, sem a IA)', () => {
    expect(interpretarEscolhas('Pode adicionar bacon', ['Catupiry', 'Picles', 'Bacon gratinado', 'Cheedar'])).toEqual([2])
    expect(interpretarEscolhas('cheddar e picles', ['Catupiry', 'Picles', 'Bacon gratinado', 'Cheedar'])).toEqual([1, 3])
  })
})

describe('etapa 1 — itens: ao terminar o item, "mais alguma coisa ou é só isso?"', () => {
  it('bacon → Anotado + "Vai querer mais alguma coisa ou é só isso?" (não pula para entrega)', () => {
    const r = responder(comMega(), 'Pode adicionar bacon')
    expect(r.mensagens).toEqual(['Anotado ✍️:\n*Mega Burguer* com `Bacon gratinado`\n\nVai querer mais alguma coisa ou é só isso?'])
    expect(proximaPergunta(r.rascunho, cardapio, loja)!.campo).toBe('mais')
  })
  it('"quero uma coca lata tbm" no meio: o servidor adiciona e pergunta de novo (nada de link)', () => {
    const r1 = responder(comMega(), 'bacon')
    const r2 = responder(r1.rascunho, 'Quero uma coca lata tbm')
    expect(r2.rascunho.itens.map((l) => [l.itemId, l.quantidade])).toEqual([[mega.id, 1], [coca.id, 1]])
    expect(r2.mensagens).toEqual(['Anotado ✍️:\n*coca lata*\n\nVai querer mais alguma coisa ou é só isso?'])
  })
  it('item com extras pedido no meio: volta para as perguntas dele e depois "mais alguma coisa?"', () => {
    const r1 = responder(responder(comMega(), 'nenhuma').rascunho, 'quero mais um mega burguer')
    expect(r1.rascunho.itens).toHaveLength(2)
    expect(proximaPergunta(r1.rascunho, cardapio, loja)).toMatchObject({ campo: 'grupo', linha: 1 })
    expect(proximaPergunta(responder(r1.rascunho, 'nenhuma').rascunho, cardapio, loja)!.campo).toBe('mais')
  })
  it('item pedido até na pergunta de entrega/pagamento entra no pedido e reabre o "é só isso?"', () => {
    const naEntrega: Rascunho = { ...comMega(), soIsso: true, oferta: { tipo: 'bebida', ids: [], respondida: true }, itens: [{ itemId: mega.id, quantidade: 1, escolhas: {}, respondidos: ['adicionais geral'] }] }
    expect(proximaPergunta(naEntrega, cardapio, loja)!.campo).toBe('tipo')
    const r = responder(naEntrega, 'quero uma coca lata também')
    expect(r.rascunho.itens.map((l) => l.itemId)).toContain(coca.id)
    expect(r.rascunho.soIsso).toBe(false)
    expect(proximaPergunta(r.rascunho, cardapio, loja)!.campo).toBe('mais')
  })
  it('"sim"/"quero mais" sem dizer o item: pede o item', () => {
    const r = responder(responder(comMega(), 'nenhuma').rascunho, 'sim')
    expect(r.mensagens).toEqual(['Pode falar o que mais você quer 😊'])
  })
  it('itemDoTexto: quantidade, tolerância e ambíguo', () => {
    expect(itemDoTexto('2 coca lata', cardapio)).toMatchObject({ item: { id: coca.id }, quantidade: 2 })
    expect(itemDoTexto('duas coca lata', cardapio)?.quantidade).toBe(2)
    expect(itemDoTexto('uma batata', cardapio)?.item.id).toBe(batata.id)
    expect(itemDoTexto('mega hamburguer', cardapio)?.item.id).toBe(mega.id)
    expect(itemDoTexto('é só isso', cardapio)).toBeNull()
    expect(itemDoTexto('rua das flores 10', cardapio)).toBeNull()
  })
})

describe('etapa 2 — peça também (uma vez por pedido, só depois do "é só isso")', () => {
  it('loja com bebidas e pedido sem bebida: OBRIGATÓRIO oferecer bebida (até 4, uma por linha, com preço)', () => {
    const r = responder(responder(comMega(), 'nenhuma').rascunho, 'é só isso')
    expect(r.rascunho.oferta).toMatchObject({ tipo: 'bebida', respondida: false })
    expect(r.mensagens).toEqual(['Vai querer uma bebida? 🥤\n\n🥤 *coca lata* `R$ 5,00`\n🥤 *Guaraná 2L* `R$ 12,00`\n\n_Se não quiser, é só dizer "não"._'])
  })
  it('pedido já com bebida: até 2 acompanhamentos (order bump cadastrado primeiro)', () => {
    const r: Rascunho = { ...comMega(), itens: [...comMega().itens, { itemId: coca.id, quantidade: 1, escolhas: {}, respondidos: [] }] }
    expect(montarOferta(r, cardapio, { bumps: [batata.id] })).toEqual({ tipo: 'acompanhamento', ids: [batata.id], respondida: false })
  })
  it('loja sem bebida: oferece acompanhamento; sem nada para oferecer, pula', () => {
    expect(montarOferta(comMega(), semBebida, {}).tipo).toBe('acompanhamento')
    expect(montarOferta(comMega(), { ...cardapio, itens: [mega] }, {})).toEqual({ tipo: 'acompanhamento', ids: [], respondida: true })
  })
  it('recusou → segue para entrega/retirada; aceitou → entra e pergunta "mais alguma coisa?" de novo; nunca oferece 2x', () => {
    const oferta = responder(responder(comMega(), 'nenhuma').rascunho, 'é só isso').rascunho
    const nao = responder(oferta, 'não')
    expect(nao.mensagens).toEqual(['Beleza!\nVai ser `Entrega` ou `Retirada no balcão`?'])
    const sim = responder(oferta, 'quero a coca')
    expect(sim.rascunho.itens.map((l) => l.itemId)).toContain(coca.id)
    expect(sim.mensagens).toEqual(['Anotado ✍️:\n*coca lata*\n\nVai querer mais alguma coisa ou é só isso?'])
    const fim = responder(sim.rascunho, 'só isso')
    expect(fim.rascunho.oferta!.respondida).toBe(true)
    expect(proximaPergunta(fim.rascunho, cardapio, loja)!.campo).toBe('tipo')
  })
})

describe('etapas 3–5 — entrega, pagamento, troco, adiantar e trocar de ideia', () => {
  const prontoParaEntrega = (): Rascunho => ({ ...comMega(), soIsso: true, oferta: { tipo: 'bebida', ids: [coca.id], respondida: true }, itens: [{ itemId: mega.id, quantidade: 1, escolhas: {}, respondidos: ['adicionais geral'] }] })
  it('ordem: entrega → endereço → pagamento → troco → completo', () => {
    const ent = responder(prontoParaEntrega(), 'entrega')
    expect(ent.mensagens).toEqual(['Me passa o endereço de entrega: rua, número e bairro 📍'])
    const comEnd: Rascunho = { ...ent.rascunho, endereco: { rua: 'Rua A', numero: '10', bairro: 'Centro', complemento: '', referencia: '', cep: '' } }
    expect(proximaPergunta(comEnd, cardapio, loja)!.campo).toBe('pagamento')
    const din = responder(comEnd, 'dinheiro')
    expect(proximaPergunta(din.rascunho, cardapio, loja)!.campo).toBe('troco')
    expect(responder(din.rascunho, 'troco pra 50').completo).toBe(true)
  })
  it('cliente adianta ("é só isso, vai ser retirada no pix"): o servidor aproveita e pula as perguntas respondidas', () => {
    const r = responder(responder(comMega(), 'nenhuma').rascunho, 'é só isso, vou retirar e pago no pix')
    expect(r.rascunho.tipo).toBe('retirada')
    expect(r.rascunho.pagamento).toBe('pix')
    expect(r.mensagens[0]).toContain('Vai querer uma bebida?')
    expect(responder(r.rascunho, 'não').completo).toBe(true)
  })
  it('"prefiro dinheiro, troco pra 50" depois do Pix (pedido completo): troca e fica completo de novo (novo resumo)', () => {
    const completo: Rascunho = { ...prontoParaEntrega(), tipo: 'retirada', pagamento: 'pix' }
    expect(proximaPergunta(completo, cardapio, loja)).toBeNull()
    const r = responder(completo, 'prefiro dinheiro, troco pra 50')
    expect(r).toMatchObject({ completo: true, rascunho: { pagamento: 'dinheiro', trocoPara: 50 } })
  })
  it('na pergunta de pagamento, "dinheiro, troco pra 100" responde as duas de uma vez', () => {
    const r = responder({ ...prontoParaEntrega(), tipo: 'retirada' }, 'dinheiro, troco pra 100')
    expect(r).toMatchObject({ completo: true, rascunho: { pagamento: 'dinheiro', trocoPara: 100 } })
  })
  it('"fica quanto?" em qualquer etapa: valor parcial e continua de onde parou', () => {
    const r = responder(responder(comMega(), 'bacon').rascunho, 'fica quanto?')
    expect(r.mensagens).toEqual(['Até agora fica `R$ 26,00` (sem a taxa de entrega).\n\nVai querer mais alguma coisa ou é só isso?'])
  })
})

describe('grupos com o mesmo nome (cadastro da Menuzia: dois "ADICIONAIS GERAL", um vazio) — teste real #410', () => {
  const duplo: ItemIa = { ...mega, grupos: [{ nome: 'ADICIONAIS GERAL', obrigatorio: false, min: 0, max: 0, opcoes: [] }, { ...mega.grupos[0], nome: 'ADICIONAIS GERAL' }] }
  const c2: CardapioIa = { ...cardapio, itens: [duplo, coca, guarana, batata] }
  it('bacon escolhido uma vez entra UMA vez no carrinho e no valor', () => {
    const r = responderPeloRascunho(comMega(), ['bacon'], c2, loja)!
    const fim: Rascunho = { ...r.rascunho, soIsso: true, oferta: { tipo: 'bebida', ids: [], respondida: true }, tipo: 'retirada', pagamento: 'pix' }
    expect(rascunhoParaCarrinho(fim, c2, loja, 'Felipe')!.itens[0].complementos).toEqual(['Bacon gratinado'])
    expect(valorParcial(fim, c2)).toBe(26)
    expect(r.mensagens[0]).toBe('Anotado ✍️:\n*Mega Burguer* com `Bacon gratinado`\n\nVai querer mais alguma coisa ou é só isso?')
  })
  it('a IA anotando pelo montar_pedido também não duplica', () => {
    const m = mesclarDoIa(null, { itens: [{ item_id: mega.id, quantidade: 1, complementos: ['bacon gratinado'] }] }, c2, EM)
    expect(m.ok && Object.values(m.rascunho.itens[0].escolhas).flat()).toEqual(['Bacon gratinado'])
    expect(m.ok && rascunhoParaCarrinho({ ...m.rascunho, soIsso: true, tipo: 'retirada', pagamento: 'pix' }, c2, loja, 'F')!.itens[0].complementos).toEqual(['Bacon gratinado'])
  })
})

describe('robô calado durante o pedido (bug 1)', () => {
  const agora = new Date(EM)
  it('pedido em andamento = modo IA, mesmo depois de 30 min sem mensagem', () => {
    expect(modoIaAtivo({ iaDesde: '2026-10-14T20:00:00.000Z', iaRespostas: 3, pedidoEmAndamento: true }, '2026-10-14T21:00:00.000Z', agora)).toBe(true)
    expect(modoIaAtivo({ iaDesde: '2026-10-14T20:00:00.000Z', iaRespostas: 3 }, '2026-10-14T21:00:00.000Z', agora)).toBe(false)
  })
  it('em modo IA, "quero uma coca" (intenção pedir) vai para a IA, não para o link do robô; atendente explícito e SAIR continuam com o robô', () => {
    expect(rotaDaMensagem({ intencao: 'pedir', tipo: 'texto', emModoIa: true, itemCitado: false, normalizado: 'quero uma coca lata tbm' })).toBe('ia')
    expect(rotaDaMensagem({ intencao: 'atendente', tipo: 'texto', emModoIa: true, itemCitado: false, normalizado: 'quero falar com atendente' })).toBe('robo')
    expect(rotaDaMensagem({ intencao: 'parar', tipo: 'texto', emModoIa: true, itemCitado: false, normalizado: 'sair' })).toBe('robo')
  })
})
