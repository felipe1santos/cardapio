import Link from 'next/link'

export interface SidebarItem {
  href: string
  label: string
  badge?: number
}

export interface SidebarProps {
  items: SidebarItem[]
  activeHref: string
  storeSlug?: string | null
}

export function Sidebar({ items, activeHref, storeSlug }: SidebarProps) {
  return (
    <aside className="flex h-screen w-[240px] flex-shrink-0 flex-col bg-sidebar-bg shadow-lg">
      <div className="flex h-[60px] items-center bg-primary px-4 text-white">
        <span className="text-lg font-bold lowercase tracking-wide">menuzia</span>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-2.5">
        {items.map((item) => {
          const isActive = item.href === activeHref
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'relative flex flex-col items-center gap-1.5 border-l-[3px] px-1.5 py-3.5 text-center text-[12px] font-medium transition-colors',
                isActive
                  ? 'border-primary bg-sidebar-hover font-semibold text-primary'
                  : 'border-transparent text-sidebar-text hover:bg-sidebar-hover hover:text-white',
              ].join(' ')}
            >
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute right-3 top-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
              {item.label}
            </Link>
          )
        })}
      </nav>
      {storeSlug && (
        <a
          href={`/loja/${storeSlug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-3 mb-4 flex items-center justify-center gap-2 rounded-menuzia border border-primary/30 bg-primary/10 px-3 py-2.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/20"
        >
          <svg viewBox="0 0 24 24" className="h-[14px] w-[14px] fill-primary">
            <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
          </svg>
          Ver cardápio
        </a>
      )}
    </aside>
  )
}
