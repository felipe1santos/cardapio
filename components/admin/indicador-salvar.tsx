'use client'

import { useEffect, useRef, useState } from 'react'
import { ehGravacaoDoUsuario, type FaseIndicador } from '@/lib/indicador-salvar'

/**
 * Indicador global de gravação do painel: um cartão no centro da tela com
 * "Salvando…" enquanto a gravação corre e um check "Salvo" quando termina (ou
 * um aviso se deu erro).
 *
 * Funciona para TUDO sem mexer em cada tela: observa o `fetch` da página e
 * reage às escritas que o próprio usuário disparou (ver lib/indicador-salvar.ts).
 * Não bloqueia nada — `pointer-events: none` — para não travar o operador do
 * Kanban ou do PDV no meio do movimento.
 */
const MS_SALVO = 900
const MS_ERRO = 1800

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
      ouvintes.forEach((f) => f(resposta.ok ? 'ok' : 'erro'))
      return resposta
    } catch (err) {
      ouvintes.forEach((f) => f('erro'))
      throw err
    }
  }
}

export function IndicadorSalvar() {
  const [fase, setFase] = useState<FaseIndicador>('oculto')
  const pendentes = useRef(0)
  const houveErro = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    instalar()
    const ouvinte = (evento: 'inicio' | 'ok' | 'erro') => {
      if (timer.current) clearTimeout(timer.current)
      if (evento === 'inicio') {
        if (pendentes.current === 0) houveErro.current = false
        pendentes.current++
        setFase('salvando')
        return
      }
      if (evento === 'erro') houveErro.current = true
      pendentes.current = Math.max(0, pendentes.current - 1)
      if (pendentes.current > 0) return
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
    }
  }, [])

  if (fase === 'oculto') return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center" aria-live="polite">
      <div
        role="status"
        className="animate-indicador-entrada flex min-w-[148px] flex-col items-center gap-2.5 rounded-[10px] border border-[var(--adm-borda)] bg-white/95 px-6 py-5 shadow-[0_12px_32px_rgba(17,24,39,0.18)] backdrop-blur-sm"
      >
        {fase === 'salvando' && (
          <>
            <span className="h-9 w-9 animate-spin rounded-full border-[3px] border-[var(--adm-azul-claro)] border-t-[var(--adm-azul)]" aria-hidden="true" />
            <span className="text-[13px] font-semibold text-[var(--adm-texto-medio)]">Salvando…</span>
          </>
        )}
        {fase === 'salvo' && (
          <>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#10B981] text-white" aria-hidden="true">
              <svg viewBox="0 0 24 24" className="animate-indicador-check h-5 w-5 fill-none stroke-current" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <span className="text-[13px] font-semibold text-[#15803D]">Salvo</span>
          </>
        )}
        {fase === 'erro' && (
          <>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#EF4444] text-[18px] font-bold text-white" aria-hidden="true">
              !
            </span>
            <span className="text-[13px] font-semibold text-[#B91C1C]">Não foi possível salvar</span>
          </>
        )}
      </div>
    </div>
  )
}
