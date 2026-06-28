'use client'

import { useEffect, useState } from 'react'

/** Evento beforeinstallprompt — não tipado por padrão no lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * Botão para o usuário forçar a instalação do painel como app (PWA) na área de
 * trabalho / tela inicial. Captura o evento `beforeinstallprompt` do Chrome/Edge.
 * Quando o navegador não oferece o prompt automático (iOS/Safari, ou já dispensado),
 * mostra instruções manuais.
 */
export function InstalarAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [instalado, setInstalado] = useState(false)
  const [mostrarAjuda, setMostrarAjuda] = useState(false)

  useEffect(() => {
    // Já está rodando instalado (modo standalone)?
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    if (standalone) setInstalado(true)

    const onPrompt = (e: Event) => {
      e.preventDefault() // segura o mini-infobar pra disparar no clique do botão
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalado(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function instalar() {
    if (!deferred) {
      setMostrarAjuda(true)
      return
    }
    await deferred.prompt()
    const escolha = await deferred.userChoice
    if (escolha.outcome === 'accepted') setInstalado(true)
    setDeferred(null)
  }

  if (instalado) {
    return (
      <p className="inline-flex items-center gap-1.5 rounded-menuzia bg-price-bg px-2.5 py-1.5 text-[12px] font-semibold text-price-text">
        ✓ App já instalado neste dispositivo.
      </p>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={instalar}
        className="inline-flex items-center gap-1.5 rounded-menuzia bg-primary px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark"
      >
        ⬇ Adicionar à área de trabalho
      </button>
      {mostrarAjuda && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-subtle">
          Seu navegador não ofereceu a instalação automática. Instale manualmente:
          <br />
          <strong>Computador (Chrome/Edge):</strong> clique no ícone de instalar
          (<span className="font-mono">⊕</span> / monitor) na barra de endereço, ou no menu
          <span className="font-mono"> ⋮ </span>→ &ldquo;Instalar Menuzia&rdquo;.
          <br />
          <strong>Celular:</strong> menu do navegador → &ldquo;Adicionar à tela inicial&rdquo;.
        </p>
      )}
    </div>
  )
}
