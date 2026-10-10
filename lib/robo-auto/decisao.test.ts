import { describe, expect, it } from 'vitest'
import { classificar } from './classificador'
import { decidir, ESTADO_VAZIO, type EstadoAuto } from './decisao'

const AGORA = new Date('2026-10-10T22:00:00Z')
const min = (n: number) => new Date(AGORA.getTime() - n * 60_000).toISOString()
const d = (texto: string, estado: EstadoAuto = ESTADO_VAZIO, desligados: string[] = []) =>
  decidir({ classificacao: classificar(texto), texto, estado, agora: AGORA, assuntosDesligados: new Set(desligados) as never })

describe('decisão do robô de autoatendimento', () => {
  it('saudação no máximo 1 vez a cada 6 h; repetida vira menu curto', () => {
    const a = d('oi')
    expect(a.acao).toBe('saudacao')
    expect(a.estado.saudacaoEm).toBe(AGORA.toISOString())
    expect(d('bom dia', { ...ESTADO_VAZIO, saudacaoEm: min(60) }).acao).toBe('menu_curto')
    expect(d('bom dia', { ...ESTADO_VAZIO, saudacaoEm: min(6 * 60 + 1) }).acao).toBe('saudacao')
  })

  it('entrega com bairro na frase responde direto; sem bairro pergunta e guarda o estado', () => {
    const com = d('qnto ta a taxa pro ibes')
    expect(com.acao).toBe('entrega')
    expect(com.bairro).toBe('ibes')
    const sem = d('qual a taxa de entrega?')
    expect(sem.acao).toBe('entrega_perguntar_bairro')
    expect(sem.estado.autoEstado).toBe('aguardando_bairro')
  })

  it('aguardando bairro: a próxima mensagem é o bairro; outro assunto explícito ganha e limpa o estado', () => {
    const esperando: EstadoAuto = { ...ESTADO_VAZIO, autoEstado: 'aguardando_bairro', autoEstadoEm: min(2) }
    const b = d('jardim camburi', esperando)
    expect(b.acao).toBe('entrega')
    expect(b.bairro).toBe('jardim camburi')
    const h = d('que horas fecha?', esperando)
    expect(h.acao).toBe('horario')
    expect(h.estado.autoEstado).toBeNull()
    // vencido (15 min): volta ao normal
    expect(d('jardim camburi', { ...esperando, autoEstadoEm: min(16) }).acao).toBe('nao_entendeu')
  })

  it('aguardando número do pedido: número vira consulta de status', () => {
    const esperando: EstadoAuto = { ...ESTADO_VAZIO, autoEstado: 'aguardando_numero', autoEstadoEm: min(1) }
    const r = d('é o 1234', esperando)
    expect(r.acao).toBe('status_numero')
    expect(r.numeroPedido).toBe(1234)
    expect(r.estado.autoEstado).toBeNull()
    expect(d('#87', esperando).numeroPedido).toBe(87)
  })

  it('não entendeu: 1ª vez menu completo; 2ª seguida transfere para atendente', () => {
    const a = d('asdkjh')
    expect(a.acao).toBe('nao_entendeu')
    expect(a.naoEntendida).toBe(true)
    expect(a.estado.naoEntendeu).toBe(1)
    const b = d('kkkkk', a.estado)
    expect(b.acao).toBe('atendente')
    expect(b.silenciar).toBe('atendente')
    expect(b.estado.naoEntendeu).toBe(0)
    // entender algo no meio zera a contagem
    const c = d('cardapio', a.estado)
    expect(c.estado.naoEntendeu).toBe(0)
  })

  it('atendente, reclamação e parar silenciam; ok não responde', () => {
    expect(d('0').silenciar).toBe('atendente')
    expect(d('veio errado').acao).toBe('reclamacao')
    expect(d('veio errado').silenciar).toBe('atendente')
    expect(d('parar').silenciar).toBe('parar')
    expect(d('obrigado').acao).toBe('nada')
    expect(d('obrigado').naoEntendida).toBe(false)
  })

  it('assunto desligado pelo dono vira "não entendi"; atendente e parar nunca desligam', () => {
    expect(d('aceita pix?', ESTADO_VAZIO, ['pagamento_pix']).acao).toBe('nao_entendeu')
    expect(d('0', ESTADO_VAZIO, ['atendente']).acao).toBe('atendente')
    expect(d('parar', ESTADO_VAZIO, ['parar']).acao).toBe('parar')
  })

  it('mapeia cada assunto para a ação', () => {
    expect(d('1').acao).toBe('cardapio')
    expect(d('3').acao).toBe('status')
    expect(d('4').acao).toBe('horario')
    expect(d('5').acao).toBe('pagamento')
    expect(d('6').acao).toBe('endereco')
  })
})
