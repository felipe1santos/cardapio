import { describe, expect, it } from 'vitest'
import { ehProvedorNovo, NOME_PROVEDOR, statusDeEventoIfood, statusDeEventoOd } from './provedores'

/** Etapa 3 (19/10): iFood Sob Demanda e Foody falam no MESMO vocabulário da Lalamove (card, painel, financeiro iguais). */
describe('provedores de entrega: eventos → status da corrida', () => {
  it('Open Delivery Logistics (Foody)', () => {
    expect(statusDeEventoOd('PENDING')).toBe('ASSIGNING_DRIVER')
    expect(statusDeEventoOd('ACCEPTED')).toBe('ASSIGNING_DRIVER')
    expect(statusDeEventoOd('PICKUP_ONGOING')).toBe('ON_GOING')
    expect(statusDeEventoOd('ARRIVED_AT_MERCHANT')).toBe('ON_GOING')
    expect(statusDeEventoOd('ORDER_PICKED')).toBe('PICKED_UP')
    expect(statusDeEventoOd('DELIVERY_ONGOING')).toBe('PICKED_UP')
    expect(statusDeEventoOd('ORDER_DELIVERED')).toBe('COMPLETED')
    expect(statusDeEventoOd('DELIVERY_FINISHED')).toBe('COMPLETED')
    expect(statusDeEventoOd('RETURNED_TO_MERCHANT')).toBe('CANCELED')
    expect(statusDeEventoOd('CANCELLED')).toBe('CANCELED')
    expect(statusDeEventoOd('REJECTED')).toBe('REJECTED')
    expect(statusDeEventoOd('qualquer coisa')).toBeNull()
  })
  it('iFood (códigos de entrega do polling)', () => {
    expect(statusDeEventoIfood('ASSIGN_DRIVER')).toBe('ON_GOING')
    expect(statusDeEventoIfood('GOING_TO_ORIGIN')).toBe('ON_GOING')
    expect(statusDeEventoIfood('DISPATCHED')).toBe('PICKED_UP')
    expect(statusDeEventoIfood('ARRIVED_AT_DESTINATION')).toBe('PICKED_UP')
    expect(statusDeEventoIfood('CONCLUDED')).toBe('COMPLETED')
    expect(statusDeEventoIfood('CANCELLED')).toBe('CANCELED')
    expect(statusDeEventoIfood('DELIVERY_FAILED')).toBe('REJECTED')
    expect(statusDeEventoIfood('PLACED')).toBe('ASSIGNING_DRIVER')
    expect(statusDeEventoIfood('')).toBeNull()
  })
  it('provedores novos e nomes', () => {
    expect(ehProvedorNovo('ifood')).toBe(true)
    expect(ehProvedorNovo('foody')).toBe(true)
    expect(ehProvedorNovo('machine')).toBe(true)
    expect(NOME_PROVEDOR.machine).toBe('Machine')
    expect(ehProvedorNovo('lalamove')).toBe(false)
    expect(NOME_PROVEDOR.foody).toBe('Foody')
  })
})
