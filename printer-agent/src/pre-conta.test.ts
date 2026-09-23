import { describe, it, expect, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { montarPreContaLinhas, montarTesteLinhas, colsPreConta, brl } = require('./pre-conta.js') as {
  montarPreContaLinhas: (s: Record<string, unknown>) => string[]
  montarTesteLinhas: (s: Record<string, unknown>) => string[]
  colsPreConta: (l: number) => number
  brl: (v: number) => string
}
const { FilasPorDispositivo } = require('./fila-dispositivos.js') as {
  FilasPorDispositivo: new (
    imprimir: (t: { id: string; nomeSistema: string }) => Promise<void>,
    informar: (id: string, ok: boolean, erro: string | null) => Promise<void>,
    agora?: () => number,
  ) => { receber: (t: unknown[]) => void; esvaziar: () => Promise<void> }
}

const texto = (linhas: string[]) => linhas.map((l) => l.replace(/[\x01\x02]/g, ' ')).join('\n')

const mesa = {
  versao: 1, loja: 'Cantina Demonstração', tipo: 'mesa', mesa: 'Mesa 01', comanda_numero: 57, senha: null, cliente_nome: null,
  aberta_em: '2026-09-23T22:02:00Z', impresso_em: '2026-09-23T22:40:00Z', operador: 'Carla Atendente', via: 1,
  itens: [
    { quantidade: 2, nome: 'X-Burguer', tamanho: null, sabor: null, borda: null, massa: null, complementos: [{ nome: 'Bacon', preco: 4 }, { nome: 'Bacon', preco: 4 }], preco_unitario: 38, subtotal: 76 },
    { quantidade: 1, nome: 'Pizza', tamanho: 'Média', sabor: 'Calabresa / Frango', borda: 'Cheddar', massa: 'Fina', complementos: [], preco_unitario: 55, subtotal: 55 },
  ],
  cancelados: [{ quantidade: 1, nome: 'Coca lata' }],
  subtotal: 131, taxa_percentual: 10, taxa: 13.1, desconto: 5, total: 139.1, pago: 50, restante: 89.1,
  pagamentos: [{ forma: 'pix', valor: 30 }, { forma: 'dinheiro', valor: 20 }],
}

describe('pré-conta', () => {
  const t = texto(montarPreContaLinhas(mesa))
  it('cabeçalho: título, conferência e aviso não fiscal', () => {
    expect(t).toContain('PRÉ-CONTA')
    expect(t).toContain('CONFERÊNCIA DE CONSUMO')
    expect(t).toContain('NÃO É DOCUMENTO FISCAL')
    expect(t).toContain('MESA 01 · COMANDA 57')
  })
  it('itens com quantidade, variação, borda, massa, adicionais e preço', () => {
    expect(t).toContain('2x X-Burguer')
    expect(t).toContain('R$ 76,00')
    expect(t).toContain('2 x R$ 38,00')
    expect(t).toContain('+ 2x Bacon (R$ 8,00)')
    expect(t).toContain('1x Pizza (Média - Calabresa / Frango)')
    expect(t).toContain('+ Borda: Cheddar')
    expect(t).toContain('+ Massa: Fina')
  })
  it('totais do servidor: subtotal, taxa com %, desconto, total, pago por forma e restante', () => {
    expect(t).toContain('Taxa de serviço (10%)')
    expect(t).toContain('R$ 13,10')
    expect(t).toContain('Desconto')
    expect(t).toContain('-R$ 5,00')
    expect(t).toMatch(/TOTAL\s+R\$ 139,10/)
    expect(t).toContain('Pix: R$ 30,00')
    expect(t).toContain('Dinheiro: R$ 20,00')
    expect(t).toMatch(/RESTANTE A PAGAR\s+R\$ 89,10/)
  })
  it('cancelados numa seção à parte, sem preço', () => {
    const i = t.indexOf('CANCELADOS — NÃO COBRADOS')
    expect(i).toBeGreaterThan(t.indexOf('RESTANTE'))
    expect(t.slice(i)).toContain('1x Coca lata')
    expect(t.slice(i)).not.toContain('R$')
  })
  it('sem cancelados, não há a seção', () => {
    expect(texto(montarPreContaLinhas({ ...mesa, cancelados: [] }))).not.toContain('CANCELADOS')
  })
  it('balcão: senha e nome do cliente; sem taxa não imprime a linha', () => {
    const b = texto(montarPreContaLinhas({ ...mesa, tipo: 'balcao', mesa: null, senha: 12, cliente_nome: 'Ana Conceição', taxa: 0, taxa_percentual: 0 }))
    expect(b).toContain('BALCÃO · SENHA 12')
    expect(b).toContain('Cliente: Ana Conceição')
    expect(b).not.toContain('Taxa de serviço')
  })
  it('segunda via identificada', () => {
    expect(texto(montarPreContaLinhas({ ...mesa, via: 2 }))).toContain('2ª VIA (reimpressão)')
    expect(t).toContain('1ª via')
  })
  it('nunca imprime telefone, endereço, motivo de desconto nem credencial', () => {
    const cheio = texto(montarPreContaLinhas({ ...mesa, cliente_telefone: '27999990000', endereco: 'Rua X', desconto_motivo: 'amigo do dono', credencial: 'mza_ag_x' }))
    for (const proibido of ['27999990000', 'Rua X', 'amigo do dono', 'mza_ag_']) expect(cheio).not.toContain(proibido)
  })
  it('acentos preservados; milhar com ponto', () => {
    expect(brl(1234.5)).toBe('R$ 1.234,50')
    expect(texto(montarPreContaLinhas(mesa))).toContain('Cantina Demonstração'.toUpperCase())
  })
  it('colunas por papel: 58 mm = 32, 80 mm = 48', () => {
    expect(colsPreConta(58)).toBe(32)
    expect(colsPreConta(80)).toBe(48)
  })
  it('teste de impressora mostra destino, papel e acentos', () => {
    const tt = texto(montarTesteLinhas({ loja: 'Loja', impressora: 'Caixa 02', nome_sistema: 'ELGIN i9', computador: 'PC Caixa', largura_mm: 58, operador: 'Gerente' }))
    expect(tt).toContain('TESTE DE IMPRESSORA')
    expect(tt).toContain('Caixa 02')
    expect(tt).toContain('58 mm')
    expect(tt).toContain('ÁÉÍÓÚ')
  })
})

describe('filas por impressora', () => {
  it('impressora do caixa travada não segura a da cozinha', async () => {
    let soltarCaixa!: () => void
    const caixaPresa = new Promise<void>((r) => (soltarCaixa = r))
    const impressos: string[] = []
    const informados: [string, boolean][] = []
    const filas = new FilasPorDispositivo(
      async (t) => {
        if (t.nomeSistema === 'CAIXA') await caixaPresa
        impressos.push(t.id)
      },
      async (id, ok) => {
        informados.push([id, ok])
      },
    )
    filas.receber([
      { id: 'c1', nomeSistema: 'CAIXA', segundosRestantes: 600 },
      { id: 'k1', nomeSistema: 'COZINHA', segundosRestantes: 600 },
      { id: 'k2', nomeSistema: 'COZINHA', segundosRestantes: 600 },
    ])
    await new Promise((r) => setTimeout(r, 20))
    expect(impressos).toEqual(['k1', 'k2'])
    soltarCaixa()
    await filas.esvaziar()
    expect(impressos).toEqual(['k1', 'k2', 'c1'])
    expect(informados.every(([, ok]) => ok)).toBe(true)
  })

  it('falha numa impressora é informada como erro e não impede as outras', async () => {
    const informados: Record<string, [boolean, string | null]> = {}
    const filas = new FilasPorDispositivo(
      async (t) => {
        if (t.nomeSistema === 'SUMIU') throw new Error("Impressora 'SUMIU' nao encontrada no Windows.")
      },
      async (id, ok, erro) => {
        informados[id] = [ok, erro]
      },
    )
    filas.receber([
      { id: 'a', nomeSistema: 'SUMIU', segundosRestantes: 60 },
      { id: 'b', nomeSistema: 'OK', segundosRestantes: 60 },
    ])
    await filas.esvaziar()
    expect(informados.a[0]).toBe(false)
    expect(informados.a[1]).toContain('nao encontrada')
    expect(informados.b).toEqual([true, null])
  })

  it('trabalho vencido não é impresso', async () => {
    let t0 = 1_000_000
    const imprimir = vi.fn(async () => {})
    const informados: [string, boolean, string | null][] = []
    const filas = new FilasPorDispositivo(imprimir, async (id, ok, erro) => { informados.push([id, ok, erro]) }, () => t0)
    let soltar!: () => void
    const trava = new Promise<void>((r) => (soltar = r))
    // Primeiro trabalho demora; o segundo vence enquanto espera na fila.
    imprimir.mockImplementationOnce(async () => { await trava })
    filas.receber([
      { id: 'lento', nomeSistema: 'X', segundosRestantes: 600 },
      { id: 'curto', nomeSistema: 'X', segundosRestantes: 5 },
    ])
    t0 += 10_000
    soltar()
    await filas.esvaziar()
    expect(imprimir).toHaveBeenCalledTimes(1)
    expect(informados.find(([id]) => id === 'curto')?.[1]).toBe(false)
  })

  it('o mesmo trabalho recebido duas vezes (duas consultas) é impresso uma vez', async () => {
    const imprimir = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)) })
    const filas = new FilasPorDispositivo(imprimir, async () => {})
    const t = { id: 'x', nomeSistema: 'X', segundosRestantes: 60 }
    filas.receber([t])
    filas.receber([t])
    await filas.esvaziar()
    expect(imprimir).toHaveBeenCalledTimes(1)
  })
})
