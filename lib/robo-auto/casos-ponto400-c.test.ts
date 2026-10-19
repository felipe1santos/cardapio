import { describe, expect, it } from 'vitest'
import { bairroPlausivel, classificar, perguntaSobreCardapio } from './classificador'
import { decidir, ESTADO_VAZIO } from './decisao'
import { responder, type DadosLojaAuto } from './respostas'
import { rotaDaMensagem } from '@/lib/agente-ia/gatilho'
import { jaRespondida } from '@/lib/agente-ia/atender'
import { blocosDoSistema, REGRAS_AGENTE } from '@/lib/agente-ia/prompt'

/** Terceira rodada (19/10/2026): auditoria das conversas reais da Ponto 400 de 16–18/10 (anonimizadas). */
const agora = new Date('2026-10-18T23:20:00Z')
const LOJA: DadosLojaAuto = {
  nome: 'Loja', link: 'https://app/loja/x', aberta: true, proximaAbertura: null, gradeHorario: '- Sáb: 18:00–23:59', endereco: 'Rua A, 1', aceitaEntrega: true,
  aceitaRetirada: false, taxaPadrao: 3, foraDaLista: 'bloquear', temRaio: false, tempoEntrega: null, pixChave: '27999990000', pixTipo: 'telefone', pixOnline: false,
  bairros: [{ bairro: 'Centro Aimorés', taxa: 6 }, { bairro: 'Sapucaia', taxa: 3 }, { bairro: 'Valparaiso', taxa: 3 }],
}
const c = (t: string) => classificar(t)
const d = (t: string) => decidir({ classificacao: c(t), texto: t, estado: ESTADO_VAZIO, agora, temPix: true })

describe('entrega escrita como frase (#26 "Vcs tá fazendo entrega ainda" → "Não encontrei o bairro \'ainda\'"; #28)', () => {
  it('frase não é bairro: o robô pergunta o bairro em vez de "não encontrei"', () => {
    expect(bairroPlausivel('ainda')).toBe(false)
    expect(bairroPlausivel('uns lanches aqui na minha casa e o rherisson acerta depois')).toBe(false)
    expect(bairroPlausivel('centro aimores')).toBe(true)
    expect(bairroPlausivel('sao vicente proximo quarterao')).toBe(true)
  })
  it('"Vcs tá fazendo entrega ainda" é horário (está aberto?); "entregam no centro aimorés?" segue sendo taxa', () => {
    expect(c('Vcs tá fazendo entrega ainda').intencao).toBe('horario')
    const r = d('vcs entregam no centro aimorés?')
    expect(r).toMatchObject({ acao: 'entrega', bairro: 'centro aimores' })
  })
  it('"Consegue entregar uns lanches aqui na minha casa e o Rherisson acerta depois?" = fiado → atendente', () => {
    expect(c('Consegue entregar uns lanches aqui na minha casa e o Rherisson acerta depois?').intencao).toBe('atendente')
  })
  it('"consegue entregar na minha casa hoje?" (sem bairro) → pergunta o bairro', () => {
    expect(d('consegue entregar na minha casa hoje?').acao).toBe('entrega_perguntar_bairro')
  })
})

describe('dúvida sobre item (#32 "Esse combo não tem refrigerante não" → link do cardápio)', () => {
  it('é pergunta sobre o cardápio → IA; "manda o cardápio" continua com o robô', () => {
    expect(perguntaSobreCardapio(c('Esse combo não tem refrigerante não').normalizado)).toBe(true)
    expect(perguntaSobreCardapio(c('o x tudo vem com ovo?').normalizado)).toBe(true)
    expect(perguntaSobreCardapio(c('manda o cardápio').normalizado)).toBe(false)
    expect(perguntaSobreCardapio(c('cardapio').normalizado)).toBe(false)
    expect(rotaDaMensagem({ intencao: 'cardapio', tipo: 'texto', emModoIa: false, itemCitado: false, perguntaDeItem: true })).toBe('ia')
    expect(rotaDaMensagem({ intencao: 'cardapio', tipo: 'texto', emModoIa: false, itemCitado: false, perguntaDeItem: false })).toBe('robo')
  })
})

describe('emprego e permuta (#3 "precisando de gente pra trabalhar" → link; #27 "vamos trocar")', () => {
  it.each(['Queria saber se vcs estão precisando de gente pra trabalhar', 'vamos trocar', 'tão contratando?'])('"%s" → atendente', (t) => {
    expect(c(t).intencao).toBe('atendente')
  })
})

describe('tempo de entrega (#31, #40: IA "não tenho o tempo informado")', () => {
  it('com média real do sistema: "pelos últimos pedidos, leva em média…"', () => {
    const r = responder(d('quanto tempo demora a entrega?'), { ...LOJA, tempoEntrega: 'em média 35 min', tempoEntregaOrigem: 'media' }, { agora })
    expect(r.mensagens[0]).toContain('Pelos últimos pedidos, a entrega leva *em média 35 min*')
  })
  it('com o Perfil: "costuma levar"; retirada entra quando a loja aceita', () => {
    const r = responder(d('quanto tempo demora a entrega?'), { ...LOJA, aceitaRetirada: true, tempoEntrega: '30–40 min', tempoRetirada: '15 min', tempoEntregaOrigem: 'perfil' }, { agora })
    expect(r.mensagens[0]).toContain('A entrega costuma levar *30–40 min*')
    expect(r.mensagens[0]).toContain('Para retirada, fica pronto em *15 min*')
  })
})

describe('loja fechada na mão (#21, #22, #29, #37: "abre hoje às 18:00" às 18:50)', () => {
  it('robô: "fechados hoje (fora do horário normal)" + quando volta', () => {
    const r = responder(d('tá aberto?'), { ...LOJA, aberta: false, fechadaHojeForaDoNormal: true, proximaAbertura: 'A loja abre amanhã às 18:00' }, { agora })
    expect(r.mensagens[0]).toContain('Estamos fechados hoje (fora do horário normal). A loja abre amanhã às 18:00.')
  })
  it('IA: o bloco AGORA avisa que a loja decidiu não abrir hoje, e as regras proíbem "abre hoje às 18:00"', () => {
    const b = blocosDoSistema({ nome: 'L', link: 'x', endereco: null, gradeHorario: null, aceitaEntrega: true, aceitaRetirada: false, tempoEntrega: null, formasPagamento: 'Pix', resumoCardapio: '' },
      { agora: 'sábado 18:50', aberta: false, fechadaHojeForaDoNormal: true, proximaAbertura: 'A loja abre amanhã às 18:00', nomeWhatsapp: null })
    expect(b[2].text).toContain('FECHADA hoje, fora do horário normal (a loja decidiu não abrir hoje) (A loja abre amanhã às 18:00)')
    expect(REGRAS_AGENTE).toContain('não diga "abre hoje às 18:00" se já passou das 18:00')
    expect(REGRAS_AGENTE).toContain('[atendente da loja]')
    expect(REGRAS_AGENTE).toContain('Nunca mostre erro técnico ao cliente')
    expect(REGRAS_AGENTE).not.toContain('diga que não sabe')
  })
})

describe('mensagem já respondida (#19, #27: "Não recebi nenhuma mensagem")', () => {
  it('a 2ª mensagem do mesmo segundo já tem resposta da IA depois dela → não chama a IA de novo', () => {
    const h = [
      { id: 'a', direcao: 'entrada' as const, origem: 'cliente', tipo: 'texto', texto: 'Vo quere um picanha bruto', criadoEm: '1' },
      { id: 'b', direcao: 'entrada' as const, origem: 'cliente', tipo: 'texto', texto: 'E uma lata de Coca', criadoEm: '1' },
      { id: 'r', direcao: 'loja' as const, origem: 'ia', tipo: 'texto', texto: 'Achei o PICANHA BRUTO…', criadoEm: '2' },
    ]
    expect(jaRespondida(h, 'b')).toBe(true)
    expect(jaRespondida(h, 'r')).toBe(false)
    expect(jaRespondida(h.slice(0, 2), 'b')).toBe(false)
  })
})
