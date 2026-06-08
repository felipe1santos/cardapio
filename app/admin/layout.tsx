'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Dashboard' },
  { href: '/admin/pedidos', label: 'Painel de Pedidos' },
  { href: '/admin/logistica', label: 'Logística' },
  { href: '/admin/cardapio', label: 'Cardápio' },
  { href: '/admin/ajustes', label: 'Ajustes' },
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
