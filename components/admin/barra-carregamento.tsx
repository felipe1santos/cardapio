'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Barra azul no topo do painel enquanto uma tela carrega (no lugar do "Carregando cardápio…" no meio
 * da tela). Começa no clique de um link interno ou quando a tela monta um <CarregandoPagina />, e
 * termina quando a rota trocou e nenhuma tela segura mais o carregamento.
 *
 * O ritmo vem do tempo real: cada rota guarda (sessionStorage) quanto levou da última vez, e a barra
 * anda nessa velocidade — tela rápida enche rápido, tela pesada enche devagar. Sem histórico, 900 ms.
 * Só animação local (requestAnimationFrame enquanto visível); nenhuma chamada de rede.
 */
const TEMPO_PADRAO = 900
const LIMITE_MS = 15000
const CHAVE = (rota: string) => `menuzia:tempo-carga:${rota}`

let seguros = 0
const ouvintes = new Set<() => void>()
/** Ponte entre os dois efeitos da barra (a montagem e a troca de rota). */
let controle: { talvezConcluir: () => void; marcarRota: () => void } | null = null
function avisar() {
  ouvintes.forEach((f) => f())
}

/** Marcador de "esta tela ainda está carregando os dados": segura a barra do topo até desmontar. */
export function CarregandoPagina({ className = '' }: { className?: string }) {
  useEffect(() => {
    seguros++
    avisar()
    return () => {
      seguros = Math.max(0, seguros - 1)
      avisar()
    }
  }, [])
  return (
    <div className={`flex-1 ${className}`} role="status" aria-busy="true" data-testid="carregando-pagina">
      <span className="sr-only">Carregando…</span>
    </div>
  )
}

function tempoEsperado(rota: string): number {
  try {
    const v = Number(sessionStorage.getItem(CHAVE(rota)))
    return v > 0 ? Math.min(Math.max(v, 250), 8000) : TEMPO_PADRAO
  } catch {
    return TEMPO_PADRAO
  }
}

function guardarTempo(rota: string, ms: number) {
  try {
    sessionStorage.setItem(CHAVE(rota), String(Math.round(ms)))
  } catch {
    /* sem storage: fica no tempo padrão */
  }
}

export function BarraCarregamento() {
  const pathname = usePathname()
  const [progresso, setProgresso] = useState<number | null>(null)
  const [saindo, setSaindo] = useState(false)
  const inicio = useRef(0)
  const esperado = useRef(TEMPO_PADRAO)
  const destino = useRef<string | null>(null)
  const ativo = useRef(false)
  const quadro = useRef<number | null>(null)
  const rotaAtual = useRef(pathname)
  const rotaMudou = useRef(false)

  useEffect(() => {
    const parar = () => {
      if (quadro.current !== null) cancelAnimationFrame(quadro.current)
      quadro.current = null
    }

    const animar = () => {
      const t = performance.now() - inicio.current
      // Curva que chega a ~63% no tempo esperado e nunca passa de 92% sozinha.
      const p = 92 * (1 - Math.exp(-t / esperado.current))
      setProgresso(Math.max(8, p))
      if (t > LIMITE_MS) { concluir(); return }
      quadro.current = requestAnimationFrame(animar)
    }

    const iniciar = (rota: string) => {
      if (ativo.current) return
      ativo.current = true
      rotaMudou.current = false
      destino.current = rota
      inicio.current = performance.now()
      esperado.current = tempoEsperado(rota) / 1.6
      setSaindo(false)
      setProgresso(8)
      parar()
      quadro.current = requestAnimationFrame(animar)
    }

    const concluir = () => {
      if (!ativo.current) return
      ativo.current = false
      parar()
      if (destino.current) guardarTempo(destino.current, performance.now() - inicio.current)
      setProgresso(100)
      setSaindo(true)
      window.setTimeout(() => {
        if (ativo.current) return
        setProgresso(null)
        setSaindo(false)
      }, 320)
    }

    const talvezConcluir = () => {
      if (ativo.current && seguros === 0 && rotaMudou.current) concluir()
    }

    const aoMudarSeguros = () => {
      if (seguros > 0) {
        if (!ativo.current) {
          iniciar(rotaAtual.current)
          rotaMudou.current = true // a tela já é a de destino: só espera os dados
        }
        return
      }
      talvezConcluir()
    }

    const aoClicar = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return
      iniciar(url.pathname)
    }

    window.addEventListener('click', aoClicar, true)
    ouvintes.add(aoMudarSeguros)
    controle = { talvezConcluir, marcarRota: () => { rotaMudou.current = true } }
    // A tela pode ter montado o <CarregandoPagina /> antes deste efeito (filhos rodam primeiro).
    aoMudarSeguros()
    return () => {
      window.removeEventListener('click', aoClicar, true)
      ouvintes.delete(aoMudarSeguros)
      controle = null
      parar()
    }
  }, [])

  // Rota nova montada: deixa os efeitos da tela rodarem (ela pode segurar a barra) e fecha se ninguém segurou.
  useEffect(() => {
    if (rotaAtual.current === pathname) return
    rotaAtual.current = pathname
    controle?.marcarRota()
    const id = window.setTimeout(() => controle?.talvezConcluir(), 0)
    return () => window.clearTimeout(id)
  }, [pathname])

  if (progresso === null) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 h-[3px]"
      style={{ zIndex: 2147483000, opacity: saindo ? 0 : 1, transition: 'opacity 260ms ease 60ms' }}
      role="progressbar"
      aria-label="Carregando a tela"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progresso)}
      data-testid="barra-carregamento"
    >
      <div
        className="h-full bg-[#0688D4] shadow-[0_0_8px_rgba(6,136,212,0.55)]"
        style={{ width: `${progresso}%`, transition: saindo ? 'width 200ms ease-out' : 'width 120ms linear' }}
      />
    </div>
  )
}
