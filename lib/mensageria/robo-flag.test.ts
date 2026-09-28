import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * O interruptor do robô (whatsapp_robo_config.robo_ativo) só pode afetar a RESPOSTA a
 * mensagens recebidas (lib/mensageria/entrada.ts). Avisos de pedido, fidelidade e
 * campanhas saem por outro caminho e continuam saindo com o robô desligado.
 */

const RAIZ = join(__dirname, '..', '..')
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8')

vi.mock('@/lib/queries/pedidos', () => ({
  buscarPedidoParaNotificacao: vi.fn(async () => ({
    pedido: {
      id: 'p1', numero: 42, status: 'pronto', tipo: 'entrega', clienteNome: 'Ana', clienteTelefone: '27999990000',
      itens: [], subtotal: 10, taxaEntrega: 0, total: 10, formaPagamento: 'pix',
    },
    restauranteNome: 'Loja Teste',
    evolutionInstance: 'menuzia-loja-teste',
  })),
}))

describe('robô desligado × envios transacionais', () => {
  beforeEach(() => {
    process.env.EVOLUTION_API_URL = 'http://evolution.teste'
    process.env.EVOLUTION_API_KEY = 'k'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.EVOLUTION_API_URL
    delete process.env.EVOLUTION_API_KEY
  })

  it('os caminhos transacionais nunca leem o interruptor do robô', () => {
    for (const arquivo of ['lib/whatsapp.ts', 'lib/fidelidade.ts', 'lib/mensageria/campanhas-envio.ts', 'lib/pedido-eventos.ts']) {
      const src = ler(arquivo)
      expect(src, arquivo).not.toMatch(/robo_ativo|whatsapp_robo_config|roboAtivo/)
    }
    // E o único lugar que lê o interruptor é a entrada (resposta a mensagens recebidas).
    expect(ler('lib/mensageria/entrada.ts')).toMatch(/cfg\.robo_ativo/)
  })

  it('aviso de status do pedido sai pela Evolution sem consultar o robô', async () => {
    const chamadas: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      chamadas.push(String(url))
      return new Response('{}', { status: 200 })
    }))
    const { notificarPedido } = await import('@/lib/whatsapp')
    // Qualquer consulta ao banco aqui seria o robô sendo lido: o admin falso explode.
    const admin = new Proxy({}, { get: () => { throw new Error('não devia consultar o banco') } })
    const r = await notificarPedido(admin as never, 'p1', 'pronto')
    expect(r).toBe('enviada')
    expect(chamadas).toEqual(['http://evolution.teste/message/sendText/menuzia-loja-teste'])
  })
})
