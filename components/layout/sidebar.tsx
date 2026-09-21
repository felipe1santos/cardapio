'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { urlCardapio } from '@/lib/qr-cardapio'

export interface SidebarItem {
  href: string
  label: string
  badge?: number
  /** Pendências de configuração desta seção (ver lib/setup-checklist.ts). */
  alerta?: number
  novidade?: boolean
}

export interface SidebarProps {
  items: SidebarItem[]
  activeHref: string
  storeSlug?: string | null
  onSignOut?: () => void
  /** Total de pendências de configuração — mostra o atalho pra reabrir o alerta. */
  pendencias?: number
  onAbrirPendencias?: () => void
  /**
   * Abaixo de `lg` a sidebar sai do fluxo e vira gaveta. O garçom trabalha com o celular
   * na mão: com 240px fixos de menu, num aparelho de 360px sobravam 120px de conteúdo.
   * A partir de `lg` nada muda — é a mesma coluna fixa de sempre.
   */
  aberta?: boolean
  onFechar?: () => void
}

const NAV_ICONS: Record<string, string> = {
  // Mesa com duas cadeiras (Material "table_restaurant", simplificado).
  '/admin/mesas': 'M21.96 9.73l-1.43-5A.996.996 0 0019.57 4H4.43c-.45 0-.84.3-.96.73l-1.43 5c-.18.63.3 1.27.96 1.27h2.2L4 20h2l.67-5h10.67l.66 5h2l-1.2-9h2.2c.66 0 1.14-.64.96-1.27zM6.93 13l.27-2h9.6l.27 2H6.93z',
  // Grupo de pessoas (Material "groups", simplificado).
  '/admin/equipe': 'M12 12.75c1.63 0 3.07.39 4.24.9 1.08.48 1.76 1.56 1.76 2.73V18H6v-1.61c0-1.18.68-2.26 1.76-2.73 1.17-.52 2.61-.91 4.24-.91zM4 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm1.13 1.1c-.37-.06-.74-.1-1.13-.1-.99 0-1.93.21-2.78.58A2.01 2.01 0 000 16.43V18h4.5v-1.61c0-.83.23-1.61.63-2.29zM20 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm4 3.43c0-.81-.48-1.53-1.22-1.85A6.95 6.95 0 0020 14c-.39 0-.76.04-1.13.1.4.68.63 1.46.63 2.29V18H24v-1.57zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z',
  '/admin/dashboard': 'M3,3v8h8V3H3z M5,5h4v4H5V5z M13,3v8h8V3H13z M15,5h4v4h-4V5z M3,13v8h8v-8H3z M5,15h4v4H5V15z M13,13v8h8v-8H13z M15,15h4v4h-4V15z',
  '/admin/pedidos': 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1zm14 14H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V6h12v2z',
  '/admin/pdv': 'M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h6v2H8v2h8v-2h-2v-2h6c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z',
  '/admin/logistica': 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  '/admin/cardapio': 'M21,5c-1.11-0.35-2.33-0.5-3.5-0.5c-1.95,0-4.05,0.4-5.5,1.5c-1.45-1.1-3.55-1.5-5.5-1.5S2.45,4.9,1,6v14.65 c0,0.25,0.25,0.5,0.5,0.5c0.1,0,0.15-0.05,0.25-0.05C3.1,20.45,5.05,20,6.5,20c1.95,0,4.05,0.4,5.5,1.5c1.35-0.85,3.8-1.5,5.5-1.5 c1.65,0,3.35,0.3,4.75,1.05c0.1,0.05,0.15,0.05,0.25,0.05c0.25,0,0.5-0.25,0.5-0.5V6C22.4,5.55,21.75,5.25,21,5z M21,18.5 c-1.1-0.35-2.3-0.5-3.5-0.5c-1.7,0-4.15,0.65-5.5,1.5V8c1.35-0.85,3.8-1.5,5.5-1.5c1.2,0,2.4,0.15,3.5,0.5V18.5z',
  '/admin/clientes': 'M16,11c1.66,0,2.99-1.34,2.99-3S17.66,5,16,5c-1.66,0-3,1.34-3,3S14.34,11,16,11z M8,11c1.66,0,2.99-1.34,2.99-3 S9.66,5,8,5C6.34,5,5,6.34,5,8S6.34,11,8,11z M8,13c-2.33,0-7,1.17-7,3.5V19h14v-2.5C15,14.17,10.33,13,8,13z M16,13 c-0.29,0-0.62,0.02-0.97,0.05C16.19,13.89,17,15.02,17,16.5V19h6v-2.5C23,14.17,18.33,13,16,13z',
  '/admin/campanhas': 'M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.61-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.62zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.54.8 1.07 1.2 1.61.96-.72 2.21-1.65 3.2-2.41zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z',
  '/admin/fidelidade': 'M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z',
  '/admin/integracoes': 'M17 7h-4v2h4c1.65 0 3 1.35 3 3s-1.35 3-3 3h-4v2h4c2.76 0 5-2.24 5-5s-2.24-5-5-5zm-6 8H7c-1.65 0-3-1.35-3-3s1.35-3 3-3h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-2zm-3-4h8v2H8v-2z',
  '/admin/ajustes': 'M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z',
}

export function Sidebar({
  items,
  activeHref,
  storeSlug,
  onSignOut,
  pendencias = 0,
  onAbrirPendencias,
  aberta = false,
  onFechar,
}: SidebarProps) {
  return (
    <>
      {/* Véu da gaveta: existe só abaixo de lg, e só com ela aberta. */}
      {aberta && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onFechar} aria-hidden="true" />}
      <aside
        className={[
          'z-40 flex h-screen w-[240px] flex-shrink-0 flex-col bg-sidebar-bg shadow-lg',
          'fixed inset-y-0 left-0 transition-transform duration-200 lg:static lg:translate-x-0',
          // `invisible` e não só `-translate-x-full`: deslocada, ela continuaria no
          // caminho do Tab e do leitor de tela. `lg:visible` devolve a coluna fixa.
          aberta ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible',
        ].join(' ')}
      >
      <div className="flex h-[60px] flex-shrink-0 items-center gap-1.5 rounded-br-[18px] bg-primary px-4 text-white">
        <span className="text-lg font-bold lowercase tracking-wide">menuzia</span>
        {storeSlug && <CopiarLinkCardapio slug={storeSlug} />}
        <button className="-mr-2 ml-auto p-2.5 lg:hidden" onClick={onFechar} aria-label="Fechar o menu">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2.5">
        {items.map((item) => {
          // Prefixo, não igualdade: seções com subpáginas (ex.: /admin/integracoes/nexta)
          // precisam manter o item do menu destacado.
          const isActive = activeHref === item.href || activeHref.startsWith(`${item.href}/`)
          const iconPath = NAV_ICONS[item.href]
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'mx-2 flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-hover font-semibold text-primary'
                  : 'text-white hover:bg-sidebar-hover hover:text-primary',
              ].join(' ')}
            >
              {iconPath && (
                <svg viewBox="0 0 24 24" className="h-5 w-5 flex-shrink-0 fill-current">
                  <path d={iconPath} />
                </svg>
              )}
              <span className="truncate">{item.label}</span>
              {/* Marcador de configuração pendente: fica colado no nome da seção
                  que resolve o problema, pra o dono saber onde clicar. */}
              {item.alerta !== undefined && item.alerta > 0 && (
                <span
                  className="animate-alerta-menu flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white"
                  title={`${item.alerta} ${item.alerta === 1 ? 'pendência de configuração' : 'pendências de configuração'}`}
                  aria-label={`${item.alerta} ${item.alerta === 1 ? 'pendência de configuração' : 'pendências de configuração'}`}
                >
                  {item.alerta}
                </span>
              )}
              {item.novidade && (
                <span className="flex-shrink-0 rounded px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-wider" style={{ backgroundColor: '#FCD34D', color: '#78350F' }}>
                  Novidade
                </span>
              )}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ml-auto flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>
      {pendencias > 0 && onAbrirPendencias && (
        <button
          type="button"
          onClick={onAbrirPendencias}
          className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-menuzia border border-danger/40 bg-danger/10 px-3 py-2.5 text-[12px] font-semibold text-danger transition-colors hover:bg-danger/20"
        >
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] flex-shrink-0 fill-current">
            <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" />
          </svg>
          {pendencias} {pendencias === 1 ? 'pendência' : 'pendências'}
        </button>
      )}
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="mx-3 mb-4 flex items-center justify-center gap-2 rounded-menuzia border border-white/10 px-3 py-2.5 text-[12px] font-semibold text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-current">
            <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
          </svg>
          Sair
        </button>
      )}
      </aside>
    </>
  )
}

/**
 * Atalho do link do cardápio, colado na marca. Copiar é o que o dono realmente faz com
 * ele — manda no WhatsApp, cola na bio, no Instagram. O botão antigo abria a vitrine numa
 * aba nova, e daí o link ainda tinha que ser copiado da barra de endereço.
 *
 * A URL é montada no clique, não na renderização: `window` não existe no servidor, e ler
 * `location.origin` durante o render quebraria a hidratação.
 */
function CopiarLinkCardapio({ slug }: { slug: string }) {
  const [copiado, setCopiado] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copiar = useCallback(async () => {
    const url = urlCardapio(window.location.origin, slug)
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard bloqueado (http sem localhost, permissão negada): o dono ainda
      // precisa do link, então abre a vitrine e ele copia da barra de endereço.
      window.open(url, '_blank', 'noopener,noreferrer')
      return
    }
    setCopiado(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopiado(false), 2000)
  }, [slug])

  // O alvo de toque vai em px: a raiz do painel é 87,5%, então `h-8` valeria 28px de
  // verdade — pequeno demais para o dedo. 40px cabe nos 60px do cabeçalho.
  return (
    <span className="relative flex items-center">
      <button
        type="button"
        onClick={() => void copiar()}
        title="Copiar o link do cardápio"
        aria-label={copiado ? 'Link do cardápio copiado' : 'Copiar o link do cardápio'}
        className="grid h-[40px] w-[40px] place-items-center rounded-menuzia text-white/80 transition-colors hover:bg-white/15 hover:text-white"
      >
        {copiado ? (
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current">
            <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z" />
          </svg>
        )}
      </button>
      {copiado && (
        <span
          role="status"
          className="pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-menuzia bg-sidebar-bg px-2 py-1 text-[11px] font-semibold text-white shadow"
        >
          Link copiado
        </span>
      )}
    </span>
  )
}
