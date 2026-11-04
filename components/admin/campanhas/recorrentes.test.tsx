import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({ getBrowserSupabase: () => ({}) }))
vi.mock('@/lib/queries/campanhas', () => ({ uploadMidiaCampanha: vi.fn(async () => 'https://x/nova.jpg') }))

import { Recorrentes } from './recorrentes'

/** 04/11/2026 (0248): Recuperação com copies e grade 3 × 2; Promoções e Disparo personalizado com até 5 anúncios. */

const anuncio = (extra: Record<string, unknown> = {}) => ({
  id: 'a1', nome: 'Combo terça', cor: '#1d4ed8', mensagem: 'Hoje tem *combo*! {link}', imagens: ['https://x/p.jpg'], diasSemana: [2], hora: '17:00', janelaFim: '19:00',
  publicos: [], imagemIndice: 0, proximoDisparoEm: '2026-11-10T20:00:00Z', ultimaRodadaEm: null, ultimaRodadaMotivo: null, ...extra,
})

const card = (tipo: string, extra: Record<string, unknown> = {}) => ({
  id: `id-${tipo}`, tipo, ativa: false, mensagem: 'Oi {nome}! {link}', mensagens: [], mensagemIndice: 0, incluirLink: true,
  imagens: tipo === 'recuperacao' ? [{ url: 'https://x/a.jpg', mensagem: '' }] : [], imagemIndice: 0,
  diasSemana: [0, 1, 2, 3, 4, 5, 6], hora: '17:00', janelaFim: '19:00', proximoDisparoEm: null,
  ultimaRodadaEm: null, ultimaCampanhaId: null, ultimaRodadaMotivo: null, desligadoMotivo: null, ultimaRodada: null, anuncios: [], ...extra,
})

type Resp = { ok: boolean; status: number; json: () => Promise<unknown> }

function fetchFalso(cards = [
  card('recuperacao', { ativa: true, mensagens: ['Copy A {nome}', 'Copy *B*'], mensagemIndice: 1, ultimaRodadaEm: '2026-11-03T20:00:00Z', ultimaRodadaMotivo: 'ok', ultimaRodada: { destinatarios: 40, enviados: 12, erros: 0, status: 'enviando' } }),
  card('nunca_compraram', { anuncios: [anuncio({ id: 'p1', nome: 'Volta já', cor: '#be185d', publicos: ['sem_compra_30d', 'recorrentes', 'gastou_100'] })] }),
  card('promocoes', { ativa: true, anuncios: [anuncio()] }),
]) {
  const chamadas: { url: string; init?: RequestInit }[] = []
  const f = vi.fn(async (url: string, init?: RequestInit): Promise<Resp> => {
    chamadas.push({ url, init })
    const json = (v: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, json: async () => v })
    if (url.endsWith('/estimativa')) return json({ pessoas: 7 })
    if (url.endsWith('/resumo')) return json({ hoje_enviadas: 4, hoje_enfileiradas: 6, hoje_na_fila: 2, limite_hoje: 15, proximo_limite: 20, dias_para_subir: 3, h16_enviadas: 9, h16_perdidas: 1, h16_pedidos: 2, h16_receita: 87.5 })
    if (url.endsWith('/publicos') && !init?.method) return json({ sem_compra_30d: 31, recorrentes: 12, gastou_100: 8, compraram_7d: 5 })
    if (url.endsWith('/publicos') && init?.method === 'POST') return json({ pessoas: 40 })
    if (url.endsWith('/anuncios') && init?.method === 'PUT') {
      const tipo = url.split('/').slice(-2)[0]
      const body = JSON.parse(String(init.body))
      return json({ ...cards.find((c) => c.tipo === tipo)!, anuncios: body.anuncios.map((a: Record<string, unknown>, i: number) => ({ ...anuncio(), ...a, id: a.id ?? `novo${i}` })) })
    }
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

  it('mostra os 3 cards, a estimativa e a última rodada da Recuperação', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    expect(await screen.findByTestId('card-recuperacao')).toBeInTheDocument()
    expect(screen.getByTestId('card-nunca_compraram')).toHaveTextContent('Disparo personalizado')
    expect(screen.getByTestId('card-promocoes')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/7 pessoas/).length).toBe(3))
    expect(screen.getByTestId('rodada-recuperacao').textContent).toMatch(/12 de 40/)
  })

  it('Recuperação: grade 3 × 2 (6 espaços) e a copy da vez com a marcação visual', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    const grade = await screen.findByTestId('grade-recuperacao')
    expect(grade.children.length).toBe(6)
    const resumo = screen.getByTestId('resumo-recuperacao')
    expect(resumo).toHaveTextContent('Copy da vez · 2 de 2')
    expect(resumo.querySelector('b')?.textContent).toBe('B')
  })

  it('dias: ligado com fundo azul-escuro; desligado sem fundo e com X vermelho', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    const item = await screen.findByTestId('item-promocoes-0')
    const ter = item.querySelector('[data-dia="2"]')!
    const seg = item.querySelector('[data-dia="1"]')!
    expect(ter.getAttribute('data-on')).toBe('1')
    expect(ter.className).toContain('bg-[#112f6b]')
    expect(seg.getAttribute('data-on')).toBe('0')
    expect(seg.className).toContain('bg-transparent')
    expect(seg.querySelector('svg')?.getAttribute('class')).toContain('text-[#ea1d2c]')
  })

  it('Promoções e Personalizado listam os anúncios com foto, horário e públicos', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    const promo = await screen.findByTestId('item-promocoes-0')
    expect(promo).toHaveTextContent('Combo terça')
    expect(promo.querySelector('img')?.getAttribute('src')).toBe('https://x/p.jpg')
    expect(promo).toHaveTextContent('17:00–19:00')
    const pers = screen.getByTestId('item-nunca_compraram-0')
    expect(pers).toHaveTextContent('Sem comprar há mais de 30 dias')
    expect(pers).toHaveTextContent('+1')
  })

  it('o toggle liga o card com PATCH {"ativa":true}', async () => {
    const { chamadas } = fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    const toggle = await screen.findByTestId('toggle-nunca_compraram')
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    await waitFor(() => expect(chamadas.some((c) => c.url === '/api/admin/campanhas/recorrentes/nunca_compraram' && c.init?.method === 'PATCH' && c.init.body === '{"ativa":true}')).toBe(true))
  })

  it('card sem anúncio: toggle travado com "Crie pelo menos 1 promoção"; Recuperação sem imagem também trava', async () => {
    fetchFalso([card('recuperacao', { imagens: [] }), card('nunca_compraram'), card('promocoes')])
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    expect(await screen.findByTestId('toggle-promocoes')).toBeDisabled()
    expect(screen.getByTestId('pendencias-promocoes')).toHaveTextContent('Crie pelo menos 1 promoção')
    expect(screen.getByTestId('toggle-recuperacao')).toBeDisabled()
    expect(screen.getByTestId('pendencias-recuperacao')).toHaveTextContent('pelo menos 1 imagem')
    expect(screen.getByTestId('resumo-promocoes')).toHaveTextContent('Nenhuma promoção ainda')
  })

  it('Recuperação: modal mostra a copy da vez e todas; nova copy e salvar mandam mensagens no PATCH', async () => {
    const { chamadas } = fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('configurar-recuperacao'))
    const modal = await screen.findByTestId('modal-config')
    expect(within(modal).getByTestId('copy-da-vez')).toHaveTextContent('Copy B')
    expect(within(modal).getByTestId('copy-0')).toBeInTheDocument()
    expect(within(modal).getByTestId('copy-1')).toHaveTextContent('da vez')
    expect(within(modal).getByTestId('fotos-recuperacao').children.length).toBe(7) // 6 espaços + input
    fireEvent.click(within(modal).getByTestId('nova-copy'))
    const ed = await within(modal).findByTestId('copy-editor-2')
    ed.innerHTML = 'Volta, <b>{nome}</b>!'
    fireEvent.input(ed)
    fireEvent.click(within(modal).getByTestId('salvar-config'))
    await waitFor(() => {
      const p = chamadas.find((c) => c.url.endsWith('/recuperacao') && c.init?.method === 'PATCH')
      expect(p).toBeTruthy()
      const body = JSON.parse(String(p!.init!.body))
      expect(body.mensagens).toEqual(['Copy A {nome}', 'Copy *B*', 'Volta, *{nome}*!'])
      expect(body.mensagem).toBe('Copy A {nome}')
      expect(body.imagens).toEqual([{ url: 'https://x/a.jpg', mensagem: '' }])
    })
  })

  it('Promoções: nova promoção, nome, dia e salvar mandam a lista inteira no PUT', async () => {
    const { chamadas } = fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('configurar-promocoes'))
    const modal = await screen.findByTestId('modal-config')
    fireEvent.click(within(modal).getByTestId('novo-anuncio'))
    fireEvent.change(within(modal).getByTestId('anuncio-nome'), { target: { value: 'Pizza sexta' } })
    fireEvent.click(within(within(modal).getByTestId('anuncio-dias')).getByRole('button', { name: /sexta/ }))
    expect(within(modal).getByTestId('aviso-incompletos')).toHaveTextContent('Pizza sexta: falta imagem')
    fireEvent.click(within(modal).getByTestId('salvar-config'))
    await waitFor(() => {
      const p = chamadas.find((c) => c.url.endsWith('/promocoes/anuncios') && c.init?.method === 'PUT')
      expect(p).toBeTruthy()
      const body = JSON.parse(String(p!.init!.body))
      expect(body.anuncios).toHaveLength(2)
      expect(body.anuncios[0]).toMatchObject({ id: 'a1', nome: 'Combo terça' })
      expect(body.anuncios[1]).toMatchObject({ nome: 'Pizza sexta', diasSemana: [5], imagens: [] })
      expect(body.anuncios[1].id).toBeUndefined()
    })
  })

  it('Personalizado: públicos com tamanho; escolher vira etiqueta e o total da união vem do servidor', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('configurar-nunca_compraram'))
    const modal = await screen.findByTestId('modal-config')
    const opcao = await within(modal).findByRole('button', { name: /Compraram nos últimos 7 dias/ })
    await waitFor(() => expect(opcao).toHaveTextContent('~5'))
    fireEvent.click(opcao)
    expect(opcao).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(within(modal).getByTestId('publicos-uniao')).toHaveTextContent('40 pessoas'), { timeout: 2000 })
    expect(within(modal).getByLabelText('Públicos escolhidos')).toHaveTextContent('Compraram nos últimos 7 dias')
  })

  it('fechar com mudança não salva pergunta antes', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('configurar-promocoes'))
    const modal = await screen.findByTestId('modal-config')
    fireEvent.change(within(modal).getByTestId('anuncio-nome'), { target: { value: 'Outro nome' } })
    fireEvent.click(within(modal).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByTestId('confirmar')).toHaveTextContent('Descartar mudanças?')
    fireEvent.click(screen.getByTestId('confirmar-ok'))
    await waitFor(() => expect(screen.queryByTestId('modal-config')).toBeNull())
  })

  it('topo: lâmpada abre e fecha a explicação; contadores de hoje e das últimas 16 h', async () => {
    fetchFalso()
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    await screen.findByTestId('card-promocoes')
    fireEvent.click(screen.getByTestId('lampada'))
    expect(screen.getByTestId('recorrentes-explicacao').textContent).toMatch(/começa em 15 mensagens/)
    fireEvent.click(screen.getByTestId('lampada'))
    expect(screen.queryByTestId('recorrentes-explicacao')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('contador-hoje').textContent).toMatch(/Disparos hoje: 4 de 15/))
    expect(screen.getByTestId('contador-16h').textContent).toMatch(/enviadas 9/)
  })

  it('a API recusa (400) e o toast mostra a mensagem', async () => {
    fetchFalso()
    const onToast = vi.fn()
    render(<Recorrentes restauranteId="L1" onToast={onToast} />)
    await screen.findByTestId('card-nunca_compraram')
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: 'há anúncio incompleto' }) })) as unknown as typeof fetch
    fireEvent.click(screen.getByTestId('toggle-nunca_compraram'))
    await waitFor(() => expect(onToast).toHaveBeenCalledWith('erro', 'há anúncio incompleto'))
  })

  it('erro ao carregar vira aviso com "Tentar de novo"', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Caiu' }) })) as unknown as typeof fetch
    render(<Recorrentes restauranteId="L1" onToast={vi.fn()} />)
    expect(await screen.findByTestId('recorrentes-erro')).toHaveTextContent('Caiu')
  })
})
