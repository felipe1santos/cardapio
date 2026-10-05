import { describe, expect, it } from 'vitest'
import { atendimentoNoCard, origemVisivelNoCard } from './pedido-origem'

const base = { tipo: 'entrega' as const, canal: 'delivery', origem: 'cardapio', mesa: null, lancadoVia: null, criadoPorNome: null, comandaNumero: null, comandaSenha: null }

describe('origem no card do Kanban (item 56)', () => {
  it('vitrine direta ou sem origem: nada', () => {
    expect(origemVisivelNoCard({ ...base, origemCanal: 'direto' })).toBeNull()
    expect(origemVisivelNoCard({ ...base, origemCanal: null })).toBeNull()
  })
  it('vitrine com origem: ícone, nome curto e dica com a campanha', () => {
    expect(origemVisivelNoCard({ ...base, origemCanal: 'google_anuncio' })).toMatchObject({ icone: 'google_anuncio', rotulo: 'Google' })
    expect(origemVisivelNoCard({ ...base, origemCanal: 'instagram', origemCampanha: 'festa' })?.dica).toBe('Origem: Instagram (campanha festa)')
    expect(origemVisivelNoCard({ ...base, origemCanal: 'whatsapp', origemCampanha: 'robô' })?.dica).toBe('Origem: WhatsApp (robô de atendimento)')
  })
  it('PDV, balcão e mesa mostram o canal presencial', () => {
    expect(origemVisivelNoCard({ ...base, canal: 'balcao', origem: 'pdv', tipo: 'retirada' })?.rotulo).toBe('PDV')
    expect(origemVisivelNoCard({ ...base, canal: 'mesa', origem: 'pdv', mesa: '4', lancadoVia: 'salao' })?.rotulo).toBe('Salão')
  })
  it('atendimento: BALCÃO para retirada do balcão; ENTREGA, RETIRADA e MESA como antes', () => {
    expect(atendimentoNoCard({ ...base, canal: 'balcao', origem: 'pdv', tipo: 'retirada' })).toBe('BALCÃO')
    expect(atendimentoNoCard({ ...base })).toBe('ENTREGA')
    expect(atendimentoNoCard({ ...base, tipo: 'retirada' })).toBe('RETIRADA')
    expect(atendimentoNoCard({ ...base, canal: 'mesa', mesa: '2' })).toBe('MESA')
  })
})
