import { describe, expect, it } from 'vitest'
import { ehNaoEntregue, quemCancelou, rotuloCancelamento } from './cancelamento'

const base = { status: 'cancelado', canceladoMotivo: 'cliente_desistiu' as string | null, canceladoPor: null as string | null, canceladoObservacao: null as string | null, etapas: { emRota: null as string | null }, saiuParaEntregaEm: null as string | null }

describe('Cancelado ≠ Não entregue (Bloco B, 19/10)', () => {
  it('"Não entregue" só quando saiu para entrega e não foi entregue', () => {
    expect(ehNaoEntregue({ ...base, canceladoMotivo: 'nao_entregue', etapas: { emRota: '2026-10-19T01:00:00Z' } })).toBe(true)
    expect(ehNaoEntregue({ ...base, canceladoMotivo: 'nao_entregue', saiuParaEntregaEm: '2026-10-19T01:00:00Z' })).toBe(true)
    // Motivo nao_entregue num pedido que nunca saiu (aviso de 12 h antigo) NÃO é "Não entregue".
    expect(ehNaoEntregue({ ...base, canceladoMotivo: 'nao_entregue' })).toBe(false)
    expect(ehNaoEntregue({ ...base, canceladoMotivo: 'cliente_desistiu', etapas: { emRota: '2026-10-19T01:00:00Z' } })).toBe(false)
    expect(ehNaoEntregue({ ...base, status: 'entregue', canceladoMotivo: 'nao_entregue', etapas: { emRota: 'x' } })).toBe(false)
  })

  it('quem cancelou: cliente (robô/IA no WhatsApp), loja (painel), motoboy (app), sistema (Pix expirado)', () => {
    expect(quemCancelou({ ...base, canceladoPor: 'Cliente (WhatsApp robô)' })).toEqual({ origem: 'cliente', nome: null, via: 'robô' })
    expect(quemCancelou({ ...base, canceladoPor: 'Cliente (WhatsApp IA) · aplicado por Ana' })).toEqual({ origem: 'cliente', nome: 'Ana', via: 'IA' })
    // Formatos gravados antes de 19/10
    expect(quemCancelou({ ...base, canceladoPor: 'Robô (WhatsApp)' })).toEqual({ origem: 'cliente', nome: null, via: 'robô' })
    expect(quemCancelou({ ...base, canceladoPor: 'Agente de IA (WhatsApp)' })).toEqual({ origem: 'cliente', nome: null, via: 'IA' })
    expect(quemCancelou({ ...base, canceladoPor: 'Agente de IA' })).toEqual({ origem: 'cliente', nome: null, via: 'IA' })
    expect(quemCancelou({ ...base, canceladoPor: 'cliente' })).toEqual({ origem: 'cliente', nome: null, via: null })
    expect(quemCancelou({ ...base, canceladoPor: 'Loja: Felipe' })).toEqual({ origem: 'loja', nome: 'Felipe', via: null })
    expect(quemCancelou({ ...base, canceladoPor: 'felipe@loja.com' })).toEqual({ origem: 'loja', nome: 'felipe@loja.com', via: null })
    expect(quemCancelou({ ...base, canceladoPor: 'Entregador: Zé', canceladoMotivo: 'nao_entregue' })).toEqual({ origem: 'motoboy', nome: 'Zé', via: null })
    expect(quemCancelou({ ...base, canceladoPor: 'Entregador', canceladoMotivo: 'nao_entregue' })).toEqual({ origem: 'motoboy', nome: null, via: null })
    expect(quemCancelou({ ...base, canceladoPor: 'sistema', canceladoMotivo: 'pix_expirado' })).toEqual({ origem: 'sistema', nome: null, via: null })
    expect(quemCancelou({ ...base, canceladoPor: null, canceladoMotivo: 'pagamento_expirado' })).toEqual({ origem: 'sistema', nome: null, via: null })
    expect(quemCancelou({ ...base, canceladoPor: null })).toEqual({ origem: 'loja', nome: null, via: null })
  })

  it('rótulo: título, quem e motivo (card, painel e relatórios)', () => {
    expect(rotuloCancelamento({ ...base, canceladoPor: 'Cliente (WhatsApp robô)', canceladoObservacao: 'quero cancelar' }))
      .toEqual({ titulo: 'Cancelado', quem: 'pelo cliente (robô)', motivo: 'Cliente desistiu · quero cancelar' })
    expect(rotuloCancelamento({ ...base, canceladoPor: 'Loja: Felipe', canceladoMotivo: 'sem_estoque' }))
      .toEqual({ titulo: 'Cancelado', quem: 'pela loja · Felipe', motivo: 'Sem estoque' })
    expect(rotuloCancelamento({ ...base, canceladoPor: 'Entregador: Zé', canceladoMotivo: 'nao_entregue', canceladoObservacao: 'cliente não atendeu', etapas: { emRota: 'x' } }))
      .toEqual({ titulo: 'Não entregue', quem: 'pelo motoboy Zé', motivo: 'cliente não atendeu' })
    expect(rotuloCancelamento({ ...base, canceladoPor: 'Loja: Ana', canceladoMotivo: 'nao_entregue', canceladoObservacao: null, etapas: { emRota: 'x' } }))
      .toEqual({ titulo: 'Não entregue', quem: 'pela loja · Ana', motivo: 'Não entregue pelo entregador' })
    expect(rotuloCancelamento({ ...base, canceladoPor: 'sistema', canceladoMotivo: 'pix_expirado', canceladoObservacao: 'Pix online não pago no prazo' }))
      .toEqual({ titulo: 'Cancelado', quem: 'pelo sistema', motivo: 'Pix não pago no prazo · Pix online não pago no prazo' })
  })
})
