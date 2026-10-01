'use client'

import { useEffect, useState } from 'react'

/**
 * Convite discreto para instalar o app da loja (2026-10-01).
 *  · Android/Chrome: botão que dispara o `beforeinstallprompt` guardado.
 *  · iPhone (Safari/Chrome — o iOS não tem botão automático): dica curta
 *    "Compartilhar › Adicionar à Tela de Início".
 * No máximo 1 vez por semana por loja; nunca para quem já instalou ou dispensou; nunca nos
 * navegadores internos (WhatsApp/Instagram/Facebook não instalam). Quem chama decide onde
 * (só na Home, nunca no checkout).
 */
const SEMANA_MS = 7 * 86_400_000

interface PromptInstalar extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

type Modo = 'android' | 'ios' | null

export function plataformaConvite(ua: string, standalone: boolean): 'ios' | 'outro' | null {
  if (standalone) return null
  if (/FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/i.test(ua)) return null
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  return 'outro'
}

export function podeMostrarConvite(registro: { dispensado?: boolean; instalado?: boolean; mostradoEm?: number } | null, agora: number): boolean {
  if (!registro) return true
  if (registro.dispensado || registro.instalado) return false
  return !registro.mostradoEm || agora - registro.mostradoEm >= SEMANA_MS
}

function ler(chave: string) {
  try {
    return JSON.parse(localStorage.getItem(chave) ?? 'null') as { dispensado?: boolean; instalado?: boolean; mostradoEm?: number } | null
  } catch {
    return null
  }
}
function gravar(chave: string, v: object) {
  try { localStorage.setItem(chave, JSON.stringify(v)) } catch { /* privado/cheio: só não lembra */ }
}

export function ConviteApp({ slug, nomeLoja, visivel }: { slug: string; nomeLoja: string; visivel: boolean }) {
  const chave = `menuzia_convite_app_${slug}`
  const [modo, setModo] = useState<Modo>(null)
  const [evento, setEvento] = useState<PromptInstalar | null>(null)

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
    const plat = plataformaConvite(navigator.userAgent, standalone)
    if (standalone) gravar(chave, { ...(ler(chave) ?? {}), instalado: true })
    if (!plat || !podeMostrarConvite(ler(chave), Date.now())) return
    if (plat === 'ios') {
      setModo('ios')
      return
    }
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvento(e as PromptInstalar)
      setModo('android')
    }
    const onInstalado = () => { gravar(chave, { instalado: true }); setModo(null) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalado)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalado)
    }
  }, [chave])

  // Conta como "mostrado" só quando de fato aparece na tela.
  useEffect(() => {
    if (modo && visivel) gravar(chave, { ...(ler(chave) ?? {}), mostradoEm: Date.now() })
  }, [modo, visivel, chave])

  if (!modo || !visivel) return null
  const dispensar = () => { gravar(chave, { ...(ler(chave) ?? {}), dispensado: true }); setModo(null) }

  return (
    <div className="mx-[16px] mt-[12px] flex items-center gap-[10px] rounded-[10px] border border-[var(--v-borda)] bg-white px-[12px] py-[10px]" data-testid="convite-app" data-modo={modo}>
      <div className="min-w-0 flex-1 text-[12px] leading-[16px] text-[var(--v-texto)]">
        {modo === 'android' ? (
          <>Peça mais rápido: <strong>instale o app da {nomeLoja}</strong>.</>
        ) : (
          <>Tenha o app da {nomeLoja}: toque em <strong>Compartilhar</strong> › <strong>Adicionar à Tela de Início</strong>.</>
        )}
      </div>
      {modo === 'android' && evento && (
        <button
          type="button"
          onClick={async () => {
            await evento.prompt()
            const r = await evento.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
            gravar(chave, r.outcome === 'accepted' ? { instalado: true } : { dispensado: true })
            setModo(null)
          }}
          className="flex-shrink-0 rounded-[8px] bg-[var(--tema-primaria)] px-[12px] py-[7px] text-[12px] font-semibold text-white"
        >
          Instalar
        </button>
      )}
      <button type="button" onClick={dispensar} aria-label="Dispensar" className="flex h-[28px] w-[28px] flex-shrink-0 items-center justify-center rounded-full text-[16px] text-[var(--v-secundario)] hover:bg-[#F3F4F6]">×</button>
    </div>
  )
}
