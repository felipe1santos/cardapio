'use client'

import { useEffect, useState } from 'react'

/**
 * "Instalar app" do motoboy (PWA, 10/10). Android/Chrome: botão quando o navegador oferece a instalação
 * (beforeinstallprompt). iPhone: instrução curta (o Safari não tem botão). Já instalado: não aparece.
 * O app instalado abre em /motoboy com a mesma sessão (Android). No iPhone o app instalado tem cookies próprios:
 * pede o login uma vez e depois fica logado.
 */
type EventoInstalar = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

export function InstalarApp() {
  const [evento, setEvento] = useState<EventoInstalar | null>(null)
  const [ios, setIos] = useState(false)
  const [instalado, setInstalado] = useState(true)
  const [fechado, setFechado] = useState(false)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
    setInstalado(standalone)
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent))
    try { setFechado(localStorage.getItem('motoboy-instalar-fechado') === '1') } catch { /* sem storage */ }
    const pegar = (e: Event) => { e.preventDefault(); setEvento(e as EventoInstalar) }
    const pronto = () => { setInstalado(true); setEvento(null) }
    window.addEventListener('beforeinstallprompt', pegar)
    window.addEventListener('appinstalled', pronto)
    return () => { window.removeEventListener('beforeinstallprompt', pegar); window.removeEventListener('appinstalled', pronto) }
  }, [])

  if (instalado || fechado || (!evento && !ios)) return null
  const fechar = () => { setFechado(true); try { localStorage.setItem('motoboy-instalar-fechado', '1') } catch { /* sem storage */ } }

  return (
    <div className="mb-3 flex items-center gap-3 rounded-menuzia border border-primary/40 bg-[#E0F2FE] px-3.5 py-2.5 text-[13px] text-[#0369A1]" data-testid="motoboy-instalar">
      <div className="min-w-0 flex-1">
        {evento
          ? <>Instale o <b>Menuzia Entregador</b> no celular: abre direto nas suas entregas, já logado.</>
          : <>Para instalar no iPhone: toque em <b>Compartilhar</b> › <b>Adicionar à Tela de Início</b>.</>}
      </div>
      {evento && (
        <button type="button" className="h-[34px] flex-shrink-0 rounded-[3px] bg-primary px-3 text-[11px] font-semibold uppercase tracking-wide text-white" data-testid="motoboy-instalar-botao"
          onClick={async () => { await evento.prompt(); const r = await evento.userChoice.catch(() => null); if (r?.outcome === 'accepted') setInstalado(true); setEvento(null) }}>
          Instalar app
        </button>
      )}
      <button type="button" aria-label="Fechar" className="flex-shrink-0 px-1 text-[16px] leading-none text-[#0369A1]/70" onClick={fechar}>×</button>
    </div>
  )
}
