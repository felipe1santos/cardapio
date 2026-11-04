import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }))
vi.mock('@/lib/queries/campanhas', () => ({ uploadMidiaCampanha: vi.fn(async () => 'https://x/nova.jpg') }))

import { Recorrentes } from './recorrentes'

/** 03/11/2026: cards com resumo em texto; configuração no modal; sem "pular hoje"; ligar exige imagem (API). */

const card = (tipo: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${tipo}`, tipo, ativa: false, mensagem: 'Oi {nome}! {link}', incluirLink: true,
  imagens: [{ url: 'https://x/a.jpg', mensagem: '' }], imagemIndice: 0,
  diasSemana: [0, 1, 2, 3, 4, 5, 6], hora: '17:00', janelaFim: '19:00', proximoDisparoEm: null,
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

  it('o card mostra resumo em texto (dias, horário) e NÃO mostra a mensagem nem campos de edição', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    await screen.findByTestId('card-promocoes')
    expect(screen.getByTestId('resumo-promocoes').textContent).toMatch(/todos os dias/)
    expect(screen.getByTestId('resumo-promocoes').textContent).toMatch(/17:00 às 19:00/)
    expect(screen.queryByTestId('mensagem-promocoes')).toBeNull()
    expect(screen.queryByTestId('hora-promocoes')).toBeNull()
    expect(screen.queryByTestId('pular-promocoes')).toBeNull()
  })

  it('o toggle liga o card com PATCH {"ativa":true}', async () => {
    const { chamadas } = fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    const toggle = await screen.findByTestId('toggle-recuperacao')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/admin/campanhas/recorrentes/recuperacao' && c.init?.method === 'PATCH' && c.init.body === '{"ativa":true}')).toBe(true))
    await waitFor(() => expect(screen.getByTestId('toggle-recuperacao')).toHaveAttribute('aria-checked', 'true'))
  })

  it('"Configurar" abre o modal com a mensagem padrão e as imagens; salvar manda tudo num PATCH', async () => {
    const { chamadas } = fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('configurar-promocoes'))
    const modal = await screen.findByTestId('modal-config')
    expect(modal).toBeInTheDocument()
    expect((screen.getByTestId('mensagem-padrao') as HTMLTextAreaElement).value).toBe('Oi {nome}! {link}')
    expect(screen.getByTestId('modal-imagem-0')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('modal-msg-0'), { target: { value: 'Promo de terça!' } })
    fireEvent.click(screen.getByTestId('salvar-config'))
    await waitFor(() => expect(chamadas.some((c) => c.url.endsWith('/promocoes') && c.init?.method === 'PATCH' && String(c.init.body).includes('"mensagem":"Promo de terça!"'))).toBe(true))
  })

  it('ligar sem imagem: a API recusa (400) e o toast mostra a mensagem', async () => {
    fetchFalso()
    const onToast = vi.fn()
    render(<Recorrentes restauranteId="L1" onToast={onToast} />)
    await screen.findByTestId('card-recuperacao')
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'o card precisa de pelo menos 1 imagem para ligar' }) })) as unknown as typeof fetch
    fireEvent.click(screen.getByTestId('toggle-recuperacao'))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('erro', 'o card precisa de pelo menos 1 imagem para ligar'))
  })

  it('erro ao carregar vira aviso com "Tentar de novo"', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Caiu' }) })) as unknown as typeof fetch
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    expect(await screen.findByTestId('recorrentes-erro')).toHaveTextContent('Caiu')
  })
})
