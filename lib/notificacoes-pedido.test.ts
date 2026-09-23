import { describe, it, expect } from 'vitest'
import { AJUDA_ESTADO, ROTULO_ESTADO, estadoDaPermissao, jaAvisado, textoDaNotificacao } from './notificacoes-pedido'

describe('estadoDaPermissao', () => {
  it('sem a API do navegador, o item aparece indisponível', () => {
    expect(estadoDaPermissao(null)).toBe('indisponivel')
  })

  it('traduz os três estados do navegador', () => {
    expect(estadoDaPermissao('default')).toBe('disponivel')
    expect(estadoDaPermissao('granted')).toBe('ativas')
    expect(estadoDaPermissao('denied')).toBe('negadas')
  })

  it('todo estado tem rótulo e explicação', () => {
    for (const e of ['indisponivel', 'disponivel', 'ativas', 'negadas'] as const) {
      expect(ROTULO_ESTADO[e]).toBeTruthy()
      expect(AJUDA_ESTADO[e]).toBeTruthy()
    }
  })

  /** Quem negou precisa saber onde reativar — senão o item vira beco sem saída. */
  it('o texto de "negadas" ensina a reativar', () => {
    expect(AJUDA_ESTADO.negadas).toMatch(/cadeado|Notificações/i)
  })
})

describe('jaAvisado', () => {
  function memoria() {
    let valor: string | null = null
    return { ler: () => valor, gravar: (v: string) => { valor = v }, atual: () => valor }
  }

  it('o primeiro aviso passa, o repetido não', () => {
    const m = memoria()
    expect(jaAvisado('p1', m.ler, m.gravar)).toBe(false)
    expect(jaAvisado('p1', m.ler, m.gravar)).toBe(true)
  })

  /** Duas abas do painel recebem o mesmo evento: só uma pode avisar. */
  it('a memória é compartilhada, então a segunda aba cala', () => {
    const m = memoria()
    const aba1 = jaAvisado('p9', m.ler, m.gravar)
    const aba2 = jaAvisado('p9', m.ler, m.gravar)
    expect([aba1, aba2]).toEqual([false, true])
  })

  it('pedidos diferentes avisam cada um', () => {
    const m = memoria()
    expect(jaAvisado('a', m.ler, m.gravar)).toBe(false)
    expect(jaAvisado('b', m.ler, m.gravar)).toBe(false)
  })

  it('não cresce sem limite', () => {
    const m = memoria()
    for (let i = 0; i < 80; i++) jaAvisado(`p${i}`, m.ler, m.gravar)
    expect(JSON.parse(m.atual()!).length).toBeLessThanOrEqual(50)
  })

  it('memória corrompida não derruba o aviso', () => {
    const m = { ler: () => '{isso não é json', gravar: () => {} }
    expect(jaAvisado('p1', m.ler, m.gravar)).toBe(false)
  })

  it('storage bloqueado não impede o aviso', () => {
    const m = { ler: () => null, gravar: () => { throw new Error('bloqueado') } }
    expect(jaAvisado('p1', m.ler, m.gravar)).toBe(false)
  })
})

describe('textoDaNotificacao', () => {
  it('diz o número e de onde veio', () => {
    expect(textoDaNotificacao({ numero: 42, canal: 'delivery' })).toEqual({
      titulo: 'Pedido #42 chegou',
      corpo: 'Pedido do delivery aguardando aceite no Painel de Pedidos.',
    })
    expect(textoDaNotificacao({ numero: 7, canal: 'mesa' }).corpo).toMatch(/da mesa/)
    expect(textoDaNotificacao({ numero: 7, canal: 'balcao' }).corpo).toMatch(/do balcão/)
  })

  it('aguenta pedido sem número ainda', () => {
    expect(textoDaNotificacao({ numero: null }).titulo).toBe('Pedido novo chegou')
  })

  /**
   * A notificação aparece numa tela que fica à vista de quem passa pela loja.
   * Nome, telefone, endereço e valor do cliente não entram.
   */
  it('não leva dado do cliente', () => {
    const { titulo, corpo } = textoDaNotificacao({ numero: 10, canal: 'delivery' })
    const junto = `${titulo} ${corpo}`
    expect(junto).not.toMatch(/R\$|\d{4,}|rua|telefone/i)
  })
})
