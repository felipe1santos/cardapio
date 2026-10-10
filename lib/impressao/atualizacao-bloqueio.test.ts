import { describe, expect, it } from 'vitest'
import { bloqueiaAtualizacao, deveGravarIp, ipDoRequest, IP_A_CADA_MS } from './atualizacao-bloqueio'

const h = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null })

describe('loja fora da atualização automática (Villa)', () => {
  it('IP: primeiro do x-forwarded-for; senão x-real-ip; lixo vira nulo', () => {
    expect(ipDoRequest(h({ 'x-forwarded-for': '200.1.2.3, 10.0.0.1' }))).toBe('200.1.2.3')
    expect(ipDoRequest(h({ 'x-real-ip': '2804:14c::1' }))).toBe('2804:14c::1')
    expect(ipDoRequest(h({ 'x-forwarded-for': '<script>' }))).toBeNull()
    expect(ipDoRequest(h({}))).toBeNull()
  })
  it('bloqueia só o IP de computador da loja marcada', () => {
    expect(bloqueiaAtualizacao('200.1.2.3', ['200.1.2.3', null])).toBe(true)
    expect(bloqueiaAtualizacao('200.9.9.9', ['200.1.2.3'])).toBe(false)
    expect(bloqueiaAtualizacao(null, ['200.1.2.3'])).toBe(false)
  })
  it('grava o IP no máximo a cada 10 min, ou quando muda', () => {
    expect(deveGravarIp(undefined, '1.1.1.1', 0)).toBe(true)
    expect(deveGravarIp({ ip: '1.1.1.1', em: 0 }, '1.1.1.1', IP_A_CADA_MS - 1)).toBe(false)
    expect(deveGravarIp({ ip: '1.1.1.1', em: 0 }, '1.1.1.1', IP_A_CADA_MS)).toBe(true)
    expect(deveGravarIp({ ip: '1.1.1.1', em: 0 }, '2.2.2.2', 1)).toBe(true)
  })
})
