import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TelaPixOnline } from './tela-pix-online'

// Teste real de 2026-10-07: a tela mostrava "Pague em até 14:24" (era o contador mm:ss) para um Pix
// que vencia às 03:30 de Brasília. Agora: hora-limite no fuso de Brasília + contador separado.
const PIX = { id: 'p1', numero: 169, valor: 1, qrCode: 'COPIA', qrCodeBase64: null, expiraEm: '2026-10-07T06:30:00.000Z' }

function respostaComData(dataServidor: string) {
  return Promise.resolve(new Response(JSON.stringify({ situacao: 'aguardando', qrCode: 'COPIA', qrCodeBase64: null }), {
    status: 200, headers: { 'Content-Type': 'application/json', date: dataServidor },
  }))
}

describe('Tela do Pix online: horário e contador', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: false }) })
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

  it('mostra a hora-limite em Brasília (03:30) e o contador "Faltam"', async () => {
    vi.setSystemTime(new Date('2026-10-07T06:15:05.000Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respostaComData(new Date().toUTCString()))
    render(<TelaPixOnline slug="loja" pix={PIX} onPago={() => {}} onRefazer={() => {}} onFechar={() => {}} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByTestId('pix-horario').textContent).toContain('Pague até 03:30')
    expect(screen.getByTestId('pix-horario').textContent).toContain('horário de Brasília')
    expect(screen.getByTestId('pix-contador').textContent).toBe('Faltam 14:54')
  })

  it('celular com a hora errada: o contador segue o relógio do servidor', async () => {
    // Aparelho 10 min adiantado; o servidor diz 06:15:05.
    vi.setSystemTime(new Date('2026-10-07T06:25:05.000Z'))
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respostaComData(new Date('2026-10-07T06:15:05.000Z').toUTCString()))
    render(<TelaPixOnline slug="loja" pix={PIX} onPago={() => {}} onRefazer={() => {}} onFechar={() => {}} />)
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(screen.getByTestId('pix-contador').textContent).toMatch(/^Faltam 14:5\d$/)
  })
})
