'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Menu inferior da vitrine que se esconde ao rolar para BAIXO e volta ao rolar para CIMA,
 * perto do topo ou no fim da página (2026-10-01). Junto com a rolagem do próprio documento
 * (a barra do navegador recolhe sozinha), sobra só o conteúdo na tela do celular.
 *
 * Decisão pura em `decidirOculto` (testada); o hook só lê a rolagem num rAF.
 */
export const LIMIAR_PX = 8
export const TOPO_PX = 80
export const FIM_PX = 24

export function decidirOculto(
  anterior: boolean,
  y: number,
  yAntes: number,
  alturaJanela: number,
  alturaDoc: number,
): boolean {
  if (y <= TOPO_PX) return false
  if (y + alturaJanela >= alturaDoc - FIM_PX) return false
  const delta = y - yAntes
  if (Math.abs(delta) < LIMIAR_PX) return anterior
  return delta > 0
}

export function useEsconderAoRolar(ativo: boolean): boolean {
  const [oculto, setOculto] = useState(false)
  const ultimo = useRef(0)
  const ocultoRef = useRef(false)

  useEffect(() => {
    if (!ativo) {
      ocultoRef.current = false
      setOculto(false)
      return
    }
    ultimo.current = window.scrollY
    let pendente = false
    const onScroll = () => {
      if (pendente) return
      pendente = true
      requestAnimationFrame(() => {
        pendente = false
        const y = window.scrollY
        const novo = decidirOculto(ocultoRef.current, y, ultimo.current, window.innerHeight, document.documentElement.scrollHeight)
        // Só anda o ponto de referência quando o gesto passou do limiar (evita tremer).
        if (Math.abs(y - ultimo.current) >= LIMIAR_PX || y <= TOPO_PX) ultimo.current = y
        if (novo !== ocultoRef.current) {
          ocultoRef.current = novo
          setOculto(novo)
        }
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [ativo])

  return ativo && oculto
}
