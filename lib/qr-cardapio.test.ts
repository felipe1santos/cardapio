import { describe, it, expect } from 'vitest'
import {
  MAX_ETIQUETAS,
  MODELOS_ETIQUETA,
  descricaoDoModelo,
  modeloEtiqueta,
  montarEtiquetas,
  nomeArquivoQr,
  paginarEtiquetas,
  rotuloMesa,
  urlCardapio,
} from './qr-cardapio'

describe('urlCardapio', () => {
  it('monta a URL pública do cardápio', () => {
    expect(urlCardapio('https://app.menuzia.com.br', 'fire-house')).toBe(
      'https://app.menuzia.com.br/loja/fire-house',
    )
  })

  it('não duplica a barra quando a origem termina em /', () => {
    expect(urlCardapio('http://localhost:3000/', 'menuzia')).toBe('http://localhost:3000/loja/menuzia')
  })
})

describe('modeloEtiqueta', () => {
  it('encontra cada modelo declarado', () => {
    for (const m of MODELOS_ETIQUETA) expect(modeloEtiqueta(m.id).id).toBe(m.id)
  })

  it('cai no primeiro modelo quando o id é desconhecido', () => {
    // @ts-expect-error — simula valor vindo de fora do type (ex.: state antigo)
    expect(modeloEtiqueta('inexistente').id).toBe(MODELOS_ETIQUETA[0].id)
  })
})

describe('montarEtiquetas', () => {
  it('gera uma etiqueta por cópia quando não há mesa selecionada', () => {
    const etiquetas = montarEtiquetas({ mesas: [], quantidade: 3 })
    expect(etiquetas).toHaveLength(3)
    expect(etiquetas.every((e) => e.mesa === null)).toBe(true)
  })

  it('repete cada mesa pelo número de cópias', () => {
    const etiquetas = montarEtiquetas({ mesas: ['Mesa 1', 'Mesa 2'], quantidade: 2 })
    expect(etiquetas.map((e) => e.mesa)).toEqual(['Mesa 1', 'Mesa 1', 'Mesa 2', 'Mesa 2'])
  })

  it('usa ao menos uma cópia quando a quantidade é inválida', () => {
    expect(montarEtiquetas({ mesas: ['Mesa 1'], quantidade: 0 })).toHaveLength(1)
    expect(montarEtiquetas({ mesas: [], quantidade: Number.NaN })).toHaveLength(1)
  })

  it('corta no limite máximo de etiquetas', () => {
    expect(montarEtiquetas({ mesas: [], quantidade: 9999 })).toHaveLength(MAX_ETIQUETAS)
  })

  it('gera ids únicos (chave do React)', () => {
    const etiquetas = montarEtiquetas({ mesas: ['Mesa 1', 'Mesa 2'], quantidade: 2 })
    expect(new Set(etiquetas.map((e) => e.id)).size).toBe(etiquetas.length)
  })
})

describe('paginarEtiquetas', () => {
  it('quebra em folhas do tamanho do modelo', () => {
    const etiquetas = montarEtiquetas({ mesas: [], quantidade: 9 })
    const paginas = paginarEtiquetas(etiquetas, 4)
    expect(paginas.map((p) => p.length)).toEqual([4, 4, 1])
  })

  it('devolve lista vazia sem etiquetas', () => {
    expect(paginarEtiquetas([], 8)).toEqual([])
  })

  it('não entra em laço infinito com porPagina zero', () => {
    expect(paginarEtiquetas(montarEtiquetas({ mesas: [], quantidade: 2 }), 0)).toHaveLength(2)
  })
})

describe('nomeArquivoQr', () => {
  it('usa o slug da loja', () => {
    expect(nomeArquivoQr('fire-house')).toBe('qrcode-cardapio-fire-house.png')
  })

  it('limpa caracteres inválidos', () => {
    expect(nomeArquivoQr('Loja do Zé!')).toBe('qrcode-cardapio-loja-do-z.png')
  })

  it('tem fallback quando o slug some', () => {
    expect(nomeArquivoQr('')).toBe('qrcode-cardapio-loja.png')
  })
})

describe('rotuloMesa', () => {
  it('prefixa mesas cadastradas só como número', () => {
    expect(rotuloMesa('01')).toBe('Mesa 01')
    expect(rotuloMesa('7')).toBe('Mesa 7')
  })

  it('mantém o nome quando ele já diz o que é', () => {
    expect(rotuloMesa('Mesa 3')).toBe('Mesa 3')
    expect(rotuloMesa('Varanda')).toBe('Varanda')
  })
})

/**
 * Loja com mesas tem DOIS QRs: o de cada mesa (`/mesa/<token>`, autoatendimento)
 * e o do delivery (`/loja/<slug>`, vitrine). Em produção o lojista imprimiu a
 * folha do delivery — que dizia "para colar direto no tampo da mesa" — colou na
 * mesa, e o cliente que escaneou caiu na vitrine de entrega.
 */
describe('descricaoDoModelo', () => {
  it('a folha do delivery não manda colar na mesa', () => {
    for (const m of MODELOS_ETIQUETA) {
      const texto = descricaoDoModelo(m, 'delivery')
      expect(texto, `modelo ${m.id}`).not.toMatch(/mesa|guardanapo/i)
    }
  })

  it('a folha das mesas continua falando de mesa', () => {
    expect(descricaoDoModelo(modeloEtiqueta('adesivo'), 'mesa')).toMatch(/mesa/i)
  })

  it('todo modelo tem os dois textos', () => {
    for (const m of MODELOS_ETIQUETA) {
      expect(m.descricao.length).toBeGreaterThan(10)
      expect(m.descricaoDelivery.length).toBeGreaterThan(10)
    }
  })
})
