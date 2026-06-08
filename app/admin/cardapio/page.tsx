'use client'

import { useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type ItemStatus = 'ok' | 'paused' | 'out'

interface MenuItem {
  id: string
  name: string
  desc: string
  price: string
  group: string
  status: ItemStatus
  days: number[]
}

interface ComplementoPreset {
  name: string
  items: string[]
}

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

const GROUPS = [
  { name: 'Lanches', count: 5 },
  { name: 'Combos', count: 4 },
  { name: 'Bebidas', count: 6 },
  { name: 'Sobremesas', count: 3 },
  { name: 'Porções', count: 4 },
]

const ITEMS: MenuItem[] = [
  { id: 'l1', name: 'Burger Duplo Artesanal', desc: '2 carnes, cheddar e molho da casa', price: '32,90', group: 'Lanches', status: 'ok', days: ALL_DAYS },
  { id: 'l2', name: 'X-Salada Clássico', desc: 'Carne, queijo, alface e tomate', price: '24,90', group: 'Lanches', status: 'ok', days: ALL_DAYS },
  { id: 'l3', name: 'X-Bacon Supremo', desc: 'Carne, bacon crocante e cheddar', price: '28,90', group: 'Lanches', status: 'paused', days: ALL_DAYS },
  { id: 'l4', name: 'Veggie Burger', desc: 'Hambúrguer de grão-de-bico e legumes', price: '26,50', group: 'Lanches', status: 'out', days: [0, 6] },
  { id: 'l5', name: 'Frango Crispy', desc: 'Filé empanado, maionese e picles', price: '27,90', group: 'Lanches', status: 'ok', days: ALL_DAYS },
]

const PRESETS: ComplementoPreset[] = [
  { name: 'Adicionais de Burger', items: ['Bacon extra', 'Cheddar extra', 'Ovo', 'Cebola caramelizada', 'Picles', 'Molho barbecue'] },
  { name: 'Bordas & Massas', items: ['Borda catupiry', 'Borda cheddar', 'Massa fina', 'Massa tradicional'] },
  { name: 'Bebidas extras', items: ['Coca 350ml', 'Guaraná 350ml', 'Suco natural', 'Água com gás'] },
]

const INITIAL_COMPLEMENTOS = [
  { name: 'Bacon extra', price: '+ R$ 4,00' },
  { name: 'Cheddar extra', price: '+ R$ 3,50' },
  { name: 'Ovo', price: '+ R$ 2,50' },
  { name: 'Cebola caramelizada', price: '+ R$ 3,00' },
]

function StatusBadge({ status }: { status: ItemStatus }) {
  if (status === 'out') return <Badge tone="danger">Esgotado</Badge>
  if (status === 'paused') return <Badge tone="paused">Pausado</Badge>
  return <Badge tone="ok">Disponível</Badge>
}

function DayToggles({ initialDays }: { initialDays: number[] }) {
  const [active, setActive] = useState(new Set(initialDays))

  function toggle(day: number) {
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  return (
    <div className="flex gap-1">
      {DAY_LABELS.map((label, day) => (
        <button
          key={day}
          type="button"
          onClick={() => toggle(day)}
          className={[
            'flex h-6 w-6 select-none items-center justify-center rounded-menuzia border text-[11px] font-bold transition-colors',
            active.has(day)
              ? 'border-primary bg-primary text-white'
              : 'border-border bg-white text-text-subtle hover:border-primary',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

type View = 'table' | 'grid'
type Drawer = null | 'edit' | 'preset'

export default function CardapioPage() {
  const [activeGroup, setActiveGroup] = useState('Lanches')
  const [view, setView] = useState<View>('table')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [complementos, setComplementos] = useState(INITIAL_COMPLEMENTOS)
  const [activePreset, setActivePreset] = useState('Adicionais de Burger')

  const visibleItems = useMemo(
    () =>
      ITEMS.filter(
        (item) =>
          item.group === activeGroup &&
          item.name.toLowerCase().includes(search.toLowerCase())
      ),
    [activeGroup, search]
  )

  const allSelected = visibleItems.length > 0 && visibleItems.every((item) => selected.has(item.id))

  function toggleAll() {
    setSelected((prev) => {
      if (allSelected) {
        const next = new Set(prev)
        visibleItems.forEach((item) => next.delete(item.id))
        return next
      }
      const next = new Set(prev)
      visibleItems.forEach((item) => next.add(item.id))
      return next
    })
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openEdit() {
    setDrawer('edit')
  }

  function openPreset() {
    setDrawer('preset')
  }

  function closeDrawer() {
    setDrawer(null)
  }

  function importPreset(preset: ComplementoPreset) {
    setActivePreset(preset.name)
    setComplementos(preset.items.map((name) => ({ name, price: '+ R$ 0,00' })))
    setDrawer('edit')
  }

  function addComplemento() {
    setComplementos((prev) => [...prev, { name: 'Novo complemento', price: '+ R$ 0,00' }])
  }

  function removeComplemento(index: number) {
    setComplementos((prev) => prev.filter((_, i) => i !== index))
  }

  return (
    <>
      <TopBar title="Gestor de Cardápio" breadcrumb={`Cardápio › ${activeGroup}`} />

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="primary" onClick={openEdit}>
            + Novo item
          </Button>
          <Button variant="outline" onClick={openPreset}>
            Importar preset
          </Button>
          <Button variant="outline">Ordenação</Button>
          <div className="flex-1" />
          <div className="flex min-w-[220px] items-center gap-2 rounded-menuzia border border-border bg-white px-2.5 py-1.5">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-text-subtle">
              <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquise pelo nome..."
              className="w-full border-none font-sans text-[13px] text-text-main outline-none"
            />
          </div>
          <div className="flex overflow-hidden rounded-menuzia border border-border bg-white">
            <button
              type="button"
              onClick={() => setView('table')}
              title="Tabela"
              className={`flex items-center px-2.5 py-1.5 ${view === 'table' ? 'bg-primary text-white' : 'text-text-subtle'}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setView('grid')}
              title="Grade"
              className={`flex items-center px-2.5 py-1.5 ${view === 'grid' ? 'bg-primary text-white' : 'text-text-subtle'}`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" />
              </svg>
            </button>
          </div>
          <div className="relative">
            <Button variant="secondary" onClick={() => setActionsOpen((open) => !open)}>
              Ação
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </Button>
            {actionsOpen && (
              <div className="absolute right-0 top-[calc(100%+4px)] z-40 min-w-[160px] rounded-menuzia border border-border bg-white p-1 shadow-xl">
                <button className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page">
                  Esgotar
                </button>
                <button className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page">
                  Pausar
                </button>
                <button className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-danger hover:bg-page">
                  Excluir
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Layout: groups + content */}
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Groups panel */}
          <aside className="flex w-[230px] flex-shrink-0 flex-col overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="border-b border-border px-3.5 py-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-subtle">Grupos do cardápio</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {GROUPS.map((group) => (
                <button
                  key={group.name}
                  onClick={() => setActiveGroup(group.name)}
                  className={[
                    'flex w-full items-center justify-between rounded-menuzia border-l-[3px] px-3 py-2.5 text-left text-sm font-medium transition-colors',
                    group.name === activeGroup
                      ? 'border-l-primary bg-[#ECFEFF] font-semibold text-primary-dark'
                      : 'border-l-transparent text-text-main hover:bg-page',
                  ].join(' ')}
                >
                  <span>{group.name}</span>
                  <span
                    className={[
                      'rounded-full px-2 py-0.5 text-[11px] font-bold',
                      group.name === activeGroup ? 'bg-white text-primary-dark' : 'bg-page text-text-subtle',
                    ].join(' ')}
                  >
                    {group.count}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 border-t border-border p-2.5">
              <Button variant="primary" className="flex-1">
                + Grupo
              </Button>
              <Button variant="outline" title="Reordenar grupos">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                  <path d="M7 14l5 5 5-5zm0-4l5-5 5 5z" />
                </svg>
              </Button>
            </div>
          </aside>

          {/* Content panel */}
          <section className="flex flex-1 flex-col overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-4 py-3">
              <div className="text-[13px] text-text-subtle">
                Total de <b className="text-text-main">{visibleItems.length} itens</b> em <b className="text-text-main">{activeGroup}</b>
              </div>
              {selected.size > 0 && (
                <div className="flex items-center gap-3 rounded-menuzia bg-sidebar-bg px-3.5 py-2 text-white">
                  <span>
                    <b className="text-primary">{selected.size}</b> selecionado(s)
                  </span>
                  <Button variant="secondary" className="bg-[#374151] text-white hover:bg-[#4B5563]">
                    Esgotar
                  </Button>
                  <Button variant="secondary" className="bg-[#374151] text-white hover:bg-[#4B5563]">
                    Pausar
                  </Button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {view === 'table' ? (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky top-0 w-9 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5">
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={allSelected} onChange={toggleAll} />
                      </th>
                      <th className="sticky top-0 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Item</th>
                      <th className="sticky top-0 w-[120px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Preço</th>
                      <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Categoria</th>
                      <th className="sticky top-0 w-[230px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Disponibilidade</th>
                      <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Status</th>
                      <th className="sticky top-0 w-[90px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <tr key={item.id} className={selected.has(item.id) ? 'bg-[#ECFEFF]' : 'hover:bg-[#F9FAFB]'}>
                        <td className="border-b border-border px-3.5 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={selected.has(item.id)}
                            onChange={() => toggleRow(item.id)}
                          />
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-menuzia bg-gradient-to-br from-slate-100 to-slate-200">
                              <svg viewBox="0 0 24 24" className="h-6 w-6 fill-text-subtle/60">
                                <path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" />
                              </svg>
                            </div>
                            <div>
                              <div className="text-[13px] font-semibold">{item.name}</div>
                              <div className="mt-0.5 text-[11px] text-text-subtle">{item.desc}</div>
                            </div>
                          </div>
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <span className="inline-flex min-w-[92px] items-center gap-1 rounded-menuzia border border-border bg-white px-2 py-1.5 text-[13px] font-semibold">
                            <span className="text-[11px] text-text-subtle">R$</span>
                            <input defaultValue={item.price} className="w-[60px] border-none font-sans text-[13px] font-semibold text-text-main outline-none" />
                          </span>
                        </td>
                        <td className="border-b border-border px-3.5 py-3 text-[12px] text-text-subtle">{item.group}</td>
                        <td className="border-b border-border px-3.5 py-3">
                          <DayToggles initialDays={item.status === 'out' ? [0, 6] : ALL_DAYS} />
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={openEdit}
                              title="Editar"
                              className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary"
                            >
                              <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75z" />
                              </svg>
                            </button>
                            <button
                              title="Duplicar"
                              className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary"
                            >
                              <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
                                <path d="M16 1H4a2 2 0 00-2 2v14h2V3h12zm3 4H8a2 2 0 00-2 2v14a2 2 0 002 2h11a2 2 0 002-2V7a2 2 0 00-2-2zm0 16H8V7h11z" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5 p-4">
                  {visibleItems.map((item) => (
                    <div key={item.id} className="flex flex-col overflow-hidden rounded-menuzia border border-border bg-white">
                      <div className="relative flex h-[120px] items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                        <svg viewBox="0 0 24 24" className="h-[46px] w-[46px] fill-text-subtle/50">
                          <path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" />
                        </svg>
                        {item.status !== 'ok' && (
                          <div className="absolute left-2 top-2">
                            <StatusBadge status={item.status} />
                          </div>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5 p-3">
                        <div className="text-sm font-semibold">{item.name}</div>
                        <div className="flex-1 text-xs leading-relaxed text-text-subtle">{item.desc}</div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="rounded-menuzia bg-price-bg px-2 py-1 text-[13px] font-bold text-price-text">R$ {item.price}</span>
                          <button
                            onClick={openEdit}
                            className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary"
                          >
                            <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75z" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      {/* Overlay + drawers */}
      {drawer && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={closeDrawer} />}

      {/* Drawer: import preset */}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[420px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          drawer === 'preset' ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Importar preset de complementos</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Selecione uma lista salva para aplicar a este lanche.</p>
          </div>
          <button onClick={closeDrawer} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          {PRESETS.map((preset) => (
            <div key={preset.name} className="mb-3 rounded-menuzia border border-border p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold">{preset.name}</h4>
                <span className="rounded-full bg-page px-2 py-0.5 text-[11px] font-semibold text-text-subtle">{preset.items.length} itens</span>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {preset.items.map((entry) => (
                  <span key={entry} className="rounded-menuzia bg-page px-2 py-1 text-[11px] font-medium text-text-subtle">
                    {entry}
                  </span>
                ))}
              </div>
              <Button variant="primary" className="w-full" onClick={() => importPreset(preset)}>
                Importar com 1 clique
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={closeDrawer}>
            Cancelar
          </Button>
        </div>
      </aside>

      {/* Drawer: edit item */}
      <aside
        className={[
          'fixed right-0 top-0 z-[60] flex h-screen w-[420px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300',
          drawer === 'edit' ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Editar lanche</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Burger Duplo Artesanal</p>
          </div>
          <button onClick={closeDrawer} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <div className="mb-2 mt-0 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome do item</div>
          <input defaultValue="Burger Duplo Artesanal" className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none" />

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Descrição</div>
          <input
            defaultValue="Pão brioche, 2 hambúrgueres 120g, cheddar e molho da casa"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none"
          />

          <div className="mt-4 flex gap-3">
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Preço</div>
              <input defaultValue="R$ 32,90" className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none" />
            </div>
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Categoria</div>
              <input defaultValue="Lanches" className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none" />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
              Complementos{' '}
              <span className="ml-1.5 rounded-menuzia bg-alert-bg px-1.5 py-0.5 text-[10px] font-bold uppercase text-alert-text">Preset: {activePreset}</span>
            </div>
            <button onClick={openPreset} className="px-1.5 py-1 text-xs font-medium text-text-subtle hover:text-text-main">
              Trocar preset
            </button>
          </div>
          <p className="mb-3 mt-1.5 text-xs text-text-subtle">
            Você importou uma família de complementos. Pode adicionar ou remover itens só neste lanche, sem afetar o preset.
          </p>

          <div>
            {complementos.map((comp, index) => (
              <div key={`${comp.name}-${index}`} className="mb-2 flex items-center gap-2.5 rounded-menuzia border border-border px-2.5 py-2">
                <span className="flex-1 text-[13px] font-medium">{comp.name}</span>
                <span className="text-xs font-semibold text-price-text">{comp.price}</span>
                <button
                  onClick={() => removeComplemento(index)}
                  className="flex h-[26px] w-[26px] items-center justify-center rounded-menuzia bg-danger-bg text-[15px] text-danger hover:bg-[#FCA5A5] hover:text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button onClick={addComplemento} className="w-full rounded-menuzia border border-dashed border-border bg-white py-2.5 text-xs font-semibold uppercase tracking-wide text-text-subtle hover:border-primary hover:text-primary">
            + Adicionar complemento avulso
          </button>
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={closeDrawer}>
            Cancelar
          </Button>
          <Button variant="primary" className="flex-1" onClick={closeDrawer}>
            Salvar item
          </Button>
        </div>
      </aside>
    </>
  )
}
