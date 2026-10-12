import { describe, expect, it } from 'vitest'
import { decidirAlarme } from './alarme.js'

const vazio = { tocar: false, sabido: 0, okEm: 0, avisados: [] as number[], novos: [] as number[] }

describe('alarme do Assistente (1.2.0): toca até aceitar, só no dono da Cozinha', () => {
  it('pedido esperando aceite → toca e avisa o número uma vez', () => {
    const a = decidirAlarme(vazio, { aguardando: 1, numeros: [290] }, 1)
    expect(a).toMatchObject({ tocar: true, sabido: 1, novos: [290] })
    const b = decidirAlarme(a, { aguardando: 1, numeros: [290] }, 2)
    expect(b).toMatchObject({ tocar: true, novos: [] })
  })
  it('aceitaram/recusaram (0) → para', () => {
    const a = decidirAlarme(vazio, { aguardando: 1, numeros: [290] }, 1)
    expect(decidirAlarme(a, { aguardando: 0, numeros: [] }, 2)).toMatchObject({ tocar: false, sabido: 0 })
  })
  it('resposta sem alarme (não é o dono da Cozinha, servidor antigo) → sem som', () => {
    expect(decidirAlarme({ ...vazio, tocar: true, sabido: 2 }, undefined, 3)).toMatchObject({ tocar: false, sabido: 0 })
  })
})
