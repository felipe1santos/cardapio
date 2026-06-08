'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/pedidos', label: 'Painel de Pedidos' },
  { href: '/logistica', label: 'Logística' },
  { href: '/cardapio', label: 'Cardápio' },
  { href: '/ajustes', label: 'Ajustes' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar items={NAV_ITEMS} activeHref={pathname} />
      <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
    </div>
  )
}
