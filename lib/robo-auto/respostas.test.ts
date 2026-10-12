import { describe, expect, it } from 'vitest'
import { menu, responder, type DadosLojaAuto } from './respostas'

const LOJA: DadosLojaAuto = {
  nome: 'Loja', link: 'https://x/loja', aberta: true, proximaAbertura: null, gradeHorario: null, endereco: null, aceitaEntrega: true, aceitaRetirada: true,
  bairros: [{ bairro: 'Jaburuna', taxa: 5.89 }], taxaPadrao: 3, foraDaLista: 'bloquear', temRaio: true, tempoEntrega: null, pixChave: null, pixTipo: null, pixOnline: false,
}
const agora = new Date('2026-10-12T15:00:00Z')

describe('respostas do robô (12/10)', () => {
  it('nenhum menu tem "0 Falar com atendente"', () => {
    expect(menu(LOJA)).not.toMatch(/Falar com atendente|\*0\*/)
    expect(menu(LOJA, true)).not.toMatch(/Falar com atendente|\*0\*/)
    const r = responder({ acao: 'saudacao', intencao: 'saudacao', estado: {} as never, naoEntendida: false }, LOJA, { agora })
    expect(r.mensagens[0]).not.toMatch(/Falar com atendente/)
  })
  it('texto salvo pela loja com a linha "0 Falar com atendente": a linha some, o resto fica', () => {
    const l = { ...LOJA, textos: { menu_curto: '*Oi*\n\n{menu}\n- *0* Falar com atendente\nFim' } }
    const r = responder({ acao: 'menu_curto', intencao: 'saudacao', estado: {} as never, naoEntendida: false }, l, { agora })
    expect(r.mensagens[0]).not.toMatch(/Falar com atendente/)
    expect(r.mensagens[0]).toMatch(/Fim/)
  })
  it('taxa do bairro: vale a do checkout quando o servidor calculou (Jaburuna R$ 3,00 pelo raio, não R$ 5,89)', () => {
    const r = responder({ acao: 'entrega', intencao: 'entrega', bairro: 'jaburuna', estado: {} as never, naoEntendida: false }, LOJA, { agora, taxaCheckout: { taxa: 3, entregavel: true } })
    expect(r.mensagens[0]).toContain('R$ 3,00')
    expect(r.mensagens[0]).not.toContain('5,89')
  })
  it('quer pedir: texto curto insistindo no link', () => {
    const r = responder({ acao: 'pedir_link', intencao: 'pedir', estado: {} as never, naoEntendida: false }, LOJA, { agora })
    expect(r.mensagens[0]).toContain('https://x/loja')
    expect(r.mensagens[0].length).toBeLessThan(160)
  })
})
