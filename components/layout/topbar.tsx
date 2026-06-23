export interface TopBarProps {
  title: string
  breadcrumb: string
  right?: React.ReactNode
}

export function TopBar({ title, breadcrumb, right }: TopBarProps) {
  return (
    <header className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border bg-main px-5">
      <div>
        <div className="text-[16px] font-semibold text-text-main">{title}</div>
        <div className="mt-0.5 text-xs text-text-subtle">{breadcrumb}</div>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </header>
  )
}
