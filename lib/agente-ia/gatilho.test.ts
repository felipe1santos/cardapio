import { describe, expect, it } from 'vitest'
import { classificar } from '@/lib/robo-auto/classificador'
import { itemCitado, modoIaAtivo, nomesDoCardapio, rotaDaMensagem, MAX_RESPOSTAS_IA } from './gatilho'

const NOMES = nomesDoCardapio([
  { id: '1', nome: 'X-Tudo' }, { id: '2', nome: 'Coca-Cola 2L' }, { id: '3', nome: 'Batata Frita' }, { id: '4', nome: 'Pão' }, { id: '5', nome: 'Hambúrguer Artesanal' },
])
const rota = (texto: string, emModoIa = false, tipo: 'texto' | 'imagem' | 'audio' | 'video' = 'texto') => {
  const c = classificar(texto)
  return rotaDaMensagem({ intencao: c.intencao, tipo, emModoIa, itemCitado: itemCitado(texto, NOMES), normalizado: c.normalizado })
}

describe('quando a IA entra (robô sempre primeiro)', () => {
  it('robô reconhece: saudação, cardápio, taxa, horário, status, Pix, atendente → robô (IA não é chamada)', () => {
    for (const t of ['oi', 'boa noite', 'manda o cardápio', 'qual a taxa pro centro', 'que horas fecha', 'cadê meu pedido', 'aceita pix?', 'quero falar com atendente', '0', '3']) {
      expect(rota(t), t).toBe('robo')
    }
  })
  it('robô não entendeu → IA (no lugar do "não entendi")', () => {
    expect(rota('vcs fazem sem cebola roxa?')).toBe('ia')
  })
  it('quer pedir pela conversa (com ou sem item) → IA', () => {
    for (const t of ['quero fazer um pedido', 'quero um x tudo e uma coca cola 2l', 'me vê 2 batata frita', 'o link não abre', 'anota meu pedido']) expect(rota(t), t).toBe('ia')
  })
  it('nome de item do cardápio (tolerante) → IA; item curto demais (Pão) não conta', () => {
    expect(itemCitado('tem x tudo hj?', NOMES)).toBe(true)
    expect(itemCitado('hamburguer artezanal', NOMES)).toBe(true)
    expect(itemCitado('pão', NOMES)).toBe(false)
    expect(rota('quanto custa o x-tudo?')).toBe('ia')
    expect(rota('oi, tem batata frita?')).toBe('ia')
  })
  it('pedido inteiro numa frase (item + entrega/pagamento) → IA; sem item, taxa e Pix ficam com o robô (teste real 12/10)', () => {
    expect(rota('quero mais um pedido: 1 batata frita, entrega na Rua Teste 123, Centro, pago no cartão')).toBe('ia')
    expect(rota('x tudo, vou pagar no pix')).toBe('ia')
    expect(rota('qual a taxa pro centro')).toBe('robo')
    expect(rota('aceita pix?')).toBe('robo')
    expect(rota('o x tudo já saiu pra entrega?')).toBe('robo')
  })
  it('foto → IA; áudio fora do modo IA → robô; vídeo → robô', () => {
    expect(rota('', false, 'imagem')).toBe('ia')
    expect(rota('', false, 'audio')).toBe('robo')
    expect(rota('', false, 'video')).toBe('robo')
  })
  it('em modo IA: tudo vai para a IA (até "sim", "ok", "pix", "cancela a coca"), menos atendente explícito e parar; áudio pede para escrever', () => {
    for (const t of ['sim', 'ok', 'pix', 'rua das flores 10', 'cancela a coca', 'o endereço tá errado, é 12']) expect(rota(t, true), t).toBe('ia')
    expect(rota('quero falar com um atendente', true)).toBe('robo')
    expect(rota('0', true)).toBe('robo')
    expect(rota('parar', true)).toBe('robo')
    expect(rota('', true, 'audio')).toBe('audio_ia')
  })
})

describe('modo IA: até quando vale', () => {
  const agora = new Date('2026-10-11T22:00:00Z')
  const ha = (m: number) => new Date(agora.getTime() - m * 60_000).toISOString()
  it('entrou há pouco ou o cliente falou nos últimos 30 min: vale', () => {
    expect(modoIaAtivo({ iaDesde: ha(5), iaRespostas: 2 }, null, agora)).toBe(true)
    expect(modoIaAtivo({ iaDesde: ha(50), iaRespostas: 2 }, ha(10), agora)).toBe(true)
  })
  it('30 min sem mensagem do cliente, nunca entrou ou 25 respostas: não vale', () => {
    expect(modoIaAtivo({ iaDesde: ha(50), iaRespostas: 2 }, ha(31), agora)).toBe(false)
    expect(modoIaAtivo({ iaDesde: null, iaRespostas: 0 }, ha(1), agora)).toBe(false)
    expect(modoIaAtivo({ iaDesde: ha(1), iaRespostas: MAX_RESPOSTAS_IA }, ha(1), agora)).toBe(false)
  })
})
