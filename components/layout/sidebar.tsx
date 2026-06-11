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

const NAV_ICONS: Record<string, string> = {
  '/admin/dashboard': 'M3,3v8h8V3H3z M5,5h4v4H5V5z M13,3v8h8V3H13z M15,5h4v4h-4V5z M3,13v8h8v-8H3z M5,15h4v4H5V15z M13,13v8h8v-8H13z M15,15h4v4h-4V15z',
  '/admin/pedidos': 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1-2-1zm14 14H6v-2h12v2zm0-4H6v-2h12v2zm0-4H6V6h12v2z',
  '/admin/logistica': 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4zM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm13.5-9l1.96 2.5H17V9.5h2.5zM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z',
  '/admin/cardapio': 'M21,5c-1.11-0.35-2.33-0.5-3.5-0.5c-1.95,0-4.05,0.4-5.5,1.5c-1.45-1.1-3.55-1.5-5.5-1.5S2.45,4.9,1,6v14.65 c0,0.25,0.25,0.5,0.5,0.5c0.1,0,0.15-0.05,0.25-0.05C3.1,20.45,5.05,20,6.5,20c1.95,0,4.05,0.4,5.5,1.5c1.35-0.85,3.8-1.5,5.5-1.5 c1.65,0,3.35,0.3,4.75,1.05c0.1,0.05,0.15,0.05,0.25,0.05c0.25,0,0.5-0.25,0.5-0.5V6C22.4,5.55,21.75,5.25,21,5z M21,18.5 c-1.1-0.35-2.3-0.5-3.5-0.5c-1.7,0-4.15,0.65-5.5,1.5V8c1.35-0.85,3.8-1.5,5.5-1.5c1.2,0,2.4,0.15,3.5,0.5V18.5z',
  '/admin/ajustes': 'M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.74,8.87 C2.62,9.08,2.66,9.34,2.86,9.48l2.03,1.58C4.84,11.36,4.8,11.69,4.8,12s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.12-0.22,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z',
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
          const iconPath = NAV_ICONS[item.href]
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                'relative flex flex-col items-center gap-1.5 border-l-[3px] px-1.5 py-3.5 text-center text-[12px] font-medium transition-colors',
                isActive
                  ? 'border-primary bg-sidebar-hover font-semibold text-primary'
                  : 'border-transparent text-white hover:bg-sidebar-hover hover:text-primary',
              ].join(' ')}
            >
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute right-3 top-2.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold text-white">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
              {iconPath && (
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d={iconPath} />
                </svg>
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
