import { describe, expect, it } from 'vitest'
import { decidirAlarme, duracaoValida } from './alarme.js'

const vazio = { tocar: false, sabido: 0, okEm: 0, avisados: [] as number[], novos: [] as number[] }

describe('alarme do Assistente (1.2.1): toca UMA vez por pedido novo, só no dono da Cozinha', () => {
  it('pedido novo → toca uma vez; o mesmo pedido ainda esperando → não toca de novo', () => {
    const a = decidirAlarme(vazio, { aguardando: 1, numeros: [290] }, 1)
    expect(a).toMatchObject({ tocar: true, sabido: 1, novos: [290] })
    const b = decidirAlarme(a, { aguardando: 1, numeros: [290] }, 2)
    expect(b).toMatchObject({ tocar: false, novos: [] })
  })
  it('dois pedidos juntos → um toque só para o lote', () => {
    expect(decidirAlarme(vazio, { aguardando: 2, numeros: [290, 291] }, 1)).toMatchObject({ tocar: true, novos: [290, 291] })
  })
  it('segundo pedido chegando depois → toca de novo só por ele', () => {
    const a = decidirAlarme(vazio, { aguardando: 1, numeros: [290] }, 1)
    expect(decidirAlarme(a, { aguardando: 2, numeros: [290, 291] }, 2)).toMatchObject({ tocar: true, novos: [291] })
  })
  it('aceitaram (0) → nada novo para tocar (o toque em andamento termina sozinho)', () => {
    const a = decidirAlarme(vazio, { aguardando: 1, numeros: [290] }, 1)
    expect(decidirAlarme(a, { aguardando: 0, numeros: [] }, 2)).toMatchObject({ tocar: false, sabido: 0 })
  })
  it('resposta sem alarme (não é o dono da Cozinha, servidor antigo) → sem som', () => {
    expect(decidirAlarme({ ...vazio, tocar: true, sabido: 2 }, undefined, 3)).toMatchObject({ tocar: false, sabido: 0 })
  })
  it('duração: 5, 8 ou 15 s; qualquer outra coisa vira 8', () => {
    expect(duracaoValida(5)).toBe(5)
    expect(duracaoValida(15)).toBe(15)
    expect(duracaoValida(undefined)).toBe(8)
    expect(duracaoValida(60)).toBe(8)
  })
})
