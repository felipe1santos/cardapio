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

  it('"tão entregando hoje?" responde se está aberto (16/10; antes perguntava o bairro)', () => {
    expect(d('vcs tão entregando hoje?').acao).toBe('horario')
    expect(d('está entregando no centro?').bairro).toBe('centro')
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

describe('mídia (diagnóstico 11/10: álbum de fotos virou "não entendi" 2× → atendente e pausou o robô)', () => {
  const m = (tipo: string, estado: EstadoAuto = ESTADO_VAZIO) =>
    decidir({ classificacao: classificar(null), texto: '', estado, agora: AGORA, tipo: tipo as never })
  it('foto, vídeo, documento, figurinha, contato e tipo desconhecido: não responde nem conta como não entendido', () => {
    for (const t of ['imagem', 'video', 'documento', 'figurinha', 'contato', 'outro']) {
      const r = m(t)
      expect(r.acao, t).toBe('nada')
      expect(r.naoEntendida, t).toBe(false)
      expect(r.estado.naoEntendeu, t).toBe(0)
    }
    // e não zera a contagem de quem já tinha errado uma vez
    expect(m('imagem', { ...ESTADO_VAZIO, naoEntendeu: 1 }).estado.naoEntendeu).toBe(1)
  })
  it('áudio: aviso no máximo 1× a cada 6 h', () => {
    const a = m('audio')
    expect(a.acao).toBe('audio')
    expect(a.estado.audioEm).toBe(AGORA.toISOString())
    expect(m('audio', { ...ESTADO_VAZIO, audioEm: min(30) }).acao).toBe('nada')
    expect(m('audio', { ...ESTADO_VAZIO, audioEm: min(7 * 60) }).acao).toBe('audio')
  })
  it('localização: pergunta o bairro', () => {
    const r = m('localizacao')
    expect(r.acao).toBe('entrega_perguntar_bairro')
    expect(r.estado.autoEstado).toBe('aguardando_bairro')
  })
})

describe('quer pedir pela conversa, sem Agente de IA (11/10)', () => {
  it('1ª vez: link do cardápio e guarda o estado; insistir em 15 min: chama o atendente (16/10)', () => {
    const a = d('quero fazer um pedido')
    expect(a.acao).toBe('pedir_link')
    expect(a.estado.autoEstado).toBe('pedir_link')
    expect(a.naoEntendida).toBe(false)
    const b = d('quero pedir por aqui mesmo', a.estado)
    expect(b.acao).toBe('atendente')
    expect(b.estado.autoEstado).toBeNull()
    // passou de 15 min: volta a mandar o link
    expect(d('quero pedir', { ...a.estado, autoEstadoEm: min(16) }).acao).toBe('pedir_link')
  })
  it('"não consigo usar o link" já chama o atendente (16/10)', () => {
    expect(d('o link não abre').acao).toBe('atendente')
  })
})
