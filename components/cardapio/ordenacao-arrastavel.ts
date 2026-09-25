'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { moverNaLista } from '@/lib/ordem-cardapio'

/**
 * Arrastar para ordenar — mouse, toque e teclado, sem biblioteca.
 *
 * Só a ALÇA inicia o arraste (o resto da linha continua clicável: editar, pausar, abrir
 * a categoria). Com o dedo, a alça tem `touch-action: none`, então arrastar por ela não
 * rola a página; rolar pelo resto da linha continua normal.
 *
 * Durante o arraste a lista se reordena ao vivo (o item "abre espaço" onde vai cair) e a
 * linha arrastada acompanha o ponteiro. Ao soltar, `onSoltar` recebe a ordem nova — só se
 * ela mudou. Esc cancela e devolve tudo ao lugar.
 *
 * Teclado: na alça, ↑/↓ (e ←/→ na grade) movem uma posição e gravam; Home/End levam ao
 * início/fim. Mesma gravação do arraste.
 *
 * Serve para lista (uma coluna) e grade: o destino é o item cujo retângulo está sob o
 * ponteiro.
 */
export function useOrdenacaoArrastavel({
  ids,
  onSoltar,
  desabilitado = false,
  rotulo,
}: {
  ids: string[]
  onSoltar: (nova: string[], movido: string) => void
  desabilitado?: boolean
  /** Nome legível do item, para o leitor de tela ("Mover Coca Lata"). */
  rotulo: (id: string) => string
}) {
  const [arrasto, setArrastoEstado] = useState<{ id: string; ordem: string[] } | null>(null)
  // Espelho síncrono do estado: os ouvintes da janela leem daqui, sem efeito colateral
  // dentro de updater (o StrictMode chama updater duas vezes).
  const atualRef = useRef<{ id: string; ordem: string[] } | null>(null)
  const setArrasto = useCallback((a: { id: string; ordem: string[] } | null) => {
    atualRef.current = a
    setArrastoEstado(a)
  }, [])
  // Um id pode ter mais de um elemento montado (o Gestor mantém a tabela e a grade no DOM
  // e esconde uma por CSS): vale sempre o que está visível.
  const elementos = useRef(new Map<string, Set<HTMLElement>>())
  const visivel = useCallback((id: string): HTMLElement | null => {
    for (const el of elementos.current.get(id) ?? []) if (el.getClientRects().length > 0) return el
    return null
  }, [])
  const ponteiro = useRef({ x: 0, y: 0, pegaX: 0, pegaY: 0, pointerId: -1 })
  const inicial = useRef<string[]>([])
  // Onde a linha arrastada está no layout (sem o deslocamento do arraste). Enquanto o
  // ponteiro estiver dentro desse espaço, nada troca — sem isso a linha oscilava entre
  // duas posições a cada movimento.
  const vaga = useRef<DOMRect | null>(null)
  const [aviso, setAviso] = useState('')

  const ordem = arrasto?.ordem ?? ids

  const refDoItem = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      // Callback novo a cada render: o React chama com null e depois com o elemento.
      // Guardar por id num conjunto e limpar os desconectados cobre os dois.
      const conjunto = elementos.current.get(id) ?? new Set<HTMLElement>()
      for (const e of conjunto) if (!e.isConnected) conjunto.delete(e)
      if (el) conjunto.add(el)
      elementos.current.set(id, conjunto)
    },
    [],
  )

  /** Posiciona a linha arrastada sob o ponteiro, descontando onde ela está no layout. */
  const acompanhar = useCallback(() => {
    if (!arrasto) return
    const el = visivel(arrasto.id)
    if (!el) return
    el.style.transform = ''
    const r = el.getBoundingClientRect()
    vaga.current = r
    const p = ponteiro.current
    el.style.transform = `translate(${p.x - p.pegaX - r.left}px, ${p.y - p.pegaY - r.top}px)`
  }, [arrasto, visivel])

  useLayoutEffect(() => {
    acompanhar()
  }, [acompanhar, arrasto?.ordem])

  const destinoSob = useCallback((x: number, y: number, arrastado: string, atual: string[]): number => {
    const v = vaga.current
    if (v && x >= v.left && x <= v.right && y >= v.top && y <= v.bottom) return -1
    // Só troca quando o ponteiro entra noutro item. Nos vãos (entre cartões da grade, acima
    // ou abaixo da lista) nada muda: escolher "o mais próximo" ali fazia a linha oscilar.
    for (let i = 0; i < atual.length; i++) {
      if (atual[i] === arrastado) continue
      const r = visivel(atual[i])?.getBoundingClientRect()
      if (r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return i
    }
    return -1
  }, [visivel])

  const terminar = useCallback(
    (confirmar: boolean) => {
      const a = atualRef.current
      if (!a) return
      for (const el of elementos.current.get(a.id) ?? []) el.style.transform = ''
      setArrasto(null)
      const mudou = a.ordem.some((id, i) => id !== inicial.current[i])
      if (confirmar && mudou) {
        setAviso(`${rotulo(a.id)} solto na posição ${a.ordem.indexOf(a.id) + 1} de ${a.ordem.length}.`)
        onSoltar(a.ordem, a.id)
      } else {
        setAviso(confirmar ? '' : 'Arraste cancelado.')
      }
    },
    [onSoltar, rotulo, setArrasto],
  )

  useEffect(() => {
    if (!arrasto) return
    const mover = (e: globalThis.PointerEvent) => {
      if (e.pointerId !== ponteiro.current.pointerId) return
      e.preventDefault()
      ponteiro.current.x = e.clientX
      ponteiro.current.y = e.clientY
      const a = atualRef.current
      if (!a) return
      const alvo = destinoSob(e.clientX, e.clientY, a.id, a.ordem)
      if (alvo >= 0 && a.ordem[alvo] !== a.id) setArrasto({ ...a, ordem: moverNaLista(a.ordem, a.id, alvo) })
      acompanhar()
    }
    const soltar = (e: globalThis.PointerEvent) => {
      if (e.pointerId === ponteiro.current.pointerId) terminar(e.type === 'pointerup')
    }
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') terminar(false)
    }
    window.addEventListener('pointermove', mover, { passive: false })
    window.addEventListener('pointerup', soltar)
    window.addEventListener('pointercancel', soltar)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener('pointermove', mover)
      window.removeEventListener('pointerup', soltar)
      window.removeEventListener('pointercancel', soltar)
      window.removeEventListener('keydown', tecla)
    }
  }, [arrasto, acompanhar, destinoSob, terminar, setArrasto])

  const propsDaAlca = (id: string) => ({
    'aria-label': `Mover ${rotulo(id)}. Use as setas para mudar a posição.`,
    'aria-disabled': desabilitado || undefined,
    'aria-roledescription': 'alça de arraste',
    'data-alca-ordem': id,
    tabIndex: 0,
    role: 'button' as const,
    style: { touchAction: 'none', cursor: desabilitado ? 'not-allowed' : arrasto ? 'grabbing' : 'grab' } as CSSProperties,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (desabilitado || (e.pointerType === 'mouse' && e.button !== 0)) return
      const el = visivel(id)
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const r = el.getBoundingClientRect()
      ponteiro.current = { x: e.clientX, y: e.clientY, pegaX: e.clientX - r.left, pegaY: e.clientY - r.top, pointerId: e.pointerId }
      inicial.current = [...ids]
      setAviso(`Arrastando ${rotulo(id)}.`)
      setArrasto({ id, ordem: [...ids] })
    },
    onClick: (e: MouseEvent) => e.stopPropagation(),
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (desabilitado) return
      const atual = ids.indexOf(id)
      const destino =
        e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? atual - 1
        : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? atual + 1
        : e.key === 'Home' ? 0
        : e.key === 'End' ? ids.length - 1
        : null
      if (destino === null) return
      e.preventDefault()
      if (destino < 0 || destino >= ids.length || destino === atual) return
      const nova = moverNaLista(ids, id, destino)
      setAviso(`${rotulo(id)} na posição ${destino + 1} de ${ids.length}.`)
      onSoltar(nova, id)
      // O foco segue a alça, que muda de lugar na lista.
      requestAnimationFrame(() => {
        const alcas = [...document.querySelectorAll<HTMLElement>(`[data-alca-ordem="${id}"]`)]
        alcas.find((a) => a.getClientRects().length > 0)?.focus()
      })
    },
  })

  const estiloDoItem = (id: string): CSSProperties =>
    arrasto?.id === id
      ? { position: 'relative', zIndex: 30, boxShadow: '0 10px 24px rgba(15,23,42,.18)', opacity: 0.96, pointerEvents: 'none' }
      : arrasto
        ? { transition: 'transform .12s ease' }
        : {}

  return { ordem, arrastando: arrasto?.id ?? null, refDoItem, propsDaAlca, estiloDoItem, aviso }
}
