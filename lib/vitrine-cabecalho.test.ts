import { describe, expect, it } from 'vitest'
import { CABECALHO_PADRAO, cabecalhoVitrine } from './vitrine-cabecalho'

describe('cabeçalho da vitrine configurável', () => {
  it('loja que nunca escolheu vê tudo, como antes', () => {
    expect(cabecalhoVitrine(null)).toEqual(CABECALHO_PADRAO)
    expect(cabecalhoVitrine({})).toEqual(CABECALHO_PADRAO)
  })
  it('respeita só o que foi desligado', () => {
    expect(cabecalhoVitrine({ tempo: false, avaliacao: false })).toEqual({ status: true, tempo: false, avaliacao: false, endereco: true })
  })
  it('valor estranho vale o padrão', () => {
    expect(cabecalhoVitrine({ status: 'nao', endereco: 0 })).toEqual(CABECALHO_PADRAO)
  })
})
