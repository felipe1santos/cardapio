import { describe, expect, it } from 'vitest'
import { fraseTempo, resolverTempos, textoDaMedia } from './tempo-entrega'

describe('tempo de entrega/retirada (19/10): Perfil → robô (legado) → média do sistema → nada', () => {
  it('Perfil preenchido manda', () => {
    expect(resolverTempos({ perfilEntrega: '30–40 min', perfilRetirada: '15 min', roboEntrega: '50 min', mediaEntregaSeg: 2000, amostra: 30 }))
      .toEqual({ entrega: '30–40 min', retirada: '15 min', origemEntrega: 'perfil' })
  })
  it('sem Perfil: o tempo do robô (Integrações) ainda vale', () => {
    expect(resolverTempos({ perfilEntrega: '', perfilRetirada: null, roboEntrega: ' 50 min ', mediaEntregaSeg: 2000, amostra: 30 }))
      .toEqual({ entrega: '50 min', retirada: null, origemEntrega: 'robo' })
  })
  it('sem nada cadastrado: média real do sistema, arredondada de 5 em 5 min, só com amostra suficiente', () => {
    expect(resolverTempos({ perfilEntrega: null, perfilRetirada: null, roboEntrega: null, mediaEntregaSeg: 2130, amostra: 8 }))
      .toEqual({ entrega: 'em média 35 min', retirada: null, origemEntrega: 'media' })
    expect(resolverTempos({ perfilEntrega: null, perfilRetirada: null, roboEntrega: null, mediaEntregaSeg: 2130, amostra: 3 }))
      .toEqual({ entrega: null, retirada: null, origemEntrega: null })
  })
  it('textoDaMedia: minutos de 5 em 5, mínimo 10, hora e meia vira "1h30"', () => {
    expect(textoDaMedia(600)).toBe('em média 10 min')
    expect(textoDaMedia(2130)).toBe('em média 35 min')
    expect(textoDaMedia(5400)).toBe('em média 1h30')
    expect(textoDaMedia(200)).toBe('em média 10 min')
  })
  it('frase para o cliente: cadastrado = "fica pronto em…"; média = "costuma levar…"; sem dado = null (atendente)', () => {
    expect(fraseTempo({ entrega: '30–40 min', retirada: null, origemEntrega: 'perfil' }, 'entrega')).toBe('A entrega costuma levar *30–40 min* (pode variar com o movimento).')
    expect(fraseTempo({ entrega: 'em média 35 min', retirada: null, origemEntrega: 'media' }, 'entrega')).toBe('Pelos últimos pedidos, a entrega leva *em média 35 min* (pode variar com o movimento).')
    expect(fraseTempo({ entrega: '30 min', retirada: '15 min', origemEntrega: 'perfil' }, 'retirada')).toBe('Para retirada, fica pronto em *15 min* (pode variar com o movimento).')
    expect(fraseTempo({ entrega: null, retirada: null, origemEntrega: null }, 'entrega')).toBeNull()
    expect(fraseTempo({ entrega: '30 min', retirada: null, origemEntrega: 'perfil' }, 'retirada')).toBeNull()
  })
})
