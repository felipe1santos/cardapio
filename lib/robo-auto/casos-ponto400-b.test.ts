import { describe, expect, it } from 'vitest'
import { classificar } from './classificador'
import { decidir, ESTADO_VAZIO, type EstadoAuto } from './decisao'
import { acharBairros, responder, type DadosLojaAuto } from './respostas'
import { rotaDaMensagem } from '@/lib/agente-ia/gatilho'

/** Segunda rodada de correções do robô (16/10/2026), a partir do relatório do atendimento da Ponto 400 (anonimizado). */
const agora = new Date('2026-10-16T22:16:00Z')
const LOJA: DadosLojaAuto = {
  nome: 'Loja', link: 'https://app/loja/x', aberta: true, proximaAbertura: null, gradeHorario: '- Sex: 18:00–23:59', endereco: 'Rua A, 1', aceitaEntrega: true,
  aceitaRetirada: false, taxaPadrao: 5, foraDaLista: 'bloquear', temRaio: false, tempoEntrega: '40 a 50 min', pixChave: '27999990000', pixTipo: 'telefone', pixOnline: false,
  bairros: [{ bairro: 'Centro Aimorés', taxa: 5 }, { bairro: 'Centro Baixo Guandu', taxa: 7 }, { bairro: 'Maua ES', taxa: 6 }, { bairro: 'Maua MG', taxa: 8 }],
}
const c = (t: string) => classificar(t).intencao
const d = (t: string, estado: EstadoAuto = ESTADO_VAZIO, temPix = true) => decidir({ classificacao: classificar(t), texto: t, estado, agora, temPix })

describe('resumo da vitrine', () => {
  it('confirma com ✅ e, se for Pix não pago, manda a chave em mensagem separada; nunca o link', () => {
    const r = responder(d('Acabei de fazer um pedido agora mesmo! 🛎️\n\n• 1x X-TUDO\n\nTotal: R$ 32,00\nPagamento: Pix'), LOJA, {
      agora, pedido: { numero: 401, status: 'recebido', rotuloStatus: 'Recebido', total: 32, itens: [], formaPagamento: 'pix', pago: false },
    })
    expect(r.mensagens[0]).toMatch(/Recebemos seu pedido[\s\S]*401[\s\S]*✅/)
    expect(r.mensagens).toContain('27999990000')
    expect(r.mensagens.join(' ')).not.toContain('https://')
  })
})

describe('Pix', () => {
  it('"pix na entrega?" → pagamento (formas + a chave separada), nunca bairro', () => {
    expect(c('pix na entrega?')).toBe('pagamento_pix')
    const r = responder(d('pix na entrega?'), LOJA, { agora })
    expect(r.mensagens).toContain('27999990000')
  })
  it('"posso pagar no pix aqui?" → a chave', () => expect(c('posso pagar no pix aqui?')).toBe('pix_chave'))
})

describe('tempo de entrega', () => {
  it.each(['quanto tempo pra entrega?', 'preciso saber o tempo de espera', 'quanto tempo demora?'])('"%s" → tempo de entrega', (t) => {
    expect(c(t)).toBe('tempo_entrega')
  })
  it('responde o tempo cadastrado', () => {
    expect(responder(d('quanto tempo demora?'), LOJA, { agora }).mensagens[0]).toContain('40 a 50 min')
  })
  it('"saber" nunca vira "sabor"', () => expect(c('quero saber uma coisa')).not.toBe('cardapio'))
})

describe('reclamação, status, endereço e saudação', () => {
  it('"não recebi" → reclamação (desculpas + atendente)', () => {
    expect(c('não recebi meu lanche')).toBe('reclamacao')
    expect(d('não recebi').silenciar).toBe('atendente')
  })
  it('"fiz um pedido aí" → status do último pedido', () => expect(c('fiz um pedido aí')).toBe('status_pedido'))
  it.each(['onde vocês ficam?', 'e onde vocês é', 'onde é a loja?'])('"%s" → endereço', (t) => expect(c(t)).toBe('endereco_retirada'))
  it.each(['eii', 'fala comigo'])('"%s" → saudação', (t) => expect(c(t)).toBe('saudacao'))
})

describe('bairros', () => {
  it('"Centro" com duas cidades → pergunta qual', () => {
    expect(acharBairros('centro', LOJA.bairros).map((b) => b.bairro)).toEqual(['Centro Aimorés', 'Centro Baixo Guandu'])
    const r = responder({ acao: 'entrega', intencao: 'entrega', bairro: 'centro', estado: ESTADO_VAZIO, naoEntendida: false }, LOJA, { agora })
    expect(r.mensagens[0]).toContain('Centro Aimorés')
    expect(r.mensagens[0]).toContain('Centro Baixo Guandu')
    expect(r.autoEstado).toBe('aguardando_bairro')
  })
  it('"Mauá Minas" = "Maua MG"', () => {
    expect(acharBairros('Mauá Minas', LOJA.bairros).map((b) => b.bairro)).toEqual(['Maua MG'])
    expect(acharBairros('maua minas gerais', LOJA.bairros).map((b) => b.bairro)).toEqual(['Maua MG'])
  })
})

describe('número do pedido', () => {
  it('código de outro sistema (#FQ67…) não é número de pedido', () => {
    const esperando: EstadoAuto = { ...ESTADO_VAZIO, autoEstado: 'aguardando_numero', autoEstadoEm: agora.toISOString() }
    expect(d('#FQ67XK', esperando).acao).not.toBe('status_numero')
    expect(d('é o 67', esperando)).toMatchObject({ acao: 'status_numero', numeroPedido: 67 })
  })
})

describe('dúvida pelo botão da vitrine', () => {
  it('"Vim pelo cardápio online e tenho uma dúvida" → "Claro! Qual a sua dúvida?"', () => {
    expect(c('Olá! Vim pelo cardápio online e tenho uma dúvida.')).toBe('duvida')
    expect(responder(d('Olá! Vim pelo cardápio online e tenho uma dúvida.'), LOJA, { agora }).mensagens[0]).toMatch(/Qual a sua dúvida/)
  })
})

describe('assuntos de pessoa → atendente direto', () => {
  it.each(['tem vaga de emprego?', 'vocês vendem fiado?', 'tenho uma proposta de parceria', 'quero mudar meu pedido', 'esqueci de pedir a coca, dá pra acrescentar no pedido?'])('"%s"', (t) => {
    expect(c(t)).toBe('atendente')
  })
})

describe('pedido escrito na conversa', () => {
  it.each(['1 x-bacon caprichado', '2 x burgão e uma coca 2L', 'um x tudo'])('"%s" → pedido pela conversa (IA)', (t) => {
    const k = classificar(t)
    expect(k.intencao).toBe('pedir')
    expect(k.pedidoSemLink).toBe(true)
    expect(rotaDaMensagem({ intencao: k.intencao, tipo: 'texto', emModoIa: false, itemCitado: false, pedidoSemLink: k.pedidoSemLink })).toBe('ia')
  })
  it('sem a IA: atendente (não manda o link de novo)', () => {
    const r = d('1 x-bacon caprichado')
    expect(r.acao).toBe('atendente')
    expect(r.silenciar).toBe('atendente')
    const insistiu = d('quero pedir', { ...ESTADO_VAZIO, autoEstado: 'pedir_link', autoEstadoEm: agora.toISOString() })
    expect(insistiu.acao).toBe('atendente')
  })
})
