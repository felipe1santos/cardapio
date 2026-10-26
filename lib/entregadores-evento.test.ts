import { describe, expect, it } from 'vitest'
import type { Entregador } from './queries/pedidos'
import { aplicarEventoEntregador, atualizarOnline } from './entregadores-evento'

describe('atualizarOnline (relógio local, sem requisição — revisão 26/10)', () => {
  it('quem não manda sinal há mais de 2 min deixa de aparecer online', () => {
    const agora = Date.parse('2026-10-25T20:00:00.000Z')
    const lista = [
      { id: 'a', online: true, ultimoAcessoEm: '2026-10-25T19:59:30.000Z' },
      { id: 'b', online: true, ultimoAcessoEm: '2026-10-25T19:55:00.000Z' },
    ] as Entregador[]
    expect(atualizarOnline(lista, agora).map((e) => [e.id, e.online])).toEqual([['a', true], ['b', false]])
  })
  it('nada mudou: devolve a mesma lista (sem re-render)', () => {
    const lista = [{ id: 'a', online: true, ultimoAcessoEm: new Date().toISOString() }] as Entregador[]
    expect(atualizarOnline(lista, Date.now())).toBe(lista)
  })
})

/**
 * Achado #7 da auditoria (25/10): o heartbeat do motoboy (UPDATE em `entregadores` a cada 30 s) fazia a Logística e o
 * Despacho relerem tudo (pedidos + motoboys + concluídos). Agora o evento é aplicado direto no motoboy da lista: online,
 * localização e status atualizam na hora, sem nenhuma requisição.
 */

const AGORA = Date.parse('2026-10-25T20:00:00.000Z')

function m(id: string, extra: Partial<Entregador> = {}): Entregador {
  return { id, nome: id.toUpperCase(), telefone: '', status: 'online', token: 't', emRota: 2, online: false, localizacao: null, fotoUrl: null, veiculo: '', placa: '', desativado: false, temLogin: false, ultimoAcessoEm: null, ...extra } as Entregador
}

const linha = (id: string, extra: Record<string, unknown> = {}) => ({
  id, nome: id.toUpperCase(), telefone: '', status: 'online', token: 't', ultimo_acesso_em: '2026-10-25T19:59:40.000Z',
  localizacao_lat: -20.3, localizacao_lng: -40.3, localizacao_atualizada_em: '2026-10-25T19:59:40.000Z',
  foto_url: null, veiculo: '', placa: '', desativado_em: null, usuario_id: null, ...extra,
})

describe('aplicarEventoEntregador', () => {
  it('heartbeat de motoboy conhecido: aplica na linha, sem recarregar, e ele aparece online', () => {
    const r = aplicarEventoEntregador([m('a'), m('b')], { eventType: 'UPDATE', new: linha('a'), old: { id: 'a' } }, AGORA)
    expect(r.recarregar).toBe(false)
    const a = r.lista.find((x) => x.id === 'a')!
    expect(a.online).toBe(true)
    expect(a.localizacao).toEqual({ lat: -20.3, lng: -40.3, atualizadaEm: '2026-10-25T19:59:40.000Z' })
    expect(a.ultimoAcessoEm).toBe('2026-10-25T19:59:40.000Z')
  })

  it('mantém o número de entregas em rota (vem dos pedidos, não do motoboy)', () => {
    const r = aplicarEventoEntregador([m('a', { emRota: 3 })], { eventType: 'UPDATE', new: linha('a'), old: { id: 'a' } }, AGORA)
    expect(r.lista[0].emRota).toBe(3)
  })

  it('heartbeat antigo deixa o motoboy offline', () => {
    const r = aplicarEventoEntregador([m('a', { online: true })], { eventType: 'UPDATE', new: linha('a', { ultimo_acesso_em: '2026-10-25T19:50:00.000Z' }), old: { id: 'a' } }, AGORA)
    expect(r.lista[0].online).toBe(false)
  })

  it('mudança de status/desativação também é aplicada', () => {
    const r = aplicarEventoEntregador([m('a')], { eventType: 'UPDATE', new: linha('a', { status: 'offline', desativado_em: '2026-10-25T19:00:00Z' }), old: { id: 'a' } }, AGORA)
    expect(r.lista[0].status).toBe('offline')
    expect(r.lista[0].desativado).toBe(true)
  })

  it('motoboy novo, apagado ou desconhecido: recarrega a lista', () => {
    expect(aplicarEventoEntregador([m('a')], { eventType: 'INSERT', new: linha('z'), old: {} }, AGORA).recarregar).toBe(true)
    expect(aplicarEventoEntregador([m('a')], { eventType: 'DELETE', new: {}, old: { id: 'a' } }, AGORA).recarregar).toBe(true)
    expect(aplicarEventoEntregador([m('a')], { eventType: 'UPDATE', new: linha('z'), old: { id: 'z' } }, AGORA).recarregar).toBe(true)
  })

  it('não mexe nos outros motoboys', () => {
    const b = m('b')
    const r = aplicarEventoEntregador([m('a'), b], { eventType: 'UPDATE', new: linha('a'), old: { id: 'a' } }, AGORA)
    expect(r.lista[1]).toBe(b)
  })
})
