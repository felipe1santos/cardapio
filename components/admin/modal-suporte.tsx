'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { DUVIDA_MAX, SUPORTE_MENUZIA, linkDoSuporte } from '@/lib/suporte'

/**
 * "Como podemos ajudar?" — o botão de suporte do painel não pula direto para o
 * WhatsApp: a pessoa escreve a dúvida aqui e a mensagem sai pronta (loja, usuário,
 * perfil, tela e a dúvida), para o suporte não ter que perguntar tudo de novo.
 * Número e texto vivem em lib/suporte.ts.
 *
 * Fecha pelo X, pelo Cancelar e pelo Esc; o foco entra no campo e volta para o botão
 * que abriu. Se o navegador bloquear a nova aba, o texto fica e aparece o link direto.
 */
export function ModalSuporte({
  aberto,
  onFechar,
  loja,
  usuario,
  papel,
}: {
  aberto: boolean
  onFechar: () => void
  loja: string | null
  usuario: string | null
  papel: string | null
}) {
  const [duvida, setDuvida] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [bloqueado, setBloqueado] = useState<string | null>(null)
  const enviando = useRef(false)
  const [ocupado, setOcupado] = useState(false)
  const campo = useRef<HTMLTextAreaElement>(null)
  const caixa = useRef<HTMLDivElement>(null)
  const quemAbriu = useRef<Element | null>(null)
  const idTitulo = useId()
  const idTexto = useId()

  useEffect(() => {
    if (!aberto) return
    quemAbriu.current = document.activeElement
    setErro(null)
    setBloqueado(null)
    const t = setTimeout(() => campo.current?.focus(), 30)
    return () => {
      clearTimeout(t)
      if (quemAbriu.current instanceof HTMLElement) quemAbriu.current.focus()
    }
  }, [aberto])

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onFechar()
        return
      }
      // Foco preso no modal: Tab no último volta ao primeiro, e vice-versa.
      if (e.key === 'Tab' && caixa.current) {
        const focaveis = [...caixa.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, a[href]')]
        if (focaveis.length === 0) return
        const primeiro = focaveis[0]!
        const ultimo = focaveis[focaveis.length - 1]!
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault()
          ultimo.focus()
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault()
          primeiro.focus()
        }
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto, onFechar])

  if (!aberto) return null

  const vazio = duvida.trim() === ''

  function enviar(e: React.FormEvent) {
    e.preventDefault()
    if (enviando.current) return
    const url = linkDoSuporte({ loja, usuario, papel, caminho: window.location.pathname, duvida })
    if (!url) {
      setErro('Descreva sua dúvida antes de enviar.')
      campo.current?.focus()
      return
    }
    enviando.current = true
    setOcupado(true)
    setErro(null)
    try {
      const aba = window.open(url, '_blank')
      if (!aba) {
        // Nova aba bloqueada: o texto fica e o link direto aparece.
        setBloqueado(url)
        return
      }
      aba.opener = null
      setDuvida('')
      onFechar()
    } catch {
      setBloqueado(url)
    } finally {
      enviando.current = false
      setOcupado(false)
    }
  }

  // Portal no body: dentro da barra de topo o modal herdaria o empilhamento dela e o
  // conteúdo da tela (Kanban, mapa) cobriria a parte de baixo, com os botões.
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-[#111827]/60 p-4" data-testid="modal-suporte">
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idTexto}
        className="w-full max-w-[440px] rounded-menuzia border border-border bg-white shadow-xl"
      >
        <form onSubmit={enviar} noValidate>
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 id={idTitulo} className="text-[15px] font-bold text-text-main">Como podemos ajudar?</h2>
              <p id={idTexto} className="mt-0.5 text-[12px] leading-relaxed text-text-subtle">
                Sua mensagem vai para o suporte da Menuzia no WhatsApp {SUPORTE_MENUZIA.exibicao}, com o nome da loja e a
                tela em que você está.
              </p>
            </div>
            <button
              type="button"
              onClick={onFechar}
              aria-label="Fechar"
              className="-mr-1.5 grid h-[40px] w-[40px] flex-shrink-0 place-items-center text-lg text-text-subtle hover:text-text-main"
            >
              ×
            </button>
          </div>

          <div className="px-4 py-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-text-subtle">Sua dúvida</span>
              <textarea
                ref={campo}
                value={duvida}
                onChange={(e) => {
                  setDuvida(e.target.value)
                  if (erro) setErro(null)
                }}
                maxLength={DUVIDA_MAX}
                rows={5}
                required
                aria-required="true"
                aria-invalid={erro ? true : undefined}
                aria-label="Descreva sua dúvida"
                placeholder="Ex.: como mudo a taxa de entrega de um bairro?"
                className="w-full resize-y rounded-menuzia border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary"
                data-testid="suporte-duvida"
              />
            </label>
            {erro && (
              <p role="alert" className="mt-1.5 text-[12px] font-medium text-danger" data-testid="suporte-erro">
                {erro}
              </p>
            )}
            {bloqueado && (
              <p role="alert" className="mt-1.5 text-[12px] text-text-main" data-testid="suporte-bloqueado">
                O navegador bloqueou a nova aba. Sua mensagem foi mantida —{' '}
                <a href={bloqueado} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline">
                  abrir o WhatsApp
                </a>
                .
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <button
              type="button"
              onClick={onFechar}
              className="min-h-[40px] rounded-menuzia border border-border bg-white px-4 text-[11px] font-semibold uppercase tracking-wide text-text-main hover:bg-page lg:min-h-[36px]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={ocupado}
              className={`min-h-[40px] rounded-menuzia bg-status-ready px-4 text-[11px] font-semibold uppercase tracking-wide text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-[36px] ${vazio ? 'opacity-60' : ''}`}
              data-testid="suporte-enviar"
            >
              Enviar para o WhatsApp
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
