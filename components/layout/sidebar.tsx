import Link from 'next/link'

export interface SidebarItem {
  href: string
  label: string
}

export interface SidebarProps {
  items: SidebarItem[]
  activeHref: string
}

export function Sidebar({ items, activeHref }: SidebarProps) {
  return (
    <aside className="flex h-screen w-[240px] flex-shrink-0 flex-col bg-sidebar-bg shadow-lg">
      <div className="flex h-[60px] items-center bg-primary px-4 text-white">
        <span className="text-lg font-bold lowercase tracking-wide">menuzia</span>
      </div>
      <nav className="flex flex-col gap-0.5 overflow-y-auto py-2.5">
        {items.map((item) => {
          const isActive = item.href === activeHref
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'flex flex-col items-center gap-1.5 border-l-[3px] px-1.5 py-3.5 text-center text-[12px] font-medium transition-colors',
                isActive
                  ? 'border-primary bg-sidebar-hover font-semibold text-primary'
                  : 'border-transparent text-sidebar-text hover:bg-sidebar-hover hover:text-white',
              ].join(' ')}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
