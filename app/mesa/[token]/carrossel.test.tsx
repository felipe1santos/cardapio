import { act, render } from '@testing-library/react'
import { Carrossel } from './cardapio'

const IMGS = ['https://x/a.webp', 'https://x/b.webp', 'https://x/c.webp']
const pos = (c: HTMLElement) => Number(c.querySelector('[data-carrossel-pos]')!.getAttribute('data-carrossel-pos'))
const trilho = (c: HTMLElement) => (c.querySelector('.mesa-carrossel-trilho') as HTMLElement).style.transform

function visibilidade(v: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v })
}

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ??
    ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList)
})
beforeEach(() => {
  vi.useFakeTimers()
  visibilidade('visible')
})
afterEach(() => vi.useRealTimers())

describe('carrossel do topo da mesa', () => {
  it('passa sozinho: 1ª → 2ª → 3ª → 1ª, deslizando a faixa', () => {
    const { container } = render(<Carrossel imagens={IMGS} />)
    expect(pos(container)).toBe(0)
    act(() => vi.advanceTimersByTime(4000))
    expect(pos(container)).toBe(1)
    expect(trilho(container)).toContain('-100%')
    act(() => vi.advanceTimersByTime(4000))
    expect(pos(container)).toBe(2)
    // Vai para a cópia da primeira (sem rebobinar) e depois salta para a primeira real.
    act(() => vi.advanceTimersByTime(4000))
    expect(pos(container)).toBe(0)
    expect(trilho(container)).toContain('-300%')
    act(() => vi.advanceTimersByTime(900))
    expect(trilho(container)).toContain('-0%')
  })

  it('a faixa tem uma cópia da primeira no fim (volta contínua)', () => {
    const { container } = render(<Carrossel imagens={IMGS} />)
    expect(container.querySelectorAll('.mesa-carrossel-slide')).toHaveLength(4)
  })

  it('para com a aba escondida e volta a andar quando ela aparece', () => {
    const { container } = render(<Carrossel imagens={IMGS} />)
    visibilidade('hidden')
    act(() => vi.advanceTimersByTime(12000))
    expect(pos(container)).toBe(0)
    visibilidade('visible')
    act(() => vi.advanceTimersByTime(4000))
    expect(pos(container)).toBe(1)
  })

  it('uma imagem só: fica parada, sem pontos', () => {
    const { container } = render(<Carrossel imagens={[IMGS[0]!]} />)
    act(() => vi.advanceTimersByTime(20000))
    expect(pos(container)).toBe(0)
    expect(container.querySelector('.mesa-carrossel-pontos')).toBeNull()
  })
})
