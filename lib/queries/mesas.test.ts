import { describe, it, expect } from 'vitest'
import { mapMesaRow } from './mesas'

describe('mapMesaRow', () => {
  it('mapeia uma linha do banco para Mesa', () => {
    const row = { id: 'm1', restaurante_id: 'r1', nome: 'Mesa 1', ordem: 2, ativa: true, criado_em: 'x' }
    expect(mapMesaRow(row)).toEqual({ id: 'm1', nome: 'Mesa 1', ordem: 2, ativa: true })
  })

  it('trata ativa ausente como true', () => {
    const row = { id: 'm2', restaurante_id: 'r1', nome: 'Balcão', ordem: 0, ativa: null, criado_em: 'x' }
    expect(mapMesaRow(row).ativa).toBe(true)
  })
})
