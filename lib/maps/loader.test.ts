import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadGoogleMaps } from './loader'

/**
 * 01/11/2026 (Fase 4): o Google cobra o Maps JS por INSTÂNCIA de mapa (`new google.maps.Map`), não por carregamento do
 * script. Cada tela com mapa chama `loadGoogleMaps` uma vez por montagem e cria um mapa — então cada chamada conta,
 * inclusive quando o script já está na página (navegar entre telas, abrir e fechar o painel de rotas).
 */
describe('contador de mapas carregados', () => {
  const fetchFalso = vi.fn<(url: string, init?: unknown) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchFalso)
    ;(window as unknown as { google?: unknown }).google = { maps: {} }
  })
  afterEach(() => { vi.unstubAllGlobals(); delete (window as unknown as { google?: unknown }).google })

  it('script já na página: cada chamada (= cada mapa novo) avisa o servidor', async () => {
    await loadGoogleMaps('chave')
    await loadGoogleMaps('chave')
    const avisos = fetchFalso.mock.calls.filter((c) => String(c[0]).includes('/api/mapa/carregou'))
    expect(avisos).toHaveLength(2)
  })
})
