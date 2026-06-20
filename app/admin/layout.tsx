'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { contarBadgesNav, type BadgesNav } from '@/lib/queries/pedidos'
import { buscarConfigLoja } from '@/lib/queries/ajustes'

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/pedidos', label: 'Painel de Pedidos' },
  { href: '/admin/logistica', label: 'Logística' },
  { href: '/admin/cardapio', label: 'Cardápio' },
  { href: '/admin/clientes', label: 'Clientes' },
  { href: '/admin/campanhas', label: 'Campanhas', novidade: true },
  { href: '/admin/ajustes', label: 'Ajustes' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [badges, setBadges] = useState<BadgesNav>({ novosPedidos: 0, logisticaPendente: 0 })
  const [storeSlug, setStoreSlug] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    ;(async () => {
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (!active || !id) return

      buscarConfigLoja(supabase, id).then((c) => { if (active && c) setStoreSlug(c.slug) })

      const carregar = async () => {
        try {
          const b = await contarBadgesNav(supabase, id)
          if (active) setBadges(b)
        } catch {
          /* silencioso: badge é informativo */
        }
      }
      await carregar()

      const channel = supabase
        .channel(`nav-badges-${id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${id}` }, carregar)
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    })()
    return () => {
      active = false
    }
  }, [supabase])

  const items = NAV_ITEMS.map((item) => {
    if (item.href === '/admin/pedidos') return { ...item, badge: badges.novosPedidos }
    if (item.href === '/admin/logistica') return { ...item, badge: badges.logisticaPendente }
    return item
  })

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar items={items} activeHref={pathname} storeSlug={storeSlug} onSignOut={handleSignOut} />
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
