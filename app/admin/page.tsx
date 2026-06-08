import Link from 'next/link'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'

const MODULES = [
  { href: '/admin/dashboard', label: 'Dashboard', desc: 'Métricas e faturamento do restaurante' },
  { href: '/admin/pedidos', label: 'Painel de Pedidos', desc: 'Acompanhe e avance os pedidos em tempo real' },
  { href: '/admin/logistica', label: 'Logística', desc: 'Distribua entregas e feche o caixa dos entregadores' },
  { href: '/admin/cardapio', label: 'Cardápio', desc: 'Gerencie itens, complementos e promoções' },
]

export default function AdminIndexPage() {
  return (
    <>
      <TopBar title="Painel administrativo" breadcrumb="Menuzia › Início" />

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div className="flex flex-col items-start justify-between gap-3 rounded-menuzia border border-border bg-white p-5 sm:flex-row sm:items-center">
          <div>
            <h1 className="text-base font-bold">Bem-vindo ao painel da sua loja</h1>
            <p className="mt-1 text-[13px] text-text-subtle">
              Acompanhe pedidos, organize o cardápio e veja como o cliente final enxerga sua vitrine.
            </p>
          </div>
          <Link href="/loja/demo" target="_blank">
            <Button variant="primary">Ver cardápio do cliente</Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map((module) => (
            <Link
              key={module.href}
              href={module.href}
              className="rounded-menuzia border border-border bg-white p-4 transition-colors hover:border-primary"
            >
              <div className="text-sm font-semibold text-text-main">{module.label}</div>
              <p className="mt-1.5 text-xs leading-relaxed text-text-subtle">{module.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </>
  )
}
