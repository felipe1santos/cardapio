import { describe, expect, it } from 'vitest'
import { novaConversa, passo, type FontesSimulador } from './simulador'
import { renderizar } from './textos'
import type { DadosLojaAuto } from './respostas'

const LOJA: DadosLojaAuto = {
  nome: 'Menuzia Burger', link: 'https://app.menuzia.com.br/loja/menuzia?utm_source=whatsapp&utm_medium=robo', aberta: true, proximaAbertura: null,
  gradeHorario: '- Seg: 18:00–23:00\n- Ter: fechado', endereco: 'Rua A, 10, Centro, Vitória - ES', aceitaEntrega: true, aceitaRetirada: true,
  bairros: [{ bairro: 'Centro', taxa: 5 }, { bairro: 'Jardim Camburi', taxa: 8.5 }, { bairro: 'Ibes', taxa: 0 }],
  taxaPadrao: 0, foraDaLista: 'bloquear', temRaio: false, tempoEntrega: '40 a 60 min', pixChave: '27999990000', pixTipo: 'telefone', pixOnline: false,
}
const F: FontesSimulador = { loja: LOJA, nomeCliente: 'João Silva' }
const t0 = new Date('2026-10-10T22:00:00Z') // 19h em Brasília
const em = (min: number) => new Date(t0.getTime() + min * 60_000)

describe('conversas completas no simulador', () => {
  it('saudação → entrega → bairro → taxa', () => {
    const c = novaConversa()
    const a = passo(c, 'boa noite', F, em(0))
    expect(a.acao).toBe('saudacao')
    expect(a.respostas[0]).toContain('*👋 Boa noite!*')
    expect(a.respostas[0]).toContain('_João_')
    expect(a.respostas[0]).toContain(LOJA.link) // link do cardápio obrigatório
    const b = passo(c, '2', F, em(1))
    expect(b.acao).toBe('entrega_perguntar_bairro')
    const d = passo(c, 'jardim camburi', F, em(2))
    expect(d.acao).toBe('entrega')
    expect(d.respostas[0]).toContain('Jardim Camburi')
    expect(d.respostas[0]).toContain('`R$ 8,50`')
    expect(d.respostas[0]).toContain('> Tempo de entrega: *40 a 60 min*')
    expect(c.estado.autoEstado).toBeNull()
  })

  it('bairro com erro de digitação e bairro inexistente → lista com as taxas', () => {
    const c = novaConversa()
    expect(passo(c, 'qnto ta a taxa pro centr', F, em(0)).respostas[0]).toContain('`R$ 5,00`')
    const x = passo(c, 'taxa pro bairro inexistente', F, em(1))
    expect(x.respostas[0]).toContain('Não encontrei o bairro')
    expect(x.respostas[0]).toContain('- Ibes: `Grátis`')
    expect(c.estado.autoEstado).toBe('aguardando_bairro')
    // nova tentativa
    expect(passo(c, 'ibes', F, em(2)).respostas[0]).toContain('Grátis')
  })

  it('status pelo telefone: 1 pedido aberto mostra o status; nenhum pede o número', () => {
    const pedido = { numero: 1234, status: 'preparando', rotuloStatus: 'Em preparo', total: 52.9, itens: [{ quantidade: 1, nome: 'Hambúrguer artesanal' }, { quantidade: 1, nome: 'Batata frita' }] }
    const um = passo(novaConversa(), 'meu lanche ja saiu?', { ...F, pedidosAbertos: [pedido] }, em(0))
    expect(um.respostas[0]).toContain('`#1234`')
    expect(um.respostas[0]).toContain('*Em preparo*')
    expect(um.respostas[0]).toContain('- 1x Batata frita')
    expect(um.respostas[0]).toContain('`R$ 52,90`')
    const c = novaConversa()
    const nenhum = passo(c, 'cade meu pedido', { ...F, pedidosAbertos: [] }, em(0))
    expect(nenhum.respostas[0]).toContain('número do pedido')
    const n = passo(c, '1234', { ...F, pedidoPorNumero: (k) => (k === 1234 ? pedido : null) }, em(1))
    expect(n.acao).toBe('status_numero')
    expect(n.respostas[0]).toContain('*Em preparo*')
  })

  it('atendente → pausa 1 h (sem responder) → volta depois', () => {
    const c = novaConversa()
    const a = passo(c, 'quero falar com alguem', F, em(0))
    expect(a.acao).toBe('atendente')
    expect(a.silenciada?.motivo).toBe('atendente')
    expect(passo(c, 'oi?', F, em(10)).respostas).toEqual([])
    expect(passo(c, 'oi', F, em(10 + 61)).acao).toBe('saudacao')
  })

  it('parar → silêncio até "voltar"', () => {
    const c = novaConversa()
    expect(passo(c, 'para de mandar mensagem', F, em(0)).acao).toBe('parar')
    expect(passo(c, 'oi', F, em(300)).respostas).toEqual([])
    expect(passo(c, 'voltar', F, em(301)).acao).toBe('reativada')
    expect(passo(c, '1', F, em(302)).acao).toBe('cardapio')
  })

  it('Pix: formas de pagamento e a chave sozinha na 2ª mensagem; sem chave não fala de Pix', () => {
    const r = passo(novaConversa(), 'aceita pix?', F, em(0))
    expect(r.respostas).toHaveLength(2)
    expect(r.respostas[1]).toBe('27999990000')
    expect(r.respostas[0]).toContain('(telefone)')
    const sem = passo(novaConversa(), 'aceita pix?', { ...F, loja: { ...LOJA, pixChave: null } }, em(0))
    expect(sem.respostas).toHaveLength(1)
    expect(sem.respostas[0]).not.toMatch(/pix/i)
  })

  it('não entendeu 2 vezes seguidas → atendente', () => {
    const c = novaConversa()
    const a = passo(c, 'asdfg', F, em(0))
    expect(a.respostas[0]).toContain('*0* Falar com atendente')
    expect(a.respostas[0]).toContain(LOJA.link)
    expect(passo(c, 'qwert', F, em(1)).acao).toBe('atendente')
  })

  it('horário e endereço', () => {
    expect(passo(novaConversa(), 'q horas fecha', F, em(0)).respostas[0]).toContain('- Seg: 18:00–23:00')
    expect(passo(novaConversa(), 'qual o endereço', F, em(0)).respostas[0]).toContain('Rua A, 10')
  })

  it('formatação de referência (nome vazio some junto da vírgula; linha com campo vazio some)', () => {
    expect(renderizar('Olá, _{nome_cliente}_! Seu pedido `#{numero_pedido}`', { numero_pedido: '1234' })).toBe('Olá! Seu pedido `#1234`')
    expect(renderizar('A\n\n> Previsão: *{previsao}*\n\nB', {})).toBe('A\n\nB')
  })
})
