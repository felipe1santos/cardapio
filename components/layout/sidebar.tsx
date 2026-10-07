'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { urlCardapio } from '@/lib/qr-cardapio'
import { SinoNotificacoes } from '@/components/admin/notificacoes-pedidos'
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
  /** Total de pendências de configuração — badge no ícone de alerta do card da loja. */
  pendencias?: number
  /** Quem configura a loja vê o ícone de alerta (garçom não tem acesso a Ajustes). */
  mostrarPendencias?: boolean
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
  '/admin/cozinha': ICONES.cozinha,
  '/admin/lista-pedidos': ICONES.lista,
  '/admin/financeiro': ICONES.dinheiro,
  '/admin/cardapio': ICONES.cardapio,
  '/admin/clientes': ICONES.clientes,
  '/admin/campanhas': ICONES.campanhas,
  '/admin/fidelidade': ICONES.fidelidade,
  '/admin/integracoes': ICONES.integracoes,
  '/admin/equipe': ICONES.equipe,
  '/admin/impressao': ICONES.impressora,
  '/admin/ajustes': ICONES.ajustes,
}

/** Fonte, cores e forma dos submenus (submenu-vertical.tsx) no menu principal; letra 14px e respiro
 *  de 10px (e não 14,5/12) para "Painel de Pedidos" e "Ver meu cardápio" caberem inteiros em 232px. */
const FONTE_MENU = { fontFamily: 'var(--font-submenu), var(--font-painel), system-ui, sans-serif' }
const ITEM_MENU = [
  'flex min-h-[40px] items-center gap-[10px] rounded-[8px] px-[10px] py-[8px] text-left text-[14px] leading-[20px] transition-colors',
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0688D4]',
].join(' ')
const ITEM_ATIVO = 'bg-[#EEF0F3] font-semibold text-[#1F2937]'
const ITEM_INATIVO = 'font-medium text-[#4B5563] hover:bg-[#F6F7F9] hover:text-[#1F2937]'

export function Sidebar({
  items,
  activeHref,
  storeSlug,
  loja,
  onAbrirLoja,
  notificacoes,
  onSignOut,
  pendencias = 0,
  mostrarPendencias = true,
  onAbrirPendencias,
  aberta = false,
  onFechar,
}: SidebarProps) {
  // Sino de notificações e alerta de pendências: no card da loja (ou, sem a loja
  // carregada, na faixa do topo).
  const avisos = (
    <>
      {notificacoes && <SinoNotificacoes estado={notificacoes.estado} onAtivar={notificacoes.onAtivar} />}
      {mostrarPendencias && onAbrirPendencias && (
        <button
          type="button"
          data-testid="menu-alerta"
          onClick={onAbrirPendencias}
          title={pendencias > 0 ? `${pendencias} ${pendencias === 1 ? 'pendência' : 'pendências'} de configuração` : 'Nenhuma pendência de configuração'}
          aria-label={pendencias > 0 ? `${pendencias} ${pendencias === 1 ? 'pendência' : 'pendências'} de configuração` : 'Nenhuma pendência de configuração'}
          className={[
            'relative grid h-[32px] w-[30px] flex-shrink-0 place-items-center rounded-[var(--adm-raio-sm)] transition-colors hover:bg-[var(--adm-hover)]',
            pendencias > 0 ? 'text-[var(--adm-vermelho-texto)]' : 'text-[var(--adm-texto-suave)]',
          ].join(' ')}
        >
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-current" aria-hidden="true">
            {ICONES.aviso.map((d) => (<path key={d} d={d} />))}
          </svg>
          {pendencias > 0 && (
            <span data-testid="menu-alerta-badge" className="absolute -right-0.5 top-0 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--adm-vermelho)] px-1 text-[9.5px] font-semibold leading-none text-white">
              {pendencias > 9 ? '9+' : pendencias}
            </span>
          )}
        </button>
      )}
    </>
  )
  return (
    <>
      {/* Véu da gaveta: existe só abaixo de lg, e só com ela aberta. */}
      {aberta && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onFechar} aria-hidden="true" />}
      <aside
        className={[
          'z-40 flex h-screen w-[var(--adm-lateral)] flex-shrink-0 flex-col lg:h-full border-r border-[var(--adm-borda)] bg-[var(--adm-superficie)]',
          'fixed inset-y-0 left-0 transition-transform duration-200 lg:static lg:translate-x-0',
          // `invisible` e não só `-translate-x-full`: deslocada, ela continuaria no
          // caminho do Tab e do leitor de tela. `lg:visible` devolve a coluna fixa.
          aberta ? 'visible translate-x-0' : 'invisible -translate-x-full lg:visible',
        ].join(' ')}
      >
      {/* O menu começa direto no card da loja (2026-09-30): sem a faixa da marca. Os avisos
          (sino de notificações e alerta de pendências) moram no card, antes da seta. */}
      {loja ? (
        <div data-testid="menu-card-loja" className="flex min-h-[var(--adm-topo)] flex-shrink-0 items-center gap-1 border-b border-[var(--adm-borda)] py-2 pl-4 pr-2">
          <button
            type="button"
            onClick={onAbrirLoja}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[var(--adm-raio-sm)] py-0.5 text-left transition-colors hover:bg-[var(--adm-superficie-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--adm-azul)]"
            aria-label={`Ver os dados de ${loja.nome}`}
          >
            {loja.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={loja.logoUrl}
                alt=""
                className="h-8 w-8 flex-shrink-0 rounded-[3px] border border-[var(--adm-borda)] object-cover"
              />
            ) : (
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[3px] bg-[var(--adm-azul-claro)] text-[13px] font-semibold text-[var(--adm-azul-escuro)]">
                {loja.nome.charAt(0).toUpperCase()}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-semibold text-[var(--adm-menu-texto)]">{loja.nome}</span>
              {(loja.bairro || loja.cidade) && (
                <span className="block truncate text-[12px] text-[var(--adm-menu-suave)]">
                  {[loja.bairro, loja.cidade].filter(Boolean).join(', ')}
                </span>
              )}
            </span>
          </button>
          {avisos}
          {/* Área de toque de 44×44 (pendência 7); as margens negativas mantêm o lugar de 18×32 no layout. */}
          <button type="button" onClick={onAbrirLoja} aria-label={`Abrir a ficha de ${loja.nome}`} className="-mx-[13px] -my-[6px] hidden h-[44px] w-[44px] flex-shrink-0 place-items-center lg:grid">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[var(--adm-texto-suave)]" aria-hidden="true">
              {ICONES.seta.map((d) => (<path key={d} d={d} />))}
            </svg>
          </button>
          <button className="-mr-1 grid h-[32px] w-[30px] flex-shrink-0 place-items-center text-[var(--adm-texto-suave)] lg:hidden" onClick={onFechar} aria-label="Fechar o menu">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              {ICONES.fechar.map((d) => (<path key={d} d={d} />))}
            </svg>
          </button>
        </div>
      ) : (
        <div className="flex h-[var(--adm-topo)] flex-shrink-0 items-center justify-end gap-1 border-b border-[var(--adm-borda)] px-2">
          {avisos}
          <button className="-mr-1 grid h-[32px] w-[30px] flex-shrink-0 place-items-center text-[var(--adm-texto-suave)] lg:hidden" onClick={onFechar} aria-label="Fechar o menu">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              {ICONES.fechar.map((d) => (<path key={d} d={d} />))}
            </svg>
          </button>
        </div>
      )}

      {/* Mesmo desenho dos submenus (components/admin/submenu-vertical.tsx, noite 5): fonte Nunito,
          ícone Material preenchido cinza, item ativo com fundo cinza-claro arredondado. */}
      <nav data-menu-principal="" style={FONTE_MENU} className="flex flex-1 flex-col gap-[2px] overflow-y-auto px-2 py-3">
        {items.map((item) => {
          // Prefixo, não igualdade: seções com subpáginas (ex.: /admin/integracoes/nexta)
          // precisam manter o item do menu destacado.
          const isActive = activeHref === item.href || activeHref.startsWith(`${item.href}/`)
          const iconPath = NAV_ICONS[item.href]
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={[ITEM_MENU, isActive ? ITEM_ATIVO : ITEM_INATIVO].join(' ')}
            >
              {iconPath && (
                <svg viewBox="0 0 24 24" className={['h-[20px] w-[20px] flex-shrink-0 fill-current', isActive ? 'text-[#374151]' : 'text-[#4B5563]'].join(' ')} aria-hidden="true">
                  {iconPath.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </svg>
              )}
              <span className="truncate">{item.label}</span>
              {item.novidade && (
                <span className="flex-shrink-0 rounded-[4px] bg-[#e6f6ec] px-1.5 py-[2px] text-[10.5px] font-semibold leading-[14px] text-[var(--adm-alta)]">
                  Novo
                </span>
              )}
              {item.badge !== undefined && item.badge > 0 && (
                <span className="ml-auto flex h-[20px] min-w-[20px] flex-shrink-0 items-center justify-center rounded-full bg-[var(--adm-azul)] px-1.5 text-[11px] font-semibold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {storeSlug && (
        <div style={FONTE_MENU} className="mb-1 mt-1 flex items-center gap-0.5 border-t border-[var(--adm-borda)] px-2 pt-2">
        <a
          href={`/loja/${storeSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className={['min-w-0 flex-1', ITEM_MENU, ITEM_INATIVO].join(' ')}
        >
          <svg viewBox="0 0 24 24" className="h-[20px] w-[20px] flex-shrink-0 fill-current text-[#4B5563]" aria-hidden="true">
            {ICONES.abrirFora.map((d) => (<path key={d} d={d} />))}
          </svg>
          <span className="truncate">Ver meu cardápio</span>
        </a>
        {/* O "copiar link" saiu do topo junto com a faixa da marca e mora aqui. */}
        <CopiarLinkCardapio slug={storeSlug} />
        </div>
      )}

      {onSignOut && (
        <button
          type="button"
          onClick={onSignOut}
          className="mx-3 mb-3 flex items-center justify-center gap-2 rounded-[3px] border border-[var(--adm-borda)] px-3 py-2 text-[12px] font-semibold text-[var(--adm-texto-suave)] transition-colors hover:border-[var(--adm-borda-forte)] hover:bg-[var(--adm-superficie-2)] hover:text-[var(--adm-texto)]"
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
