import { describe, expect, it } from 'vitest'
import { configParaTela, errosConfig, formasDoCanal, formasPadrao, lerFormas, pedidoAceito, rotuloVale, somenteOnline, textoFormas } from './formas-pagamento'

const nada = { pixOnline: false, cartaoOnline: false }
const tudo = { pixOnline: true, cartaoOnline: true }

describe('formas de pagamento (0217)', () => {
  it('coluna nula = o que a vitrine mostrava antes (Pix pela chave só sem Pix online)', () => {
    expect(formasPadrao(nada)).toEqual(['pix', 'credito', 'debito', 'dinheiro'])
    expect(formasPadrao(tudo)).toEqual(['pix_online', 'cartao_online', 'credito', 'debito', 'dinheiro'])
    expect(formasDoCanal(null, 'entrega', tudo)).toEqual(formasPadrao(tudo))
    expect(configParaTela(null, nada).retirada).toEqual(['pix', 'credito', 'debito', 'dinheiro'])
  })
  it('lê a coluna e descarta lixo; vazia vira legado', () => {
    expect(lerFormas({ entrega: ['dinheiro', 'xx', 'pix'], retirada: ['pix'], vale_bandeiras: ['Alelo', 'Alelo', ' '] })).toEqual({ entrega: ['pix', 'dinheiro'], retirada: ['pix'], vale_bandeiras: ['Alelo'] })
    expect(lerFormas({ entrega: [], retirada: [] })).toBeNull()
    expect(lerFormas('x')).toBeNull()
  })
  it('por canal, e o online só aparece conectado; vale só com bandeira', () => {
    const cfg = { entrega: ['pix_online', 'dinheiro', 'vale'] as const, retirada: ['pix', 'credito'] as const, vale_bandeiras: ['Alelo'] }
    const c = { ...cfg, entrega: [...cfg.entrega], retirada: [...cfg.retirada] }
    expect(formasDoCanal(c, 'entrega', nada)).toEqual(['dinheiro', 'vale'])
    expect(formasDoCanal(c, 'entrega', tudo)).toEqual(['pix_online', 'dinheiro', 'vale'])
    expect(formasDoCanal(c, 'retirada', tudo)).toEqual(['pix', 'credito'])
    expect(formasDoCanal({ ...c, vale_bandeiras: [] }, 'entrega', nada)).toEqual(['dinheiro'])
  })
  it('servidor: aceita só o marcado no canal; vale exige bandeira aceita', () => {
    const c = { entrega: ['dinheiro', 'vale', 'debito'] as ('dinheiro' | 'vale' | 'debito')[], retirada: ['pix'] as 'pix'[], vale_bandeiras: ['Alelo'] }
    expect(pedidoAceito(c, 'entrega', { pagamento: 'dinheiro' })).toBe(true)
    expect(pedidoAceito(c, 'entrega', { pagamento: 'pix' })).toBe(false)
    expect(pedidoAceito(c, 'retirada', { pagamento: 'pix' })).toBe(true)
    expect(pedidoAceito(c, 'retirada', { pagamento: 'pix', pixOnline: true })).toBe(false)
    expect(pedidoAceito(c, 'entrega', { pagamento: 'cartao' })).toBe(true)
    expect(pedidoAceito(c, 'entrega', { pagamento: 'cartao', cartaoTipo: 'credito' })).toBe(false)
    expect(pedidoAceito(c, 'entrega', { pagamento: 'vale', valeBandeira: 'Alelo' })).toBe(true)
    expect(pedidoAceito(c, 'entrega', { pagamento: 'vale', valeBandeira: 'Ticket' })).toBe(false)
    expect(pedidoAceito(null, 'entrega', { pagamento: 'pix' })).toBe(true)
  })
  it('ao menos uma forma por canal, bandeira quando aceita vale; somente online', () => {
    expect(errosConfig({ entrega: [], retirada: ['pix'], vale_bandeiras: [] }, [])).toHaveLength(2)
    expect(errosConfig({ entrega: ['vale'], retirada: ['pix'], vale_bandeiras: [] }, null)).toEqual(['Escolha as bandeiras de vale aceitas.'])
    expect(somenteOnline({ entrega: ['dinheiro'], retirada: ['pix'], vale_bandeiras: [] }, { pixOnline: true, cartaoOnline: false })).toEqual({ entrega: ['pix_online'], retirada: ['pix_online'], vale_bandeiras: [] })
  })
  it('rótulos', () => {
    expect(rotuloVale('Alelo')).toBe('VR · Alelo')
    expect(textoFormas(['pix', 'debito', 'vale'], ['Alelo', 'VR'], 'entrega')).toEqual(['Pix', 'Cartão de débito (na entrega)', 'Vale-refeição/alimentação: Alelo, VR'])
  })
})
