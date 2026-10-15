'use client'

import { useEffect, useRef, useState } from 'react'
import { ehGravacaoDoUsuario, type FaseIndicador } from '@/lib/indicador-salvar'

/**
 * Indicador global de gravação do painel: só o ícone no centro da tela — um
 * círculo azul girando se a gravação demorar e um check verde quando termina
 * (ou um aviso se deu erro).
 *
 * Funciona para TUDO sem mexer em cada tela: observa o `fetch` da página e
 * reage às escritas que o próprio usuário disparou (ver lib/indicador-salvar.ts).
 * Não bloqueia nada — `pointer-events: none` — para não travar o operador do
 * Kanban ou do PDV no meio do movimento.
 */
const MS_SALVO = 900
const MS_ERRO = 1800
/** Gravação que passa disso mostra o círculo azul girando; a rápida vai direto para o check. */
const MS_ATE_GIRAR = 350

let instalado = false
let ultimoGesto = 0
const ouvintes = new Set<(evento: 'inicio' | 'ok' | 'erro') => void>()

function instalar() {
  if (instalado || typeof window === 'undefined') return
  instalado = true
  const marcar = () => {
    ultimoGesto = Date.now()
  }
  window.addEventListener('pointerdown', marcar, true)
  window.addEventListener('submit', marcar, true)
  window.addEventListener(
    'keydown',
    (e) => {
      // Espaço só vale num botão: digitado num campo de texto não é "salvar".
      const botao = (e.target as Element | null)?.closest?.('button, [role="button"], [role="switch"]')
      if (e.key === 'Enter' || (e.key === ' ' && botao)) marcar()
    },
    true,
  )

  const original = window.fetch.bind(window)
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : 'GET')) || 'GET'
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url
    const conta = ehGravacaoDoUsuario(metodo, url, Date.now() - ultimoGesto)
    if (!conta) return original(entrada, init)
    ouvintes.forEach((f) => f('inicio'))
    try {
      const resposta = await original(entrada, init)
      // Pedido de aprovação (PIN) não é erro: a janela de aprovação assume (aprovacao-global.tsx).
      ouvintes.forEach((f) => f(resposta.ok || resposta.headers.has('x-menuzia-aprovacao') ? 'ok' : 'erro'))
      return resposta
    } catch (err) {
      // Requisição cancelada pela própria tela (troca de página, AbortController) não é
      // gravação que falhou — só fecha a conta do "Salvando…".
      const abortada = err instanceof DOMException && err.name === 'AbortError'
      ouvintes.forEach((f) => f(abortada ? 'ok' : 'erro'))
      throw err
    }
  }
}

export function IndicadorSalvar() {
  const [fase, setFase] = useState<FaseIndicador>('oculto')
  const pendentes = useRef(0)
  const houveErro = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const timerGiro = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [girando, setGirando] = useState(false)

  useEffect(() => {
    instalar()
    const ouvinte = (evento: 'inicio' | 'ok' | 'erro') => {
      if (timer.current) clearTimeout(timer.current)
      if (evento === 'inicio') {
        if (pendentes.current === 0) {
          houveErro.current = false
          setGirando(false)
          if (timerGiro.current) clearTimeout(timerGiro.current)
          timerGiro.current = setTimeout(() => setGirando(true), MS_ATE_GIRAR)
        }
        pendentes.current++
        setFase('salvando')
        return
      }
      if (evento === 'erro') houveErro.current = true
      pendentes.current = Math.max(0, pendentes.current - 1)
      if (pendentes.current > 0) return
      if (timerGiro.current) clearTimeout(timerGiro.current)
      setGirando(false)
      // Várias gravações de um mesmo clique (item + complementos + foto) viram
      // um "Salvo" só, e um erro em qualquer uma delas vence.
      const final: FaseIndicador = houveErro.current ? 'erro' : 'salvo'
      setFase(final)
      timer.current = setTimeout(() => setFase('oculto'), final === 'erro' ? MS_ERRO : MS_SALVO)
    }
    ouvintes.add(ouvinte)
    return () => {
      ouvintes.delete(ouvinte)
      if (timer.current) clearTimeout(timer.current)
      if (timerGiro.current) clearTimeout(timerGiro.current)
    }
  }, [])

  // Gravação rápida não pisca o "girando": ele só aparece se demorar (MS_ATE_GIRAR); antes disso, nada.
  if (fase === 'oculto' || (fase === 'salvando' && !girando)) return null

  // Sem cartão nem fundo (pedido do dono, 15/10): só o ícone no centro, com uma sombra leve para
  // aparecer sobre qualquer tela. O texto fica para o leitor de tela — menos no erro, que precisa ser lido.
  return (
    <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center" aria-live="polite">
      <div role="status" className="animate-indicador-entrada flex flex-col items-center gap-2">
        {fase === 'salvando' && (
          <>
            <svg viewBox="0 0 50 50" className="h-12 w-12 animate-spin drop-shadow-[0_2px_6px_rgba(17,24,39,0.18)]" aria-hidden="true" data-testid="indicador-girando">
              <circle cx="25" cy="25" r="20" fill="none" stroke="rgba(6,136,212,0.16)" strokeWidth="4.5" />
              <path d="M25 5a20 20 0 0 1 20 20" fill="none" stroke="#0688D4" strokeWidth="4.5" strokeLinecap="round" />
            </svg>
            <span className="sr-only">Salvando…</span>
          </>
        )}
        {fase === 'salvo' && (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#10B981] text-white shadow-[0_6px_18px_rgba(16,185,129,0.4)]" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="animate-indicador-check h-6 w-6 fill-none stroke-current" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span className="sr-only">Salvo</span>
          </>
        )}
        {fase === 'erro' && (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#EF4444] text-[22px] font-semibold text-white shadow-[0_6px_18px_rgba(239,68,68,0.4)]" aria-hidden="true">
              !
            </span>
            <span className="text-[13px] font-semibold text-[#B91C1C] [text-shadow:0_0_6px_#fff,0_0_2px_#fff]">Não foi possível salvar</span>
          </>
        )}
      </div>
    </div>
  )
}
