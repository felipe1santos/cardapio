'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { urlCardapio } from '@/lib/qr-cardapio'
import { ItemNotificacoes } from '@/components/admin/notificacoes-pedidos'
import type { EstadoNotificacao } from '@/lib/notificacoes-pedido'
import { ICONES } from '@/lib/icones-painel'

export interface SidebarItem {
  href: string
  label: string
  badge?: number
  /** Pendências de configuração desta seção (ver lib/setup-checklist.ts). */
  alerta?: number
  novidade?: boolean
}

export interface LojaNoMenu {
  nome: string
  logoUrl: string | null
  bairro: string
  cidade: string
}

export interface SidebarProps {
  items: SidebarItem[]
  activeHref: string
  storeSlug?: string | null
  /** Identificação da loja no topo do menu. Null enquanto a configuração carrega. */
  loja?: LojaNoMenu | null
  /** Abre a ficha da loja (modal do painel). */
  onAbrirLoja?: () => void
  /** Aviso de pedido novo pelo navegador — estado real e o pedido de permissão. */
  notificacoes?: { estado: EstadoNotificacao; onAtivar: () => void }
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

/**
 * Ícone de cada seção, no conjunto Material (ver lib/icones-painel.ts). É o
 * mesmo desenho que a referência de painel usa — o traço cheio de 24px, não o
 * contorno fino.
 */
const NAV_ICONS: Record<string, string[]> = {
  '/admin/dashboard': ICONES.dashboard,
  '/admin/pedidos': ICONES.pedidos,
  '/admin/pdv': ICONES.pdv,
  '/admin/mesas': ICONES.mesas,
  '/admin/logistica': ICONES.logistica,
  '/admin/cardapio': ICONES.cardapio,
  '/admin/clientes': ICONES.clientes,
  '/admin/campanhas': ICONES.campanhas,
  '/admin/fidelidade': ICONES.fidelidade,
  '/admin/integracoes': ICONES.integracoes,
  '/admin/equipe': ICONES.equipe,
  '/admin/ajustes': ICONES.ajustes,
}


export function Sidebar({
  items,
  activeHref,
  storeSlug,
  loja,
  onAbrirLoja,
  notificacoes,
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
          'z-40 flex h-screen w-[var(--adm-lateral)] flex-shrink-0 flex-col border-r border-[var(--adm-borda)] bg-[var(--adm-superficie)]',
          'fixed inset-y-0 left-0 transition-transform duration-200 lg:static lg:translate-x-0',
          // `invisible` e não só `-translate-x-full`: deslocada, ela continuaria no
          // caminho do Tab e do leitor de tela. `lg:visible` devolve a coluna fixa.
          aberta ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible',
        ].join(' ')}
      >
      <div className="flex h-[var(--adm-topo)] flex-shrink-0 items-center gap-1.5 border-b border-[var(--adm-borda)] px-4">
        <span className="text-[15px] font-bold lowercase tracking-tight text-[var(--adm-azul)]">menuzia</span>
        {storeSlug && <CopiarLinkCardapio slug={storeSlug} />}
        <button className="-mr-2 ml-auto p-2.5 text-[var(--adm-texto-suave)] lg:hidden" onClick={onFechar} aria-label="Fechar o menu">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            {ICONES.fechar.map((d) => (<path key={d} d={d} />))}
          </svg>
        </button>
      </div>

      {/* Ficha da loja: quem abre o painel precisa saber QUAL loja está mexendo —
          é a primeira coisa que o dono com duas operações procura. Mostra só o
          que a configuração já carrega; clicar abre a ficha completa. */}
      {loja && (
        <button
          type="button"
          onClick={onAbrirLoja}
          className="flex flex-shrink-0 items-center gap-2.5 border-b border-[var(--adm-borda)] px-3 py-3 text-left transition-colors hover:bg-[var(--adm-superficie-2)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--adm-azul)]"
          aria-label={`Ver os dados de ${loja.nome}`}
        >
          {loja.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={loja.logoUrl}
              alt=""
              className="h-9 w-9 flex-shrink-0 rounded-[var(--adm-raio-sm)] border border-[var(--adm-borda)] object-cover"
            />
          ) : (
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[var(--adm-raio-sm)] bg-[var(--adm-azul-claro)] text-[13px] font-bold text-[var(--adm-azul-escuro)]">
              {loja.nome.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-normal text-[var(--adm-menu-texto)]">{loja.nome}</span>
            {(loja.bairro || loja.cidade) && (
              <span className="block truncate text-[12px] text-[var(--adm-menu-suave)]">
                {[loja.bairro, loja.cidade].filter(Boolean).join(', ')}
              </span>
            )}
          </span>
          <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-[var(--adm-texto-suave)]" aria-hidden="true">
            {ICONES.seta.map((d) => (<path key={d} d={d} />))}
          </svg>
        </button>
      )}

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
                'mx-2 flex min-h-[40px] items-center gap-3 rounded-[var(--adm-raio-sm)] px-[10px] text-left text-[14px] leading-none transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--adm-azul)]',
                isActive
                  ? 'bg-[var(--adm-azul-claro)] font-semibold text-[var(--adm-azul-escuro)]'
                  : 'font-normal text-[var(--adm-menu-texto)] hover:bg-[var(--adm-hover)]',
              ].join(' ')}
            >
              {iconPath && (
                <svg viewBox="0 0 24 24" className="h-6 w-6 flex-shrink-0 fill-current" aria-hidden="true">
                  {iconPath.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
              )}
              <span className="truncate">{item.label}</span>
              {/* Marcador de configuração pendente: fica colado no nome da seção
                  que resolve o problema, pra o dono saber onde clicar. */}
              {item.alerta !== undefined && item.alerta > 0 && (
                <span
                  className="animate-alerta-menu flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--adm-vermelho)] px-1 text-[10px] font-bold text-white"
                  title={`${item.alerta} ${item.alerta === 1 ? 'pendência de configuração' : 'pendências de configuração'}`}
                  aria-label={`${item.alerta} ${item.alerta === 1 ? 'pendência de configuração' : 'pendências de configuração'}`}
                >
                  {item.alerta}
                </span>
              )}
              {item.novidade && (
                <span className="flex-shrink-0 rounded px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-wider" style={{ backgroundColor: '#EDE9FE', color: '#5B21B6' }}>
                  Novidade
                </span>
              )}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ml-auto flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--adm-azul)] px-1 text-[11px] font-bold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Rodapé de apoio: o que fica fora da navegação de módulos. O aviso de
          pedido novo mora aqui porque é uma preferência do aparelho, não uma
          seção do painel. */}
      {notificacoes && (
        <div className="flex-shrink-0 border-t border-[var(--adm-borda)] pt-2">
          <ItemNotificacoes estado={notificacoes.estado} onAtivar={notificacoes.onAtivar} />
        </div>
      )}

      {storeSlug && (
        <a
          href={`/loja/${storeSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-2 mb-1 flex min-h-[40px] items-center gap-3 rounded-[var(--adm-raio-sm)] px-[10px] text-[14px] font-normal leading-none text-[var(--adm-menu-texto)] transition-colors hover:bg-[var(--adm-hover)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--adm-azul)]"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6 flex-shrink-0 fill-current" aria-hidden="true">
            {ICONES.abrirFora.map((d) => (<path key={d} d={d} />))}
          </svg>
          <span className="truncate">Ver meu cardápio</span>
        </a>
      )}

      {pendencias > 0 && onAbrirPendencias && (
        <button
          type="button"
          onClick={onAbrirPendencias}
          className="mx-3 mb-2 flex items-center justify-center gap-2 rounded-menuzia border border-danger/40 bg-danger/10 px-3 py-2.5 text-[12px] font-semibold text-[var(--adm-vermelho-texto)] transition-colors hover:bg-danger/20"
        >
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] flex-shrink-0 fill-current">
            {ICONES.aviso.map((d) => (<path key={d} d={d} />))}
          </svg>
          {pendencias} {pendencias === 1 ? 'pendência' : 'pendências'}
        </button>
      )}
      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="mx-3 mb-4 flex items-center justify-center gap-2 rounded-[var(--adm-raio-sm)] border border-[var(--adm-borda)] px-3 py-2.5 text-[12px] font-semibold text-[var(--adm-texto-suave)] transition-colors hover:border-[var(--adm-borda-forte)] hover:bg-[var(--adm-superficie-2)] hover:text-[var(--adm-texto)]"
        >
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-current">
            {ICONES.sair.map((d) => (<path key={d} d={d} />))}
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
        className="grid h-[40px] w-[40px] place-items-center rounded-[var(--adm-raio-sm)] text-[var(--adm-texto-suave)] transition-colors hover:bg-[var(--adm-azul-claro)] hover:text-[var(--adm-azul)]"
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
