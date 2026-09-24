import { describe, expect, it } from 'vitest'
import { ROTULO_IMPRESSORA, SUPORTE_MENUZIA, caminhoSeguro, estadoDaImpressora, linkDoSuporte, mensagemDoSuporte } from './suporte'

const AGORA = new Date(2026, 8, 23, 15, 0, 0).getTime()

describe('número do suporte', () => {
  it('é o oficial da Menuzia, fixo (não o da Nexta nem de variável de ambiente)', () => {
    expect(SUPORTE_MENUZIA.whatsapp).toBe('5527998534407')
    expect(SUPORTE_MENUZIA.exibicao).toBe('(27) 99853-4407')
  })
})

describe('caminho seguro da tela', () => {
  it('tira query string e fragmento', () => {
    expect(caminhoSeguro('/admin/pedidos?token=abc&x=1#topo')).toBe('/admin/pedidos')
  })
  it('troca uuid, número e token longo por :id', () => {
    expect(caminhoSeguro('/admin/mesas/3f2c1a9e-8b7d-4c6e-9f10-1234567890ab')).toBe('/admin/mesas/:id')
    expect(caminhoSeguro('/admin/pedidos/4088')).toBe('/admin/pedidos/:id')
    expect(caminhoSeguro('/cozinha/k9X2mQ7vL4pR8sT1wZ3y')).toBe('/cozinha/:id')
  })
  it('mantém os nomes de tela', () => {
    expect(caminhoSeguro('/admin/ajustes')).toBe('/admin/ajustes')
    expect(caminhoSeguro('/admin/integracoes/nexta')).toBe('/admin/integracoes/nexta')
  })
  it('vazio vira a raiz e segmento estranho vira :id', () => {
    expect(caminhoSeguro(undefined)).toBe('/')
    expect(caminhoSeguro('/admin/x%ZZ')).toBe('/admin/:id')
    expect(caminhoSeguro('/admin/joão@mail')).toBe('/admin/:id')
  })
})

describe('mensagem e link do suporte', () => {
  const base = { loja: 'Fire House', usuario: 'Ana Souza', papel: 'gerente', caminho: '/admin/pedidos?aba=x', duvida: '  Como troco a taxa?  ' }

  it('monta a mensagem no formato combinado', () => {
    expect(mensagemDoSuporte(base)).toBe([
      'Olá! Preciso de ajuda com o Menuzia.', '',
      'Loja: Fire House', 'Usuário: Ana Souza', 'Perfil: Gerente', 'Tela: /admin/pedidos', '',
      'Dúvida:', 'Como troco a taxa?',
    ].join('\n'))
  })

  it('o link é wa.me do número oficial com o texto codificado', () => {
    const url = linkDoSuporte(base)!
    expect(url.startsWith('https://wa.me/5527998534407?text=')).toBe(true)
    expect(decodeURIComponent(url.split('?text=')[1]!)).toBe(mensagemDoSuporte(base))
    expect(url).not.toMatch(/[\s\n]/)
  })

  it('dúvida vazia ou só espaços não gera link', () => {
    expect(linkDoSuporte({ ...base, duvida: '' })).toBeNull()
    expect(linkDoSuporte({ ...base, duvida: '   \n ' })).toBeNull()
  })

  it('campos ausentes viram "—", sem "undefined"/"null"', () => {
    const m = mensagemDoSuporte({ duvida: 'oi' })
    expect(m).toContain('Loja: —')
    expect(m).toContain('Usuário: —')
    expect(m).not.toMatch(/undefined|null/)
  })

  it('não leva query string, fragmento nem id da URL', () => {
    const m = mensagemDoSuporte({ ...base, caminho: '/admin/mesas/3f2c1a9e-8b7d-4c6e-9f10-1234567890ab?token=segredo#x' })
    expect(m).not.toContain('segredo')
    expect(m).not.toContain('3f2c1a9e')
    expect(m).toContain('Tela: /admin/mesas/:id')
  })

  it('dúvida longa é cortada no limite', () => {
    expect(mensagemDoSuporte({ duvida: 'a'.repeat(5000) }).endsWith('a'.repeat(1000))).toBe(true)
    expect(mensagemDoSuporte({ duvida: 'a'.repeat(5000) })).not.toContain('a'.repeat(1001))
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
