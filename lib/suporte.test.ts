import { describe, expect, it } from 'vitest'
import { ROTULO_IMPRESSORA, estadoDaImpressora, linkDoSuporte, numeroDoSuporte } from './suporte'

const AGORA = new Date(2026, 8, 23, 15, 0, 0).getTime()

describe('número do suporte', () => {
  it('usa o da variável de ambiente quando existe', () => {
    expect(numeroDoSuporte('55 27 99999-0000')).toBe('5527999990000')
  })

  it('número quebrado ou ausente cai no padrão em vez de gerar link morto', () => {
    expect(numeroDoSuporte(undefined)).toBe('5527998925966')
    expect(numeroDoSuporte('123')).toBe('5527998925966')
  })
})

describe('link do suporte', () => {
  it('leva o nome da loja na mensagem', () => {
    expect(decodeURIComponent(linkDoSuporte('Fire House'))).toContain('Minha loja é Fire House')
  })

  it('loja sem nome manda a mensagem genérica', () => {
    const texto = decodeURIComponent(linkDoSuporte('   '))
    expect(texto).toContain('Preciso de ajuda com o painel')
    expect(texto).not.toContain('undefined')
  })
})

describe('estado da impressora', () => {
  it('visto agora com impressora escolhida está conectada', () => {
    const status = { impressoraId: 'imp-1', vistoEm: new Date(AGORA - 10_000).toISOString() }
    expect(estadoDaImpressora(status, AGORA)).toBe('conectada')
  })

  /** Dizer "conectada" para um agente que sumiu faz o dono perder pedido calado. */
  it('silêncio longo do agente vira desconectada', () => {
    const status = { impressoraId: 'imp-1', vistoEm: new Date(AGORA - 30 * 60_000).toISOString() }
    expect(estadoDaImpressora(status, AGORA)).toBe('desconectada')
  })

  it('agente vivo mas sem impressora escolhida também é desconectada', () => {
    const status = { impressoraId: null, vistoEm: new Date(AGORA - 5_000).toISOString() }
    expect(estadoDaImpressora(status, AGORA)).toBe('desconectada')
  })

  it('loja que nunca instalou o agente aparece como não configurada', () => {
    expect(estadoDaImpressora(null, AGORA)).toBe('sem-agente')
    expect(estadoDaImpressora({ impressoraId: null, vistoEm: null }, AGORA)).toBe('sem-agente')
  })

  it('data inválida não vira "conectada" por acidente', () => {
    expect(estadoDaImpressora({ impressoraId: 'x', vistoEm: 'nao-e-data' }, AGORA)).toBe('sem-agente')
  })

  it('todo estado tem rótulo para o leitor de tela', () => {
    for (const e of ['conectada', 'desconectada', 'sem-agente'] as const) {
      expect(ROTULO_IMPRESSORA[e].length).toBeGreaterThan(5)
    }
  })
})
