import { describe, expect, it } from 'vitest'
import { blocosDoSistema } from './prompt'

/** Conhecimento da loja (16/10/2026): o que o dono ensinou entra no prompt do Agente de IA, com a regra de não inventar. */
describe('conhecimento da loja no prompt', () => {
  const base = { nome: 'L', link: 'u', endereco: null, gradeHorario: null, aceitaEntrega: true, aceitaRetirada: false, tempoEntrega: null, formasPagamento: 'Pix', resumoCardapio: '- X' }
  const din = { agora: 'sexta 20:00', aberta: true, proximaAbertura: null, nomeWhatsapp: 'Ana' }
  it('entra com pergunta e resposta, e a regra de não inventar fora disso', () => {
    const t = blocosDoSistema({ ...base, conhecimento: [{ pergunta: 'Fazem suco?', resposta: 'Não, só refrigerante e água.' }] }, din).map((b) => b.text).join('\n')
    expect(t).toContain('CONHECIMENTO DA LOJA')
    expect(t).toContain('Fazem suco?')
    expect(t).toContain('Não, só refrigerante e água.')
    expect(t).toMatch(/não invente/)
  })
  it('sem conhecimento, o bloco não aparece', () => {
    expect(blocosDoSistema(base, din).map((b) => b.text).join('\n')).not.toContain('CONHECIMENTO DA LOJA')
  })
})
