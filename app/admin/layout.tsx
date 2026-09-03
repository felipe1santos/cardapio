'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { contarBadgesNav, type BadgesNav } from '@/lib/queries/pedidos'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { carregarDadosSetup } from '@/lib/queries/setup'
import { assinaturaPendencias, avaliarSetup, contarPorMenu, type PendenciaSetup } from '@/lib/setup-checklist'
import { SetupAlerta } from '@/components/admin/setup-alerta'

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/pedidos', label: 'Painel de Pedidos' },
  { href: '/admin/pdv', label: 'PDV' },
  { href: '/admin/logistica', label: 'Logística' },
  { href: '/admin/cardapio', label: 'Cardápio' },
  { href: '/admin/clientes', label: 'Clientes' },
  { href: '/admin/campanhas', label: 'Campanhas', novidade: true },
  { href: '/admin/fidelidade', label: 'Fidelidade', novidade: true },
  { href: '/admin/integracoes', label: 'Integrações', novidade: true },
  { href: '/admin/ajustes', label: 'Ajustes' },
]

/** Onde fica registrado o "OK, entendi" do dono, por loja. */
function chaveDispensa(restauranteId: string) {
  return `menuzia:setup-ok:${restauranteId}`
}

/**
 * O modal só interrompe o trabalho quando há pendência CRÍTICA (o que trava o
 * pedido do cliente) e essa combinação ainda não foi dispensada. Pendência de
 * atenção vive só no marcador do menu — brigar por foto de item seria ruído.
 */
function deveAbrirAlerta(restauranteId: string, lista: PendenciaSetup[]): boolean {
  if (!lista.some((p) => p.severidade === 'critico')) return false
  try {
    return localStorage.getItem(chaveDispensa(restauranteId)) !== assinaturaPendencias(lista)
  } catch {
    return true
  }
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [badges, setBadges] = useState<BadgesNav>({ novosPedidos: 0, logisticaPendente: 0 })
  const [storeSlug, setStoreSlug] = useState<string | null>(null)
  // Loja que não trabalha com entregador fecha a entrega no próprio Kanban — o
  // módulo de Logística sai do menu. `true` até a config chegar: esconder e
  // reaparecer o item piscaria o menu a cada carregamento.
  const [usaLogistica, setUsaLogistica] = useState(true)
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  // null = nenhum sinal explícito ainda; cai no default por rota.
  const [focusEvent, setFocusEvent] = useState<boolean | null>(null)
  // Checklist de configuração (lib/setup-checklist.ts).
  const [pendencias, setPendencias] = useState<PendenciaSetup[]>([])
  const [alertaAberto, setAlertaAberto] = useState(false)

  // Modo tela cheia: páginas como Pedidos/PDV escondem a sidebar.
  // O evento pode chegar tarde no load direto (o efeito do filho dispara antes do
  // listener do pai montar), então o PDV é tela cheia por ROTA — não depende do evento.
  useEffect(() => {
    const handler = (e: Event) => setFocusEvent((e as CustomEvent<boolean>).detail)
    window.addEventListener('menuzia:focus-mode', handler as EventListener)
    return () => window.removeEventListener('menuzia:focus-mode', handler as EventListener)
  }, [])

  // Ao trocar de rota, descarta o sinal da página anterior.
  useEffect(() => { setFocusEvent(null) }, [pathname])

  const focusMode = focusEvent !== null ? focusEvent : pathname === '/admin/pdv'

  useEffect(() => {
    let active = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!active || !id) return

      buscarConfigLoja(supabase, id).then((c) => {
        if (!active || !c) return
        setStoreSlug(c.slug)
        setUsaLogistica(c.usaLogistica)
      })

      try {
        const b = await contarBadgesNav(supabase, id)
        if (active) setBadges(b)
      } catch {
        /* silencioso: badge é informativo */
      }
      if (active) setRestauranteId(id)
    })()
    return () => {
      active = false
    }
  }, [supabase])

  // Checklist de configuração: recarregado a cada troca de rota, que é quando o
  // dono acabou de mexer em Ajustes/Cardápio. Corrigiu, o marcador some sozinho.
  useEffect(() => {
    if (!restauranteId) return
    let active = true
    ;(async () => {
      try {
        const config = await buscarConfigLoja(supabase, restauranteId)
        if (!active || !config) return
        setStoreSlug(config.slug)
        setUsaLogistica(config.usaLogistica)

        const lista = avaliarSetup(await carregarDadosSetup(supabase, restauranteId, config))
        if (!active) return
        setPendencias(lista)
        setAlertaAberto(deveAbrirAlerta(restauranteId, lista))
      } catch {
        /* silencioso: o checklist é auxiliar e não pode derrubar o painel */
      }
    })()
    return () => {
      active = false
    }
  }, [supabase, restauranteId, pathname])

  // Canal Realtime num effect próprio: o cleanup retornado por uma função
  // async nunca é chamado pelo React, então o canal ficava aberto pra sempre
  // a cada remontagem do layout, vazando conexões Realtime ao longo do turno.
  useEffect(() => {
    if (!restauranteId) return
    const carregar = async () => {
      try {
        const b = await contarBadgesNav(supabase, restauranteId)
        setBadges(b)
      } catch {
        /* silencioso: badge é informativo */
      }
    }
    const channel = supabase
      .channel(`nav-badges-${restauranteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${restauranteId}` }, carregar)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, restauranteId])

  const alertasPorMenu = contarPorMenu(pendencias)

  const items = NAV_ITEMS.filter((item) => item.href !== '/admin/logistica' || usaLogistica).map((item) => {
    const alerta = alertasPorMenu[item.href]
    const base = alerta ? { ...item, alerta } : item
    if (item.href === '/admin/pedidos') return { ...base, badge: badges.novosPedidos }
    if (item.href === '/admin/logistica') return { ...base, badge: badges.logisticaPendente }
    return base
  })

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const dispensarAlerta = () => {
    setAlertaAberto(false)
    if (!restauranteId) return
    try {
      localStorage.setItem(chaveDispensa(restauranteId), assinaturaPendencias(pendencias))
    } catch {
      /* navegador sem storage: o modal volta no próximo carregamento, e tudo bem */
    }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {!focusMode && (
        <Sidebar
          items={items}
          activeHref={pathname}
          storeSlug={storeSlug}
          onSignOut={handleSignOut}
          pendencias={pendencias.length}
          onAbrirPendencias={() => setAlertaAberto(true)}
        />
      )}
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      {alertaAberto && (
        <SetupAlerta
          pendencias={pendencias}
          onDispensar={dispensarAlerta}
          onResolver={(href) => {
            dispensarAlerta()
            router.push(href)
          }}
        />
      )}
    </div>
  )
}
