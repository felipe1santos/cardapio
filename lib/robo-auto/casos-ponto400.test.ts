import { describe, expect, it } from 'vitest'
import { classificar } from './classificador'
import { decidir, ESTADO_VAZIO } from './decisao'
import { responder, type DadosLojaAuto } from './respostas'
import { rotaDaMensagem } from '@/lib/agente-ia/gatilho'

/** Casos reais do atendimento da Ponto 400 (11–16/10/2026), anonimizados. */
const agora = new Date('2026-10-16T22:16:00Z')
const LOJA: DadosLojaAuto = {
  nome: 'Loja', link: 'https://app/loja/x', aberta: true, proximaAbertura: null, gradeHorario: '- Sex: 18:00–23:59', endereco: 'Rua A, 1', aceitaEntrega: true,
  aceitaRetirada: false, bairros: [], taxaPadrao: 5, foraDaLista: 'bloquear', temRaio: false, tempoEntrega: null, pixChave: '27999990000', pixTipo: 'telefone', pixOnline: false,
}
const decide = (texto: string, temPix = true) => decidir({ classificacao: classificar(texto), texto, estado: ESTADO_VAZIO, agora, temPix })

describe('chave Pix', () => {
  it.each(['Já me manda a chave Pix que pago', 'a chave pix', 'Pix', 'qual o pix?', 'pode mandar o pix', 'posso pagar no pix aqui?', 'me passa a chave'])('"%s" → manda a chave', (t) => {
    expect(classificar(t).intencao).toBe('pix_chave')
    expect(decide(t).acao).toBe('pix_chave')
  })
  it('a chave sai sozinha numa mensagem separada, com o valor do pedido em aberto', () => {
    const d = decide('Já me manda a chave Pix que pago')
    const r = responder(d, LOJA, { agora, pedido: { numero: 392, status: 'recebido', rotuloStatus: 'Recebido', total: 47.5, itens: [] } })
    expect(r.mensagens).toHaveLength(2)
    expect(r.mensagens[0]).toContain('R$ 47,50')
    expect(r.mensagens[0]).toContain('392')
    expect(r.mensagens[1]).toBe('27999990000')
    expect(r.mensagens.join(' ')).not.toMatch(/cart[aã]o|dinheiro/i)
  })
  it('sem chave cadastrada: chama o atendente (não manda a lista de formas)', () => {
    const d = decide('manda a chave pix', false)
    expect(d.acao).toBe('atendente')
    expect(d.silenciar).toBe('atendente')
  })
  it('"pix na entrega?" continua sendo a pergunta de formas de pagamento (não pergunta o bairro)', () => {
    expect(classificar('aceita pix na entrega?').intencao).toBe('pagamento_pix')
  })
})

describe('resumo do pedido que a própria vitrine manda', () => {
  const resumo = 'Acabei de fazer um pedido agora mesmo! 🛎️\n\n• 1x X-TUDO\n   + Bacon\n\nTotal: R$ 32,00\nPagamento: Pix\nEntrega'
  it('é reconhecido (não é "quero pedir")', () => {
    expect(classificar(resumo).intencao).toBe('resumo_pedido')
    expect(decide(resumo).acao).toBe('resumo_pedido')
  })
  it('fica com o robô mesmo com a IA ligada', () => {
    expect(rotaDaMensagem({ intencao: 'resumo_pedido', tipo: 'texto', emModoIa: false, itemCitado: true })).toBe('robo')
    expect(rotaDaMensagem({ intencao: 'resumo_pedido', tipo: 'texto', emModoIa: true, itemCitado: true })).toBe('robo')
  })
  it('responde "Recebemos seu pedido #N" e NUNCA manda o link', () => {
    const r = responder(decide(resumo), LOJA, { agora, pedido: { numero: 393, status: 'recebido', rotuloStatus: 'Recebido', total: 32, itens: [] } })
    expect(r.mensagens[0]).toContain('393')
    expect(r.mensagens.join(' ')).not.toContain('https://')
  })
  it('sem o pedido encontrado: agradece, sem link', () => {
    const r = responder(decide(resumo), LOJA, { agora, pedido: null })
    expect(r.mensagens.join(' ')).not.toContain('https://')
  })
})

describe('estão abertos / trabalhando hoje', () => {
  it.each(['Vcs tá trabalhando hoje', 'tão abertos?', 'tá funcionando?', 'vai abrir hoje?', 'até que horas?', 'já abriu?', 'vocês estão trabalhando hoje', 'tá entregando ainda?', 'está entregando?'])('"%s" → horário (aberto agora + horário de hoje)', (t) => {
    expect(classificar(t).intencao).toBe('horario')
  })
  it('a resposta diz se está aberto agora', () => {
    const r = responder(decide('Vcs tá trabalhando hoje'), LOJA, { agora })
    expect(r.mensagens[0]).toMatch(/abertos agora/i)
  })
})

describe('outros do relatório', () => {
  it('"preciso saber o tempo de espera" não vira "sabor" (cardápio)', () => {
    expect(classificar('preciso saber o tempo de espera').intencao).not.toBe('cardapio')
  })
})
