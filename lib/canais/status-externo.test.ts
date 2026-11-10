import { describe, expect, it } from 'vitest'
import { avancaPara, statusAntesDoCancelamento, statusMenuziaDeEventoIfood } from './tipos'

// Homologação iFood (09/11): "se outro sistema alterar o status do pedido, sua aplicação deve atualizar o estado interno"
// e "CANCELLATION_REQUEST_FAILED → tentar novamente". Ver docs: /docs/food/guides/modules/order/{homologation,events}.

describe('iFood: evento de status vindo de outro sistema → status Menuzia', () => {
  it('CFM, RTP, DSP e CON viram preparando, pronto, em rota e entregue', () => {
    expect(statusMenuziaDeEventoIfood('CFM')).toBe('preparando')
    expect(statusMenuziaDeEventoIfood('RTP')).toBe('pronto')
    expect(statusMenuziaDeEventoIfood('DSP')).toBe('em_rota')
    expect(statusMenuziaDeEventoIfood('CON')).toBe('entregue')
  })
  it('outros eventos não mexem no status', () => {
    for (const c of ['PLC', 'CAN', 'CAR', 'CARF', 'SPS', 'SPE', 'ADR', 'HSD', 'OPA', '']) expect(statusMenuziaDeEventoIfood(c)).toBeNull()
  })
})

describe('avancaPara: só anda para frente', () => {
  it('avança de recebido até entregue', () => {
    expect(avancaPara('recebido', 'preparando')).toBe(true)
    expect(avancaPara('preparando', 'pronto')).toBe(true)
    expect(avancaPara('recebido', 'entregue')).toBe(true)
  })
  it('nunca volta nem repete', () => {
    expect(avancaPara('pronto', 'preparando')).toBe(false)
    expect(avancaPara('preparando', 'preparando')).toBe(false)
    expect(avancaPara('em_rota', 'pronto')).toBe(false)
  })
  it('pedido cancelado ou entregue não muda', () => {
    expect(avancaPara('cancelado', 'pronto')).toBe(false)
    expect(avancaPara('entregue', 'entregue')).toBe(false)
  })
  it('status desconhecido não muda', () => {
    expect(avancaPara('agendado', 'pronto')).toBe(false)
  })
})

describe('cancelamento recusado pelo app: status de volta', () => {
  it('volta para a última etapa que o pedido já tinha alcançado', () => {
    expect(statusAntesDoCancelamento({ preparando_em: 'a', pronto_em: 'b', em_rota_em: 'c', entregue_em: null })).toBe('em_rota')
    expect(statusAntesDoCancelamento({ preparando_em: 'a', pronto_em: 'b', em_rota_em: null, entregue_em: null })).toBe('pronto')
    expect(statusAntesDoCancelamento({ preparando_em: 'a', pronto_em: null, em_rota_em: null, entregue_em: null })).toBe('preparando')
  })
  it('sem nenhuma etapa: volta para recebido', () => {
    expect(statusAntesDoCancelamento({ preparando_em: null, pronto_em: null, em_rota_em: null, entregue_em: null })).toBe('recebido')
  })
})
