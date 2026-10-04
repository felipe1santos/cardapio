'use client'

import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

/**
 * Popups, menus e tooltips do painel SEMPRE POR CIMA (regra permanente de 2026-10-03):
 * renderizados no <body> (portal), fora de qualquer container com overflow, na camada
 * máxima (z-index 9999), e posicionados para caber na tela — nunca tampados nem cortados.
 */
export const CAMADA_MAXIMA = 9999
const MARGEM = 8

function useNoNavegador() {
  const [ok, setOk] = useState(false)
  useEffect(() => setOk(true), [])
  return ok
}

/** Posição fixa abaixo (ou acima, se não couber) da âncora, presa dentro da tela. */
function posicionar(ancora: DOMRect, largura: number, altura: number, alinhar: 'inicio' | 'fim' | 'centro') {
  const vw = window.innerWidth, vh = window.innerHeight
  const w = Math.min(largura, vw - MARGEM * 2)
  let left = alinhar === 'fim' ? ancora.right - w : alinhar === 'centro' ? ancora.left + ancora.width / 2 - w / 2 : ancora.left
  left = Math.max(MARGEM, Math.min(left, vw - w - MARGEM))
  const embaixo = vh - ancora.bottom - MARGEM - 6
  const emCima = ancora.top - MARGEM - 6
  const paraCima = altura > embaixo && emCima > embaixo
  const top = paraCima ? Math.max(MARGEM, ancora.top - 6 - Math.min(altura, emCima)) : ancora.bottom + 6
  const maxAltura = paraCima ? emCima : embaixo
  return { left, top, width: w, maxHeight: Math.max(120, maxAltura) }
}

/**
 * Popup/menu ancorado num botão. Fecha com clique fora (popup e âncora contam como "dentro")
 * e com Esc.
 */
export function Flutuante({ ancora, aberto, onFechar, alinhar = 'fim', largura = 288, larguraDaAncora = false, alturaMax, children, className = '', testid, rotulo }: {
  ancora: RefObject<HTMLElement | null>
  aberto: boolean
  onFechar: () => void
  alinhar?: 'inicio' | 'fim' | 'centro'
  largura?: number
  /** Mesma largura da âncora (ex.: sugestões embaixo de um campo). */
  larguraDaAncora?: boolean
  alturaMax?: number
  children: ReactNode
  className?: string
  testid?: string
  rotulo?: string
}) {
  const pronto = useNoNavegador()
  const caixa = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null)

  const recalcular = useCallback(() => {
    const a = ancora.current
    if (!a) return
    const r = a.getBoundingClientRect()
    setPos(posicionar(r, larguraDaAncora ? r.width : largura, Math.min(caixa.current?.scrollHeight ?? 320, alturaMax ?? Infinity), alinhar))
  }, [ancora, largura, larguraDaAncora, alturaMax, alinhar])

  useLayoutEffect(() => {
    if (!aberto) { setPos(null); return }
    recalcular()
    const r = requestAnimationFrame(recalcular) // de novo com a altura real do conteúdo
    window.addEventListener('resize', recalcular)
    window.addEventListener('scroll', recalcular, true)
    return () => { cancelAnimationFrame(r); window.removeEventListener('resize', recalcular); window.removeEventListener('scroll', recalcular, true) }
  }, [aberto, recalcular])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: PointerEvent) => {
      const t = e.target as Node
      if (caixa.current?.contains(t) || ancora.current?.contains(t)) return
      onFechar()
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onFechar() }
    window.addEventListener('pointerdown', fora, true)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', fora, true); window.removeEventListener('keydown', esc) }
  }, [aberto, onFechar, ancora])

  if (!pronto || !aberto) return null
  return createPortal(
    <div
      ref={caixa}
      role="dialog"
      aria-label={rotulo}
      data-testid={testid}
      data-flutuante=""
      className={`fixed overflow-y-auto rounded-[6px] border border-border bg-white shadow-[0_12px_32px_rgba(16,24,40,0.18)] ${className}`}
      style={{ zIndex: CAMADA_MAXIMA, left: pos?.left ?? -9999, top: pos?.top ?? 0, width: pos?.width ?? largura, maxHeight: pos ? Math.min(pos.maxHeight, alturaMax ?? Infinity) : alturaMax, visibility: pos ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}

/**
 * Tooltip de verdade (não o `title` do navegador): aparece ao passar o mouse e no foco do
 * teclado, por cima de tudo. O filho recebe aria-describedby. Esc e rolagem escondem.
 *
 * `alternarNoClique`: para ícones só de explicação (ⓘ, ?) — o clique/toque abre e fecha, e o
 * toque fora fecha. Nos botões de ação o clique só esconde a dica (a ação acontece).
 */
export function Dica({ texto, children, alternarNoClique = false, tom = 'escuro', largura = 260 }: {
  texto: ReactNode
  children: ReactElement<Record<string, unknown>>
  alternarNoClique?: boolean
  tom?: 'escuro' | 'claro'
  largura?: number
}) {
  const pronto = useNoNavegador()
  const id = useId()
  const ancora = useRef<HTMLElement | null>(null)
  const [aberta, setAberta] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null)
  const balao = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!aberta || !ancora.current) { setPos(null); return }
    const larg = Math.min(largura, Math.max(120, (balao.current?.scrollWidth ?? 200) + 2))
    const p = posicionar(ancora.current.getBoundingClientRect(), larg, balao.current?.offsetHeight ?? 40, 'centro')
    setPos({ left: p.left, top: p.top, width: p.width })
  }, [aberta, texto, largura])

  useEffect(() => {
    if (!aberta) return
    const fechar = () => setAberta(false)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar() }
    const fora = (e: PointerEvent) => { if (!ancora.current?.contains(e.target as Node)) fechar() }
    window.addEventListener('keydown', esc)
    window.addEventListener('scroll', fechar, true)
    window.addEventListener('pointerdown', fora, true)
    return () => { window.removeEventListener('keydown', esc); window.removeEventListener('scroll', fechar, true); window.removeEventListener('pointerdown', fora, true) }
  }, [aberta])

  if (!isValidElement(children)) return children
  const props = children.props as Record<string, unknown>
  const encadear = (nome: string, extra: (e: unknown) => void) => (e: unknown) => { (props[nome] as ((e: unknown) => void) | undefined)?.(e); extra(e) }
  // Preserva a ref que o filho já tinha (ex.: âncora de um Flutuante).
  const refOriginal = (children as unknown as { ref?: ((el: HTMLElement | null) => void) | { current: HTMLElement | null } | null }).ref
  const ehMouse = (e: unknown) => (e as { pointerType?: string }).pointerType === 'mouse'
  const filho = cloneElement(children, {
    ref: (el: HTMLElement | null) => {
      ancora.current = el
      if (typeof refOriginal === 'function') refOriginal(el)
      else if (refOriginal) refOriginal.current = el
    },
    'aria-describedby': aberta ? id : undefined,
    // Ponteiro (e não mouseenter): o toque não simula "passar por cima".
    onPointerEnter: encadear('onPointerEnter', (e) => { if (ehMouse(e)) setAberta(true) }),
    onPointerLeave: encadear('onPointerLeave', (e) => { if (ehMouse(e)) setAberta(false) }),
    onFocus: encadear('onFocus', (e) => { if ((e as { target: Element }).target.matches?.(':focus-visible')) setAberta(true) }),
    onBlur: encadear('onBlur', () => setAberta(false)),
    onClick: encadear('onClick', (e) => {
      if (!alternarNoClique) { setAberta(false); return }
      // Mouse já abriu no hover: o clique mantém aberta. Toque/teclado: alterna.
      if (!ehMouse((e as { nativeEvent?: unknown }).nativeEvent ?? {})) setAberta((v) => !v)
    }),
  })
  const claro = tom === 'claro'
  return (
    <>
      {filho}
      {pronto && aberta && createPortal(
        <div
          ref={balao}
          id={id}
          role="tooltip"
          data-testid="dica"
          className={`pointer-events-none fixed rounded-[4px] px-2.5 py-1.5 text-[12.5px] font-medium leading-snug shadow-lg ${claro ? 'border-[0.8px] border-[rgba(0,0,0,0.12)] bg-white font-normal text-[#374151]' : 'bg-[#111827] text-white'}`}
          style={{ zIndex: CAMADA_MAXIMA, left: pos?.left ?? -9999, top: pos?.top ?? 0, maxWidth: largura, visibility: pos ? 'visible' : 'hidden' }}
        >
          {texto}
        </div>,
        document.body,
      )}
    </>
  )
}
