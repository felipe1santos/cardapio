import { describe, expect, it } from 'vitest'
import { decidirFreio, filtrarPublico, janelaDoDisparo, JANELA_MAX_FIM, JANELA_MIN_INICIO } from './disparo-regras'
import { montarTextoCampanha, problemasDasVariaveis, RODAPE_DESCADASTRO } from './campanhas'

const DIA = 86_400_000
const agora = Date.parse('2026-10-12T20:00:00Z')

describe('público do disparo: SÓ quem já pediu na loja', () => {
  const clientes = [
    { telefone: '27999990001', nome: 'Ana' }, // pediu ontem, R$ 30
    { telefone: '27999990002', nome: 'Bia' }, // pediu há 40 dias, total R$ 250
    { telefone: '27999990003', nome: 'Caio' }, // nunca pediu (importado / cadastro)
  ]
  const pedidos = new Map([
    ['27999990001', [{ criado_em: new Date(agora - DIA).toISOString(), total: 30 }]],
    ['27999990002', [{ criado_em: new Date(agora - 45 * DIA).toISOString(), total: 100 }, { criado_em: new Date(agora - 40 * DIA).toISOString(), total: 150 }]],
  ])
  const nomes = (f: Parameters<typeof filtrarPublico>[2]) => filtrarPublico(clientes, pedidos, f, agora).map((c) => c.nome)
  it('"todos" = todos os que já fizeram pedido (nunca quem não pediu)', () => expect(nomes({ tipo: 'todos' })).toEqual(['Ana', 'Bia']))
  it('comprou nos últimos X dias', () => expect(nomes({ tipo: 'recentes', ultimos_dias: 7 })).toEqual(['Ana']))
  it('não compra há X dias (só quem já comprou)', () => expect(nomes({ tipo: 'inativos', dias_inativo: 30 })).toEqual(['Bia']))
  it('gastou acima de R$ X (total na loja)', () => {
    expect(nomes({ tipo: 'gastou_acima', valor_total: 200 })).toEqual(['Bia'])
    expect(nomes({ tipo: 'gastou_acima', valor_total: 10 })).toEqual(['Ana', 'Bia'])
  })
})

describe('janela de envio', () => {
  it('a loja escolhe; nunca fora de 09:00–21:30', () => {
    expect(janelaDoDisparo('17:00', '19:00')).toEqual({ ok: true, inicio: '17:00', fim: '19:00' })
    expect(janelaDoDisparo('07:00', '23:00')).toEqual({ ok: true, inicio: JANELA_MIN_INICIO, fim: JANELA_MAX_FIM })
    expect(janelaDoDisparo('19:00', '17:00').ok).toBe(false)
    expect(janelaDoDisparo('xx', '19:00').ok).toBe(false)
    expect(janelaDoDisparo('21:00', '21:10').ok).toBe(false) // menos de 30 min
  })
})

describe('freio automático', () => {
  it('pausa com erro acima de 5% ou SAIR acima de 3% (a partir de 20 envios); abaixo disso não decide', () => {
    expect(decidirFreio({ enviados: 10, erros: 5, sair: 3 })).toBeNull()
    expect(decidirFreio({ enviados: 95, erros: 5, sair: 0 })).toBeNull()
    expect(decidirFreio({ enviados: 94, erros: 6, sair: 0 })).toBe('erro_alto')
    expect(decidirFreio({ enviados: 100, erros: 0, sair: 3 })).toBeNull()
    expect(decidirFreio({ enviados: 100, erros: 0, sair: 4 })).toBe('sair_alto')
  })
})

describe('mensagem: variáveis reais e rodapé obrigatório', () => {
  const tok = 'a'.repeat(24)
  it('{nome}, {loja}, {link_cardapio} (rastreável) e {ultimo_item}', () => {
    const t = montarTextoCampanha('Oi {nome}! Saudade do {ultimo_item}? Peça na {loja}: {link_cardapio}', { incluirLink: true, token: tok, nome: 'ana maria', loja: 'Menuzia', ultimoItem: 'X-Bacon' })
    expect(t).toMatch(/^Oi Ana! Saudade do X-Bacon\? Peça na Menuzia: https?:\/\/\S+\/c\/a{24}/)
  })
  it('sem último item: some a frase em branco, não sai "{ultimo_item}"', () => {
    expect(montarTextoCampanha('Que tal {ultimo_item} hoje?', { incluirLink: false, token: null, ultimoItem: null })).not.toMatch(/\{/)
  })
  it('rodapé SEMPRE no fim: "Responda SAIR para não receber mais"', () => {
    expect(RODAPE_DESCADASTRO).toBe('Responda SAIR para não receber mais.')
    expect(montarTextoCampanha('Promoção!', { incluirLink: false, token: null })).toMatch(/Responda SAIR para não receber mais\.$/)
  })
  it('variáveis conhecidas passam; desconhecidas bloqueiam', () => {
    expect(problemasDasVariaveis('{nome} {loja} {link_cardapio} {ultimo_item}', { incluirLink: true })).toBeNull()
    expect(problemasDasVariaveis('{cupom}', { incluirLink: true })).toMatch(/desconhecida/)
  })
})
