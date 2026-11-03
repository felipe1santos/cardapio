import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }))
vi.mock('@/lib/queries/campanhas', () => ({ uploadMidiaCampanha: vi.fn(async () => 'https://x/nova.jpg') }))

import { Recorrentes } from './recorrentes'

/** 03/11/2026: aba Campanhas = 3 cards fixos com toggle, galeria, programação e "pular hoje". */

const card = (tipo: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${tipo}`, tipo, ativa: false, mensagem: 'Oi {nome}! {link}', incluirLink: true, imagens: [], imagemIndice: 0,
  diasSemana: [0, 1, 2, 3, 4, 5, 6], hora: '17:00', janelaFim: '19:00', pularAte: null, proximoDisparoEm: null,
  ultimaRodadaEm: null, ultimaCampanhaId: null, ultimaRodadaMotivo: null, desligadoMotivo: null, ultimaRodada: null, ...extra,
})

function fetchFalso() {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const cards = [card('recuperacao'), card('nunca_compraram'), card('promocoes', { ativa: true, ultimaRodadaEm: '2026-11-03T20:00:00Z', ultimaRodadaMotivo: 'ok', ultimaRodada: { destinatarios: 40, enviados: 12, erros: 0, status: 'enviando' } })]
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init })
    const json = (v: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => v })
    if (url.endsWith('/estimativa')) return json({ pessoas: 7 })
    if (init?.method === 'PATCH') {
      const tipo = url.split('/').pop()!
      const body = JSON.parse(String(init.body))
      return json({ ...cards.find((c) => c.tipo === tipo)!, ...body })
    }
    return json(cards)
  })
  globalThis.fetch = f as unknown as typeof fetch
  return { chamadas }
}

describe('Recorrentes', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('mostra os 3 cards, a estimativa e a última rodada', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    expect(await screen.findByTestId('card-recuperacao')).toBeInTheDocument()
    expect(screen.getByTestId('card-nunca_compraram')).toBeInTheDocument()
    expect(screen.getByTestId('card-promocoes')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/7 pessoas/).length).toBe(3))
    expect(screen.getByTestId('rodada-promocoes').textContent).toMatch(/12 de 40/)
  })

  it('o toggle liga o card com PATCH {"ativa":true}', async () => {
    const { chamadas } = fetchFalso()
    const onToast = vi.fn()
    render(<Recorrentes restauranteId="L1" onToast={onToast} />)
    const toggle = await screen.findByTestId('toggle-recuperacao')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/admin/campanhas/recorrentes/recuperacao' && c.init?.method === 'PATCH' && c.init.body === '{"ativa":true}')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('toggle-recuperacao')).toHaveAttribute('aria-checked', 'true'))
  })

  it('fora de edição: só texto (dias e horário); os campos aparecem ao clicar em Editar', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    await screen.findByTestId('card-promocoes')
    expect(screen.getByTestId('resumo-promocoes').textContent).toMatch(/todos os dias/)
    expect(screen.queryByTestId('hora-promocoes')).toBeNull()
    expect(screen.queryByTestId('mensagem-promocoes')).toBeNull()
    fireEvent.click(screen.getByTestId('editar-promocoes'))
    expect(screen.getByTestId('hora-promocoes')).toBeInTheDocument()
    expect(screen.getByTestId('mensagem-promocoes')).toBeInTheDocument()
  })

  it('"Pular hoje" manda pularHoje e desabilita o botão', async () => {
    const { chamadas } = fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('pular-promocoes'))
    await waitFor(() => expect(chamadas.some((c) => c.url.endsWith('/promocoes') && c.init?.body === '{"pularHoje":true}')).toBe(true))
  })

  it('erro na API vira toast de erro', async () => {
    fetchFalso()
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Caiu' }) })) as unknown as typeof fetch
    const onToast = vi.fn()
    render(<Recorrentes restauranteId="L1" onToast={onToast} />)
    expect(await screen.findByTestId('recorrentes-erro')).toHaveTextContent('Caiu')
  })
})
