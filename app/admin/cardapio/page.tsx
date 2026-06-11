'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  adicionarComplemento,
  adicionarItemPreset,
  adicionarOrderBump,
  atualizarGrupoItem,
  atualizarItem,
  atualizarItemPreset,
  atualizarOrderBumpMax,
  atualizarRegrasPreset,
  buscarOrderBumpConfig,
  buscarRestauranteIdDoUsuario,
  criarGrupo,
  criarGrupoItem,
  criarItem,
  criarPreset,
  definirStatusEmLote,
  enviarImagemItem,
  excluirItens,
  importarPresetNoItem,
  listarGrupos,
  listarItens,
  listarOrderBumps,
  listarPresets,
  removerComplemento,
  removerGrupoItem,
  removerItemPreset,
  removerOrderBump,
  removerPreset,
  renomearPreset,
  reordenarOrderBumps,
  toggleOrderBumpAtivo,
  type GrupoCardapio,
  type GrupoItemComplementos,
  type ItemCardapio,
  type OrderBumpEntry,
  type PresetComplementos,
  type StatusItem,
} from '@/lib/queries/cardapio'

// ─── Constants ───────────────────────────────────────────────────────────────

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

const STATUS_OPTIONS: { value: StatusItem; label: string }[] = [
  { value: 'disponivel', label: 'Disponível' },
  { value: 'pausado', label: 'Pausado' },
  { value: 'esgotado', label: 'Esgotado' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

type View = 'table' | 'grid'
type CardapioTab = 'itens' | 'complementos' | 'orderbump'
type Drawer = null | 'edit' | 'preset' | 'categoria'

interface ItemFormState {
  id: string | null
  grupoId: string | null
  nome: string
  descricao: string
  preco: string
  status: StatusItem
  diasDisponiveis: number[]
  imagemUrl: string | null
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function blankForm(grupoId: string | null): ItemFormState {
  return { id: null, grupoId, nome: '', descricao: '', preco: '', status: 'disponivel', diasDisponiveis: ALL_DAYS, imagemUrl: null }
}

function formFromItem(item: ItemCardapio): ItemFormState {
  return {
    id: item.id,
    grupoId: item.grupoId,
    nome: item.nome,
    descricao: item.descricao,
    preco: item.preco.toFixed(2).replace('.', ','),
    status: item.status,
    diasDisponiveis: item.diasDisponiveis,
    imagemUrl: item.imagemUrl,
  }
}

function parsePreco(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

function ruleHint(grupo: { obrigatorio: boolean; minEscolhas: number; maxEscolhas: number }): string {
  if (grupo.obrigatorio) {
    return grupo.minEscolhas === grupo.maxEscolhas
      ? `Escolha ${grupo.minEscolhas}`
      : `Escolha ${grupo.minEscolhas}–${grupo.maxEscolhas}`
  }
  return grupo.maxEscolhas === 1 ? 'Escolha até 1' : `Escolha até ${grupo.maxEscolhas}`
}

// ─── Item-level sub-components ───────────────────────────────────────────────

function StatusBadge({ status }: { status: StatusItem }) {
  if (status === 'esgotado') return <Badge tone="danger">Esgotado</Badge>
  if (status === 'pausado') return <Badge tone="paused">Pausado</Badge>
  return <Badge tone="ok">Disponível</Badge>
}

function DayToggles({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  const active = useMemo(() => new Set(days), [days])
  function toggle(day: number) {
    const next = new Set(active)
    if (next.has(day)) next.delete(day)
    else next.add(day)
    onChange([...next].sort())
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

function ItemThumb({ item, size = 42 }: { item: ItemCardapio; size?: number }) {
  if (item.imagemUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.imagemUrl} alt={item.nome} className="flex-shrink-0 rounded-menuzia object-cover" style={{ width: size, height: size }} />
    )
  }
  return (
    <div className="flex flex-shrink-0 items-center justify-center rounded-menuzia bg-gradient-to-br from-slate-100 to-slate-200" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" className="h-[55%] w-[55%] fill-text-subtle/60">
        <path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" />
      </svg>
    </div>
  )
}

// ─── Food Icons ───────────────────────────────────────────────────────────────

type FoodIconType = 'bacon' | 'tomate' | 'cebola' | 'alface' | 'queijo' | 'pimenta' | 'pepino' | 'cogumelo' | 'default'

function detectFoodIcon(name: string): FoodIconType {
  const n = name.toLowerCase()
  if (n.includes('bacon')) return 'bacon'
  if (n.includes('tomate') || n.includes('tomato')) return 'tomate'
  if (n.includes('cebola') || n.includes('onion')) return 'cebola'
  if (n.includes('alface') || n.includes('lettuce')) return 'alface'
  if (n.includes('queijo') || n.includes('cheddar') || n.includes('mussarela') || n.includes('mozza')) return 'queijo'
  if (n.includes('pimenta') || n.includes('pepper') || n.includes('chili') || n.includes('jalap')) return 'pimenta'
  if (n.includes('pepino') || n.includes('cucumber')) return 'pepino'
  if (n.includes('cogumelo') || n.includes('mushroom')) return 'cogumelo'
  return 'default'
}

function FoodIcon({ name, size = 40 }: { name: string; size?: number }) {
  const type = detectFoodIcon(name)
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden>
      {type === 'bacon' && <>
        <path d="M5 14 Q12.5 10 20 14 Q27.5 18 35 14" stroke="#EF4444" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M5 21 Q12.5 17 20 21 Q27.5 25 35 21" stroke="#FCA5A5" strokeWidth="4" fill="none" strokeLinecap="round" />
        <path d="M5 28 Q12.5 24 20 28 Q27.5 32 35 28" stroke="#EF4444" strokeWidth="4" fill="none" strokeLinecap="round" />
      </>}
      {type === 'tomate' && <>
        <circle cx="20" cy="23" r="14" fill="#EF4444" />
        <path d="M20 9 L20 5 M14 8 Q17 5 20 7 Q23 5 26 8" stroke="#16A34A" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="15" cy="20" r="2.5" fill="#FCA5A5" opacity="0.5" />
      </>}
      {type === 'cebola' && <>
        <ellipse cx="20" cy="25" rx="13" ry="10" fill="#FDE68A" />
        <ellipse cx="20" cy="25" rx="9" ry="7" fill="#FCD34D" />
        <ellipse cx="20" cy="25" rx="5" ry="4" fill="#FBBF24" />
        <path d="M20 15 Q22 9 20 5 Q18 9 20 15Z" fill="#86EFAC" />
      </>}
      {type === 'alface' && <>
        <circle cx="20" cy="21" r="13" fill="#4ADE80" />
        <path d="M7 21 Q10 16 14 21 Q17 26 20 21 Q23 16 26 21 Q30 26 33 21" stroke="#22C55E" strokeWidth="2.5" fill="none" />
        <circle cx="20" cy="21" r="5" fill="#BBF7D0" />
      </>}
      {type === 'queijo' && <>
        <path d="M5 31 L20 9 L35 31 Z" fill="#FCD34D" />
        <path d="M5 31 L35 31 L35 37 L5 37 Z" fill="#FBBF24" />
        <circle cx="20" cy="27" r="2" fill="#FEF08A" />
        <circle cx="14" cy="30" r="1.5" fill="#FEF08A" />
        <circle cx="26" cy="30" r="1.5" fill="#FEF08A" />
      </>}
      {type === 'pimenta' && <>
        <path d="M23 4 Q27 7 27 13 Q27 23 19 31 Q15 34 13 31 Q11 28 14 26 Q19 23 19 16 Q19 9 23 4Z" fill="#DC2626" />
        <path d="M22 4 Q26 2 28 5" stroke="#86EFAC" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <ellipse cx="20" cy="18" rx="3" ry="5" fill="#EF4444" opacity="0.4" />
      </>}
      {type === 'pepino' && <>
        <ellipse cx="20" cy="20" rx="8" ry="14" fill="#4ADE80" />
        <ellipse cx="20" cy="20" rx="5" ry="11" fill="#BBF7D0" />
        <circle cx="20" cy="13" r="1.5" fill="#4ADE80" />
        <circle cx="20" cy="20" r="1.5" fill="#4ADE80" />
        <circle cx="20" cy="27" r="1.5" fill="#4ADE80" />
      </>}
      {type === 'cogumelo' && <>
        <path d="M6 25 Q6 12 20 10 Q34 12 34 25Z" fill="#D4A27F" />
        <rect x="14" y="25" width="12" height="8" rx="2" fill="#E8C9A0" />
        <circle cx="14" cy="19" r="2" fill="#B8875A" />
        <circle cx="20" cy="16" r="2" fill="#B8875A" />
        <circle cx="26" cy="19" r="2" fill="#B8875A" />
      </>}
      {type === 'default' && <>
        <circle cx="20" cy="20" r="14" fill="#EDE9FE" />
        <path d="M20 12 L20 28 M12 20 L28 20" stroke="#7C3AED" strokeWidth="3" strokeLinecap="round" />
      </>}
    </svg>
  )
}

// ─── Grupo de complementos por item (drawer) ──────────────────────────────────

function GrupoItemCard({
  grupo,
  itemId,
  onRefresh,
}: {
  grupo: GrupoItemComplementos
  itemId: string
  onRefresh: () => Promise<void>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [editingHeader, setEditingHeader] = useState(false)
  const [nome, setNome] = useState(grupo.nome)
  const [obrigatorio, setObrigatorio] = useState(grupo.obrigatorio)
  const [minEsc, setMinEsc] = useState(grupo.minEscolhas)
  const [maxEsc, setMaxEsc] = useState(grupo.maxEscolhas)
  const [newNome, setNewNome] = useState('')
  const [newPreco, setNewPreco] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveHeader() {
    const trimmed = nome.trim() || grupo.nome
    const effectiveMin = obrigatorio ? Math.min(minEsc, maxEsc) : 0
    try {
      await atualizarGrupoItem(supabase, grupo.id, trimmed, obrigatorio, effectiveMin, Math.max(maxEsc, 1))
      setEditingHeader(false)
      await onRefresh()
    } catch { /* silencioso */ }
  }

  function cancelEdit() {
    setNome(grupo.nome)
    setObrigatorio(grupo.obrigatorio)
    setMinEsc(grupo.minEscolhas)
    setMaxEsc(grupo.maxEscolhas)
    setEditingHeader(false)
  }

  async function removeGroup() {
    if (!confirm(`Remover o grupo "${grupo.nome}" e todos os seus complementos?`)) return
    try {
      await removerGrupoItem(supabase, grupo.id)
      await onRefresh()
    } catch { /* silencioso */ }
  }

  async function addComp() {
    if (!newNome.trim()) return
    setSaving(true)
    const val = parseFloat(newPreco.replace(',', '.'))
    const preco = Number.isFinite(val) && val >= 0 ? val : 0
    try {
      await adicionarComplemento(supabase, itemId, newNome.trim(), preco, grupo.complementos.length, grupo.id)
      setNewNome('')
      setNewPreco('')
      await onRefresh()
    } catch { /* silencioso */ }
    finally { setSaving(false) }
  }

  async function removeComp(compId: string) {
    try {
      await removerComplemento(supabase, compId)
      await onRefresh()
    } catch { /* silencioso */ }
  }

  return (
    <div className="mb-3 overflow-hidden rounded-menuzia border border-border bg-white">
      {editingHeader ? (
        <div className="space-y-2.5 border-b border-border bg-page p-3">
          <input
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do grupo"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary"
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-main">
              <input
                type="checkbox"
                checked={obrigatorio}
                onChange={(e) => setObrigatorio(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              Obrigatório
            </label>
            {obrigatorio && (
              <label className="flex items-center gap-1.5 text-[12px] text-text-subtle">
                Mín
                <input
                  type="number"
                  min="0"
                  max={maxEsc}
                  value={minEsc}
                  onChange={(e) => setMinEsc(Math.max(0, Number(e.target.value)))}
                  className="w-14 rounded-menuzia border border-border px-2 py-1 text-center text-[12px] outline-none focus:border-primary"
                />
              </label>
            )}
            <label className="flex items-center gap-1.5 text-[12px] text-text-subtle">
              Máx
              <input
                type="number"
                min="1"
                value={maxEsc}
                onChange={(e) => setMaxEsc(Math.max(1, Number(e.target.value)))}
                className="w-14 rounded-menuzia border border-border px-2 py-1 text-center text-[12px] outline-none focus:border-primary"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={saveHeader}
              className="rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark"
            >
              Salvar
            </button>
            <button
              onClick={cancelEdit}
              className="rounded-menuzia border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-page"
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 border-b border-border bg-page px-3 py-2.5">
          <span className="flex-1 text-[13px] font-semibold text-text-main">{grupo.nome}</span>
          <span
            className={[
              'rounded-menuzia px-1.5 py-0.5 text-[10px] font-bold',
              grupo.obrigatorio ? 'bg-danger-bg text-danger' : 'border border-border bg-white text-text-subtle',
            ].join(' ')}
          >
            {grupo.obrigatorio ? 'Obrigatório' : 'Opcional'}
          </span>
          <span className="text-[11px] text-text-subtle">{ruleHint(grupo)}</span>
          <button onClick={() => setEditingHeader(true)} className="text-[11px] text-text-subtle hover:text-primary">
            Editar
          </button>
          <button onClick={removeGroup} className="text-[11px] text-text-subtle hover:text-danger">
            Remover
          </button>
        </div>
      )}

      <div className="px-3 py-2">
        {grupo.complementos.length === 0 && (
          <div className="py-2 text-center text-[11px] text-text-subtle">Nenhum item. Adicione abaixo.</div>
        )}
        {grupo.complementos.map((comp) => (
          <div key={comp.id} className="flex items-center gap-2 border-b border-border py-1.5 last:border-none">
            <span className="flex-1 text-[13px] font-medium">{comp.nome}</span>
            {comp.preco > 0 ? (
              <span className="text-[12px] font-semibold text-price-text">
                + R$ {comp.preco.toFixed(2).replace('.', ',')}
              </span>
            ) : (
              <span className="rounded-menuzia bg-price-bg px-1.5 py-0.5 text-[11px] font-bold text-price-text">
                Grátis
              </span>
            )}
            <button
              onClick={() => removeComp(comp.id)}
              className="flex h-[22px] w-[22px] items-center justify-center rounded-menuzia bg-danger-bg text-[13px] text-danger hover:bg-[#FCA5A5]"
            >
              ×
            </button>
          </div>
        ))}

        <div className="mt-2 flex items-center gap-2">
          <input
            value={newNome}
            onChange={(e) => setNewNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addComp()}
            placeholder="Nome do item (ex: Ao ponto)"
            className="flex-1 rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-primary placeholder:text-text-subtle/60"
          />
          <input
            value={newPreco}
            onChange={(e) => setNewPreco(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addComp()}
            placeholder="0,00"
            className="w-20 rounded-menuzia border border-border bg-white px-2 py-1.5 text-right text-[12px] outline-none focus:border-primary placeholder:text-text-subtle/60"
          />
          <button
            onClick={addComp}
            disabled={saving || !newNome.trim()}
            className="rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold text-text-subtle transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
          >
            + Item
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Preset Group Card (for Grupos de Complementos tab) ──────────────────────

interface PresetItemEdit {
  id: string
  nome: string
  preco: string
  editing: boolean
}

function PresetGroupCard({
  preset,
  onDeleted,
  onRenamed,
}: {
  preset: PresetComplementos
  onDeleted: (id: string) => void
  onRenamed: (id: string, nome: string) => void
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [nome, setNome] = useState(preset.nome)
  const [editingNome, setEditingNome] = useState(false)
  const [obrigatorio, setObrigatorio] = useState(preset.obrigatorio)
  const [minEsc, setMinEsc] = useState(preset.minEscolhas)
  const [maxEsc, setMaxEsc] = useState(preset.maxEscolhas)
  const [items, setItems] = useState<PresetItemEdit[]>(
    preset.itens.map((i) => ({ id: i.id, nome: i.nome, preco: String(i.preco), editing: false }))
  )
  const [newNome, setNewNome] = useState('')
  const [newPreco, setNewPreco] = useState('')
  const [saving, setSaving] = useState(false)
  const nomeRef = useRef<HTMLInputElement>(null)

  function startEditNome() {
    setEditingNome(true)
    setTimeout(() => nomeRef.current?.focus(), 0)
  }

  async function saveNome() {
    const trimmed = nome.trim()
    if (!trimmed) { setNome(preset.nome); setEditingNome(false); return }
    try {
      await renomearPreset(supabase, preset.id, trimmed)
      onRenamed(preset.id, trimmed)
    } catch {
      setNome(preset.nome)
    }
    setEditingNome(false)
  }

  async function saveRules(newObrigatorio: boolean, newMin: number, newMax: number) {
    try {
      await atualizarRegrasPreset(supabase, preset.id, newObrigatorio, newMin, newMax)
    } catch { /* silencioso */ }
  }

  async function deletePreset() {
    if (!confirm(`Excluir o grupo "${nome}"? Os complementos já importados nos itens não serão afetados.`)) return
    try {
      await removerPreset(supabase, preset.id)
      onDeleted(preset.id)
    } catch { /* silencioso */ }
  }

  async function addItem() {
    if (!newNome.trim()) return
    const val = parseFloat(newPreco.replace(',', '.'))
    const preco = Number.isFinite(val) && val >= 0 ? val : 0
    setSaving(true)
    try {
      const created = await adicionarItemPreset(supabase, preset.id, newNome.trim(), preco, items.length)
      setItems((prev) => [...prev, { id: created.id, nome: created.nome, preco: String(created.preco), editing: false }])
      setNewNome('')
      setNewPreco('')
    } catch { /* silencioso */ }
    finally { setSaving(false) }
  }

  async function saveItem(id: string) {
    const item = items.find((i) => i.id === id)
    if (!item) return
    const val = parseFloat(item.preco.replace(',', '.'))
    const preco = Number.isFinite(val) && val >= 0 ? val : 0
    try {
      await atualizarItemPreset(supabase, id, item.nome.trim(), preco)
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, nome: item.nome.trim(), preco: String(preco), editing: false } : i)))
    } catch { /* silencioso */ }
  }

  async function deleteItem(id: string) {
    try {
      await removerItemPreset(supabase, id)
      setItems((prev) => prev.filter((i) => i.id !== id))
    } catch { /* silencioso */ }
  }

  const hint = ruleHint({ obrigatorio, minEscolhas: minEsc, maxEscolhas: maxEsc })

  return (
    <div className="overflow-hidden rounded-menuzia border border-purple-200 bg-white shadow-sm">
      {/* Card header */}
      <div className="flex items-center gap-3 border-b border-purple-100 bg-purple-50 px-4 py-3.5">
        <div className="flex h-[44px] w-[44px] flex-shrink-0 items-center justify-center rounded-menuzia bg-white shadow-sm">
          <FoodIcon name={nome} size={32} />
        </div>
        <div className="min-w-0 flex-1">
          {editingNome ? (
            <input
              ref={nomeRef}
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onBlur={saveNome}
              onKeyDown={(e) => e.key === 'Enter' && saveNome()}
              className="w-full rounded-menuzia border border-purple-400 bg-white px-2.5 py-1.5 text-sm font-semibold text-purple-900 outline-none"
            />
          ) : (
            <h4 className="truncate text-[15px] font-semibold text-purple-900">{nome}</h4>
          )}
        </div>
        <span className="flex-shrink-0 rounded-full bg-purple-100 px-2.5 py-0.5 text-[11px] font-bold text-purple-700">
          {items.length} iten{items.length !== 1 ? 's' : ''}
        </span>
        <button onClick={startEditNome} title="Renomear" className="flex-shrink-0 text-[11px] font-semibold text-purple-400 hover:text-purple-700">
          Renomear
        </button>
        <button onClick={deletePreset} title="Excluir" className="flex-shrink-0 text-[11px] font-semibold text-purple-300 hover:text-danger">
          Excluir
        </button>
      </div>

      {/* Rules section */}
      <div className="flex flex-wrap items-center gap-3 border-b border-purple-100 bg-purple-50/40 px-4 py-2.5">
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-main">
          <input
            type="checkbox"
            checked={obrigatorio}
            onChange={(e) => {
              const v = e.target.checked
              setObrigatorio(v)
              saveRules(v, minEsc, maxEsc)
            }}
            className="h-3.5 w-3.5 accent-purple-600"
          />
          Obrigatório
        </label>
        {obrigatorio && (
          <label className="flex items-center gap-1.5 text-[12px] text-text-subtle">
            Mín
            <input
              type="number"
              min="0"
              max={maxEsc}
              value={minEsc}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value))
                setMinEsc(v)
                saveRules(obrigatorio, v, maxEsc)
              }}
              className="w-14 rounded-menuzia border border-purple-200 px-2 py-1 text-center text-[12px] outline-none focus:border-purple-400"
            />
          </label>
        )}
        <label className="flex items-center gap-1.5 text-[12px] text-text-subtle">
          Máx
          <input
            type="number"
            min="1"
            value={maxEsc}
            onChange={(e) => {
              const v = Math.max(1, Number(e.target.value))
              setMaxEsc(v)
              saveRules(obrigatorio, minEsc, v)
            }}
            className="w-14 rounded-menuzia border border-purple-200 px-2 py-1 text-center text-[12px] outline-none focus:border-purple-400"
          />
        </label>
        <span className="ml-auto text-[11px] italic text-text-subtle">{hint}</span>
      </div>

      {/* Item list */}
      <div className="px-4 py-3">
        {items.length === 0 && (
          <p className="mb-3 text-[12px] text-text-subtle">Nenhum item ainda. Adicione abaixo para compor este grupo.</p>
        )}
        {items.map((item) =>
          item.editing ? (
            <div key={item.id} className="mb-1.5 flex items-center gap-2">
              <input
                value={item.nome}
                onChange={(e) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, nome: e.target.value } : i)))}
                onKeyDown={(e) => e.key === 'Enter' && saveItem(item.id)}
                className="flex-1 rounded-menuzia border border-purple-400 bg-purple-50 px-2.5 py-1.5 text-sm outline-none"
                autoFocus
              />
              <input
                value={item.preco}
                onChange={(e) => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, preco: e.target.value } : i)))}
                onKeyDown={(e) => e.key === 'Enter' && saveItem(item.id)}
                placeholder="0,00"
                className="w-24 rounded-menuzia border border-purple-400 bg-purple-50 px-2.5 py-1.5 text-right text-sm outline-none"
              />
              <button onClick={() => saveItem(item.id)} className="text-[12px] font-semibold text-purple-600 hover:underline">Salvar</button>
              <button onClick={() => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, editing: false } : i)))} className="text-[12px] text-text-subtle hover:text-danger">✕</button>
            </div>
          ) : (
            <div key={item.id} className="mb-1.5 flex items-center gap-2 rounded-menuzia border border-purple-100 bg-purple-50/60 px-3 py-2">
              <span className="flex-1 text-[13px] font-medium text-text-main">{item.nome}</span>
              {Number(item.preco) > 0 ? (
                <span className="tabular-nums text-[12px] font-semibold text-purple-700">+ R$ {Number(item.preco).toFixed(2).replace('.', ',')}</span>
              ) : (
                <span className="rounded-menuzia bg-price-bg px-1.5 py-0.5 text-[11px] font-bold text-price-text">Grátis</span>
              )}
              <button
                onClick={() => setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, editing: true } : i)))}
                className="text-[11px] text-text-subtle hover:text-purple-600"
              >Editar</button>
              <button onClick={() => deleteItem(item.id)} className="text-[11px] text-text-subtle hover:text-danger">✕</button>
            </div>
          )
        )}

        {/* Add new item row */}
        <div className="mt-2.5 flex items-center gap-2">
          <input
            value={newNome}
            onChange={(e) => setNewNome(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="Ex: Bacon extra"
            className="flex-1 rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-purple-400 placeholder:text-text-subtle/60"
          />
          <input
            value={newPreco}
            onChange={(e) => setNewPreco(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="0,00"
            className="w-24 rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-right text-[13px] outline-none focus:border-purple-400 placeholder:text-text-subtle/60"
          />
          <button
            onClick={addItem}
            disabled={saving || !newNome.trim()}
            className="rounded-menuzia border border-purple-300 bg-purple-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50"
          >
            + Item
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Grupos de Complementos tab ───────────────────────────────────────────────

function GruposComplementos({
  restauranteId,
  presets,
  setPresets,
}: {
  restauranteId: string
  presets: PresetComplementos[]
  setPresets: React.Dispatch<React.SetStateAction<PresetComplementos[]>>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [newNome, setNewNome] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createGroup() {
    if (!newNome.trim()) return
    setCreating(true)
    setError(null)
    try {
      const p = await criarPreset(supabase, restauranteId, newNome.trim())
      setPresets((prev) => [...prev, p])
      setNewNome('')
    } catch {
      setError('Não foi possível criar o grupo de complementos.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-[15px] font-bold text-text-main">Grupos de complementos</h2>
        <p className="text-[12px] leading-relaxed text-text-subtle">
          Crie grupos reutilizáveis de adicionais (ex.: <em>Adicionais de Burger</em>, <em>Molhos</em>). Defina se a escolha é{' '}
          <strong>obrigatória</strong> e quantos itens o cliente pode selecionar. No editor de cada item, importe um grupo com
          1 clique — os complementos são copiados com as regras, mas sem afetar o grupo original.
        </p>
      </div>

      {/* Create new group */}
      <div className="mb-6 flex items-center gap-3 rounded-menuzia border border-purple-200 bg-purple-50/60 p-3.5">
        <input
          value={newNome}
          onChange={(e) => setNewNome(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createGroup()}
          placeholder="Nome do novo grupo (ex: Adicionais de Burger)"
          className="flex-1 rounded-menuzia border border-purple-200 bg-white px-3 py-2 text-sm outline-none focus:border-purple-500 placeholder:text-text-subtle/60"
        />
        <button
          onClick={createGroup}
          disabled={creating || !newNome.trim()}
          className="flex-shrink-0 rounded-menuzia bg-purple-600 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
        >
          {creating ? 'Criando…' : '+ Criar grupo'}
        </button>
      </div>

      {presets.length === 0 && (
        <div className="rounded-menuzia border border-dashed border-purple-200 bg-purple-50/30 px-6 py-14 text-center text-[13px] text-text-subtle">
          Nenhum grupo criado ainda. Use o campo acima para criar o primeiro grupo de complementos.
        </div>
      )}

      {error && <p className="mb-4 rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {presets.map((preset) => (
          <PresetGroupCard
            key={preset.id}
            preset={preset}
            onDeleted={(id) => setPresets((prev) => prev.filter((p) => p.id !== id))}
            onRenamed={(id, nome) => setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, nome } : p)))}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Order Bump Tab ────────────────────────────────────────────────────────────

function OrderBumpTab({ restauranteId, items }: { restauranteId: string; items: ItemCardapio[] }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [bumps, setBumps] = useState<OrderBumpEntry[]>([])
  const [maxItems, setMaxItems] = useState(4)
  const [loadingTab, setLoadingTab] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoadingTab(true)
      try {
        const [bumpsData, config] = await Promise.all([
          listarOrderBumps(supabase, restauranteId),
          buscarOrderBumpConfig(supabase, restauranteId),
        ])
        if (!cancelled) {
          setBumps(bumpsData)
          setMaxItems(config.max)
        }
      } catch {
        if (!cancelled) setError('Não foi possível carregar as configurações de order bump.')
      } finally {
        if (!cancelled) setLoadingTab(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [supabase, restauranteId])

  const bumpItemIds = useMemo(() => new Set(bumps.map((b) => b.itemId)), [bumps])
  const availableItems = useMemo(() => items.filter((item) => !bumpItemIds.has(item.id)), [items, bumpItemIds])
  const filteredAvailable = useMemo(
    () => (search.trim() ? availableItems.filter((i) => i.nome.toLowerCase().includes(search.toLowerCase())) : availableItems),
    [availableItems, search]
  )

  async function add(item: ItemCardapio) {
    setError(null)
    try {
      const entry = await adicionarOrderBump(supabase, restauranteId, item.id, bumps.length)
      setBumps((prev) => [...prev, entry])
    } catch {
      setError('Não foi possível adicionar o produto ao order bump.')
    }
  }

  async function remove(id: string) {
    try {
      await removerOrderBump(supabase, id)
      setBumps((prev) => prev.filter((b) => b.id !== id).map((b, i) => ({ ...b, posicao: i })))
    } catch {
      setError('Não foi possível remover o produto.')
    }
  }

  async function toggle(id: string, current: boolean) {
    try {
      await toggleOrderBumpAtivo(supabase, id, !current)
      setBumps((prev) => prev.map((b) => (b.id === id ? { ...b, ativo: !current } : b)))
    } catch {
      setError('Não foi possível atualizar o status.')
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = [...bumps]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    const reordered = next.map((b, i) => ({ ...b, posicao: i }))
    setBumps(reordered)
    try {
      await reordenarOrderBumps(supabase, reordered.map((b) => ({ id: b.id, posicao: b.posicao })))
    } catch {
      setError('Não foi possível reordenar.')
    }
  }

  async function saveMax(val: number) {
    const clamped = Math.max(1, Math.min(8, val))
    setMaxItems(clamped)
    try {
      await atualizarOrderBumpMax(supabase, restauranteId, clamped)
    } catch { /* silent */ }
  }

  const fmtBrl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

  if (loadingTab) {
    return <div className="flex flex-1 items-center justify-center text-sm text-text-subtle">Carregando order bumps…</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mb-5">
        <h2 className="text-[15px] font-bold text-text-main">Order Bump</h2>
        <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-text-subtle">
          Produtos sugeridos ao cliente na seção &ldquo;Peça também&rdquo; durante o checkout. Um clique adiciona o item ao carrinho
          automaticamente. Ordene para controlar quais aparecem primeiro.
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
      )}

      {/* Config */}
      <div className="mb-6 flex flex-wrap items-center gap-3.5 rounded-menuzia border border-border bg-white px-4 py-3.5">
        <span className="text-[13px] font-medium text-text-subtle">Exibir no máximo</span>
        <input
          type="number"
          min={1}
          max={8}
          value={maxItems}
          onChange={(e) => saveMax(Number(e.target.value))}
          className="w-[60px] rounded-menuzia border border-border px-2 py-1.5 text-center text-sm font-bold outline-none focus:border-primary"
        />
        <span className="text-[13px] font-medium text-text-subtle">produtos no checkout</span>
        <span className="ml-auto rounded-menuzia bg-alert-bg px-2.5 py-1 text-[11px] font-semibold text-alert-text">
          Máx. 8 produtos
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_320px]">
        {/* Configured bumps */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-subtle">Produtos configurados</h3>
            {bumps.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">{bumps.length}</span>
            )}
            {bumps.length > maxItems && (
              <span className="ml-auto text-[11px] font-medium text-warn">Apenas os primeiros {maxItems} serão exibidos</span>
            )}
          </div>

          {bumps.length === 0 ? (
            <div className="rounded-menuzia border border-dashed border-border bg-page px-6 py-14 text-center text-[13px] text-text-subtle">
              Nenhum produto configurado ainda. Adicione produtos pela lista à direita →
            </div>
          ) : (
            <div className="space-y-2">
              {bumps.map((bump, index) => {
                const item = items.find((i) => i.id === bump.itemId)
                if (!item) return null
                const overLimit = index >= maxItems
                return (
                  <div
                    key={bump.id}
                    className={[
                      'flex items-center gap-3 rounded-menuzia border bg-white p-3 transition-opacity',
                      !bump.ativo ? 'opacity-50' : '',
                    ].join(' ')}
                  >
                    <span className="w-5 flex-shrink-0 text-center text-[12px] font-bold text-text-subtle">{index + 1}</span>
                    <ItemThumb item={item} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{item.nome}</div>
                      <div className="mt-0.5 text-[11px] text-text-subtle">{fmtBrl(item.preco)}</div>
                    </div>
                    {overLimit && (
                      <span className="flex-shrink-0 rounded-menuzia bg-warn/10 px-2 py-0.5 text-[10px] font-bold text-warn">
                        Fora do limite
                      </span>
                    )}
                    {/* Ativo toggle */}
                    <button
                      onClick={() => toggle(bump.id, bump.ativo)}
                      title={bump.ativo ? 'Desativar' : 'Ativar'}
                      className={[
                        'relative h-6 w-11 flex-shrink-0 rounded-full transition-colors',
                        bump.ativo ? 'bg-primary' : 'bg-border',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'absolute top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-transform',
                          bump.ativo ? 'translate-x-[22px]' : 'translate-x-0.5',
                        ].join(' ')}
                      />
                    </button>
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-menuzia border border-border text-xs text-text-subtle hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === bumps.length - 1}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-menuzia border border-border text-xs text-text-subtle hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => remove(bump.id)}
                      className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-menuzia border border-border bg-white text-base leading-none text-danger hover:border-danger hover:bg-danger-bg"
                    >
                      ×
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Available items to add */}
        <div>
          <h3 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-text-subtle">Adicionar produto</h3>
          <div className="mb-3 flex items-center gap-2 rounded-menuzia border border-border bg-white px-2.5 py-2">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-text-subtle">
              <path d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 10-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 119.5 5a4.5 4.5 0 010 9z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar produto…"
              className="w-full border-none bg-transparent font-sans text-[13px] text-text-main outline-none placeholder:text-text-subtle/60"
            />
          </div>
          <div className="max-h-[500px] space-y-1.5 overflow-y-auto">
            {filteredAvailable.length === 0 ? (
              <div className="py-8 text-center text-[12px] text-text-subtle">
                {search ? 'Nenhum produto encontrado.' : 'Todos os produtos já foram adicionados.'}
              </div>
            ) : (
              filteredAvailable.map((item) => (
                <button
                  key={item.id}
                  onClick={() => add(item)}
                  className="flex w-full items-center gap-2.5 rounded-menuzia border border-border bg-white p-2.5 text-left transition-colors hover:border-primary hover:bg-page"
                >
                  <ItemThumb item={item} size={34} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{item.nome}</div>
                    <div className="text-[11px] text-text-subtle">{fmtBrl(item.preco)}</div>
                  </div>
                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-menuzia bg-primary/10 text-sm font-bold text-primary">
                    +
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CardapioPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [restauranteId, setRestauranteId] = useState<string | null>(null)

  const [groups, setGroups] = useState<GrupoCardapio[]>([])
  const [items, setItems] = useState<ItemCardapio[]>([])
  const [presets, setPresets] = useState<PresetComplementos[]>([])

  const [cardapioTab, setCardapioTab] = useState<CardapioTab>('itens')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [view, setView] = useState<View>('table')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  const [form, setForm] = useState<ItemFormState>(blankForm(null))

  // State for creating a new complement group inside the item drawer
  const [creatingGrupo, setCreatingGrupo] = useState(false)
  const [newGrupoForm, setNewGrupoForm] = useState({ nome: '', obrigatorio: false, min: 0, max: 1 })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const id = await buscarRestauranteIdDoUsuario(supabase)
      if (cancelled) return
      if (!id) {
        setError('Não encontramos uma loja vinculada ao seu usuário. Confirme se você está autenticado com uma conta de administrador.')
        setLoading(false)
        return
      }
      setRestauranteId(id)
      try {
        const [gruposData, itensData, presetsData] = await Promise.all([
          listarGrupos(supabase, id),
          listarItens(supabase, id),
          listarPresets(supabase, id),
        ])
        if (cancelled) return
        setGroups(gruposData)
        setItems(itensData)
        setPresets(presetsData)
        setActiveGroup((current) => current ?? gruposData[0]?.nome ?? null)
      } catch {
        if (!cancelled) setError('Não foi possível carregar o cardápio. Verifique sua conexão com o Supabase e tente novamente.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [supabase])

  async function refreshItems() {
    if (!restauranteId) return
    const refreshed = await listarItens(supabase, restauranteId)
    setItems(refreshed)
  }

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      if (!item.grupoId) continue
      counts.set(item.grupoId, (counts.get(item.grupoId) ?? 0) + 1)
    }
    return counts
  }, [items])

  const activeGroupId = useMemo(() => groups.find((g) => g.nome === activeGroup)?.id ?? null, [groups, activeGroup])

  const visibleItems = useMemo(
    () => items.filter((item) => item.grupoId === activeGroupId && item.nome.toLowerCase().includes(search.toLowerCase())),
    [items, activeGroupId, search]
  )

  const allSelected = visibleItems.length > 0 && visibleItems.every((item) => selected.has(item.id))

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) visibleItems.forEach((item) => next.delete(item.id))
      else visibleItems.forEach((item) => next.add(item.id))
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

  function openNewItem() {
    setForm(blankForm(activeGroupId))
    setCreatingGrupo(false)
    setNewGrupoForm({ nome: '', obrigatorio: false, min: 0, max: 1 })
    setDrawer('edit')
  }

  function openEditItem(item: ItemCardapio) {
    setForm(formFromItem(item))
    setCreatingGrupo(false)
    setNewGrupoForm({ nome: '', obrigatorio: false, min: 0, max: 1 })
    setDrawer('edit')
  }

  function closeDrawer() {
    if (saving || uploading) return
    setDrawer(null)
  }

  async function handleImagePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !restauranteId) return
    setUploading(true)
    setError(null)
    try {
      const url = await enviarImagemItem(supabase, restauranteId, file)
      setForm((prev) => ({ ...prev, imagemUrl: url }))
    } catch {
      setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
    } finally {
      setUploading(false)
    }
  }

  async function saveItem() {
    if (!restauranteId || !form.nome.trim()) return
    setSaving(true)
    setError(null)
    try {
      const payload = {
        grupoId: form.grupoId,
        nome: form.nome.trim(),
        descricao: form.descricao.trim(),
        preco: parsePreco(form.preco),
        status: form.status,
        diasDisponiveis: form.diasDisponiveis,
      }
      if (form.id) {
        const updated = await atualizarItem(supabase, form.id, { ...payload, imagemUrl: form.imagemUrl })
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      } else {
        const created = await criarItem(supabase, restauranteId, payload)
        let final = created
        if (form.imagemUrl) {
          final = await atualizarItem(supabase, created.id, { ...payload, imagemUrl: form.imagemUrl })
        }
        setItems((prev) => [...prev, final])
        // Update form with the new item id so complementos can be added
        setForm((prev) => ({ ...prev, id: final.id }))
        return // keep drawer open
      }
      setDrawer(null)
    } catch {
      setError('Não foi possível salvar o item. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  async function applyBulkStatus(status: StatusItem) {
    if (selected.size === 0) return
    const ids = [...selected]
    try {
      await definirStatusEmLote(supabase, ids, status)
      setItems((prev) => prev.map((item) => (ids.includes(item.id) ? { ...item, status } : item)))
      setSelected(new Set())
      setActionsOpen(false)
    } catch {
      setError('Não foi possível atualizar o status dos itens selecionados.')
    }
  }

  async function deleteSelected() {
    if (selected.size === 0) return
    const ids = [...selected]
    try {
      await excluirItens(supabase, ids)
      setItems((prev) => prev.filter((item) => !ids.includes(item.id)))
      setSelected(new Set())
      setActionsOpen(false)
    } catch {
      setError('Não foi possível excluir os itens selecionados.')
    }
  }

  async function createCategoria() {
    if (!restauranteId || !newGroupName.trim()) return
    try {
      const group = await criarGrupo(supabase, restauranteId, newGroupName.trim(), groups.length)
      setGroups((prev) => [...prev, group])
      setActiveGroup(group.nome)
      setNewGroupName('')
      setDrawer(null)
    } catch {
      setError('Não foi possível criar a categoria.')
    }
  }

  async function importPreset(preset: PresetComplementos) {
    if (!form.id) {
      setError('Salve o item antes de importar um grupo de complementos.')
      return
    }
    try {
      const posicao = currentItem?.grupos.length ?? 0
      await importarPresetNoItem(supabase, form.id, preset, posicao)
      await refreshItems()
      setDrawer('edit')
    } catch {
      setError('Não foi possível importar o grupo de complementos.')
    }
  }

  async function createGrupoNoItem() {
    if (!form.id || !newGrupoForm.nome.trim()) return
    const posicao = currentItem?.grupos.length ?? 0
    try {
      await criarGrupoItem(
        supabase,
        form.id,
        newGrupoForm.nome.trim(),
        newGrupoForm.obrigatorio,
        newGrupoForm.min,
        Math.max(newGrupoForm.max, 1),
        posicao
      )
      setCreatingGrupo(false)
      setNewGrupoForm({ nome: '', obrigatorio: false, min: 0, max: 1 })
      await refreshItems()
    } catch {
      setError('Não foi possível criar o grupo de complementos.')
    }
  }

  async function removeComplementoFromItem(complementoId: string) {
    try {
      await removerComplemento(supabase, complementoId)
      setItems((prev) =>
        prev.map((item) =>
          item.id === form.id ? { ...item, complementos: item.complementos.filter((c) => c.id !== complementoId) } : item
        )
      )
    } catch {
      setError('Não foi possível remover o complemento.')
    }
  }

  const currentItem = form.id ? items.find((item) => item.id === form.id) ?? null : null

  if (loading) {
    return (
      <>
        <TopBar title="Gestor de Cardápio" breadcrumb="Cardápio" />
        <div className="flex flex-1 items-center justify-center p-5 text-sm text-text-subtle">Carregando cardápio…</div>
      </>
    )
  }

  if (error && !restauranteId) {
    return (
      <>
        <TopBar title="Gestor de Cardápio" breadcrumb="Cardápio" />
        <div className="flex flex-1 items-center justify-center p-5">
          <div className="max-w-md rounded-menuzia border border-border bg-white p-5 text-center">
            <h2 className="text-sm font-bold text-danger">Não foi possível carregar o cardápio</h2>
            <p className="mt-2 text-[13px] leading-relaxed text-text-subtle">{error}</p>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar
        title="Gestor de Cardápio"
        breadcrumb={
          cardapioTab === 'itens'
            ? `Cardápio › ${activeGroup ?? 'Sem categorias'}`
            : cardapioTab === 'complementos'
            ? 'Cardápio › Grupos de complementos'
            : 'Cardápio › Order Bump'
        }
      />

      {/* Tab bar */}
      <div className="flex flex-shrink-0 gap-0.5 border-b border-border bg-main px-5 pt-3.5">
        {([
          { id: 'itens' as CardapioTab, label: 'Itens do cardápio' },
          { id: 'complementos' as CardapioTab, label: 'Grupos de complementos' },
          { id: 'orderbump' as CardapioTab, label: 'Order Bump' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setCardapioTab(t.id)}
            className={[
              'rounded-t-menuzia border-b-2 px-4 pb-3 pt-2 text-[13px] font-semibold transition-colors',
              cardapioTab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-subtle hover:text-text-main',
            ].join(' ')}
          >
            {t.label}
            {t.id === 'complementos' && presets.length > 0 && (
              <span className="ml-2 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-700">{presets.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Itens do cardápio ── */}
      <div className={cardapioTab !== 'itens' ? 'hidden' : 'flex flex-1 flex-col gap-4 overflow-hidden p-5'}>
        {error && (
          <div className="rounded-menuzia border border-danger bg-danger-bg px-3.5 py-2.5 text-[13px] font-medium text-danger">{error}</div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="primary" onClick={openNewItem} disabled={!activeGroupId}>
            + Novo item
          </Button>
          <Button variant="outline" onClick={() => setDrawer('categoria')}>
            + Categoria
          </Button>
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
            <button type="button" onClick={() => setView('table')} title="Tabela"
              className={`flex items-center px-2.5 py-1.5 ${view === 'table' ? 'bg-primary text-white' : 'text-text-subtle'}`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z" /></svg>
            </button>
            <button type="button" onClick={() => setView('grid')} title="Grade"
              className={`flex items-center px-2.5 py-1.5 ${view === 'grid' ? 'bg-primary text-white' : 'text-text-subtle'}`}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" /></svg>
            </button>
          </div>
          <div className="relative">
            <Button variant="secondary" onClick={() => setActionsOpen((open) => !open)} disabled={selected.size === 0}>
              Ação
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M7 10l5 5 5-5z" /></svg>
            </Button>
            {actionsOpen && (
              <div className="absolute right-0 top-[calc(100%+4px)] z-40 min-w-[160px] rounded-menuzia border border-border bg-white p-1 shadow-xl">
                <button onClick={() => applyBulkStatus('esgotado')} className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page">Esgotar</button>
                <button onClick={() => applyBulkStatus('pausado')} className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page">Pausar</button>
                <button onClick={deleteSelected} className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-danger hover:bg-page">Excluir</button>
              </div>
            )}
          </div>
        </div>

        {/* Layout: categories + content */}
        <div className="flex flex-1 gap-4 overflow-hidden">
          {/* Categories panel */}
          <aside className="flex w-[230px] flex-shrink-0 flex-col overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="border-b border-border px-3.5 py-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide text-text-subtle">Categorias</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {groups.length === 0 && (
                <div className="px-2 py-6 text-center text-xs text-text-subtle">Nenhuma categoria cadastrada ainda.</div>
              )}
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setActiveGroup(group.nome)}
                  className={[
                    'flex w-full items-center justify-between rounded-menuzia border-l-[3px] px-3 py-2.5 text-left text-sm font-medium transition-colors',
                    group.nome === activeGroup
                      ? 'border-l-primary bg-[#ECFEFF] font-semibold text-primary-dark'
                      : 'border-l-transparent text-text-main hover:bg-page',
                  ].join(' ')}
                >
                  <span>{group.nome}</span>
                  <span className={['rounded-full px-2 py-0.5 text-[11px] font-bold', group.nome === activeGroup ? 'bg-white text-primary-dark' : 'bg-page text-text-subtle'].join(' ')}>
                    {groupCounts.get(group.id) ?? 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex gap-1.5 border-t border-border p-2.5">
              <Button variant="primary" className="flex-1" onClick={() => setDrawer('categoria')}>
                + Categoria
              </Button>
            </div>
          </aside>

          {/* Content panel */}
          <section className="flex flex-1 flex-col overflow-hidden rounded-menuzia border border-border bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-4 py-3">
              <div className="text-[13px] text-text-subtle">
                Total de <b className="text-text-main">{visibleItems.length} itens</b> em <b className="text-text-main">{activeGroup ?? '—'}</b>
              </div>
              {selected.size > 0 && (
                <div className="flex items-center gap-3 rounded-menuzia bg-sidebar-bg px-3.5 py-2 text-white">
                  <span><b className="text-primary">{selected.size}</b> selecionado(s)</span>
                  <Button variant="secondary" className="bg-[#374151] text-white hover:bg-[#4B5563]" onClick={() => applyBulkStatus('esgotado')}>Esgotar</Button>
                  <Button variant="secondary" className="bg-[#374151] text-white hover:bg-[#4B5563]" onClick={() => applyBulkStatus('pausado')}>Pausar</Button>
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {!activeGroupId && (
                <div className="flex h-full items-center justify-center p-8 text-center text-sm text-text-subtle">
                  Crie uma categoria para começar a cadastrar itens do cardápio.
                </div>
              )}
              {activeGroupId && visibleItems.length === 0 && (
                <div className="flex h-full items-center justify-center p-8 text-center text-sm text-text-subtle">
                  Nenhum item nesta categoria ainda. Use "+ Novo item" para cadastrar o primeiro.
                </div>
              )}
              {activeGroupId && visibleItems.length > 0 && view === 'table' && (
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky top-0 w-9 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5">
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={allSelected} onChange={toggleAll} />
                      </th>
                      <th className="sticky top-0 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Item</th>
                      <th className="sticky top-0 w-[120px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Preço</th>
                      <th className="sticky top-0 w-[230px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Disponibilidade</th>
                      <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Status</th>
                      <th className="sticky top-0 w-[90px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <tr key={item.id} className={selected.has(item.id) ? 'bg-[#ECFEFF]' : 'hover:bg-[#F9FAFB]'}>
                        <td className="border-b border-border px-3.5 py-3">
                          <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(item.id)} onChange={() => toggleRow(item.id)} />
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <ItemThumb item={item} />
                            <div>
                              <div className="text-[13px] font-semibold">{item.nome}</div>
                              <div className="mt-0.5 text-[11px] text-text-subtle">{item.descricao}</div>
                            </div>
                          </div>
                        </td>
                        <td className="border-b border-border px-3.5 py-3 text-[13px] font-semibold">
                          R$ {item.preco.toFixed(2).replace('.', ',')}
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <DayToggles
                            days={item.diasDisponiveis}
                            onChange={(days) => {
                              setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, diasDisponiveis: days } : i)))
                              atualizarItem(supabase, item.id, {
                                grupoId: item.grupoId, nome: item.nome, descricao: item.descricao,
                                preco: item.preco, status: item.status, diasDisponiveis: days, imagemUrl: item.imagemUrl,
                              }).catch(() => setError('Não foi possível salvar a disponibilidade.'))
                            }}
                          />
                        </td>
                        <td className="border-b border-border px-3.5 py-3"><StatusBadge status={item.status} /></td>
                        <td className="border-b border-border px-3.5 py-3">
                          <button onClick={() => openEditItem(item)} title="Editar"
                            className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary">
                            <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
                              <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {activeGroupId && visibleItems.length > 0 && view === 'grid' && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5 p-4">
                  {visibleItems.map((item) => (
                    <div key={item.id} className="flex flex-col overflow-hidden rounded-menuzia border border-border bg-white">
                      <div className="relative flex h-[120px] items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                        {item.imagemUrl
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={item.imagemUrl} alt={item.nome} className="h-full w-full object-cover" />
                          : <svg viewBox="0 0 24 24" className="h-[46px] w-[46px] fill-text-subtle/50"><path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" /></svg>
                        }
                        {item.status !== 'disponivel' && <div className="absolute left-2 top-2"><StatusBadge status={item.status} /></div>}
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5 p-3">
                        <div className="text-sm font-semibold">{item.nome}</div>
                        <div className="flex-1 text-xs leading-relaxed text-text-subtle">{item.descricao}</div>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="rounded-menuzia bg-price-bg px-2 py-1 text-[13px] font-bold text-price-text">
                            R$ {item.preco.toFixed(2).replace('.', ',')}
                          </span>
                          <button onClick={() => openEditItem(item)}
                            className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary">
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

      {/* ── Tab: Grupos de complementos ── */}
      <div className={cardapioTab !== 'complementos' ? 'hidden' : 'flex flex-1 flex-col overflow-hidden'}>
        {restauranteId && (
          <GruposComplementos restauranteId={restauranteId} presets={presets} setPresets={setPresets} />
        )}
      </div>

      {/* ── Tab: Order Bump ── */}
      <div className={cardapioTab !== 'orderbump' ? 'hidden' : 'flex flex-1 flex-col overflow-hidden'}>
        {restauranteId && <OrderBumpTab restauranteId={restauranteId} items={items} />}
      </div>

      {/* Overlay + drawers */}
      {drawer && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={closeDrawer} />}

      {/* Drawer: nova categoria */}
      <aside className={['fixed right-0 top-0 z-[60] flex h-screen w-[380px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300', drawer === 'categoria' ? 'translate-x-0' : 'translate-x-full'].join(' ')}>
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Nova categoria</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Ex.: Lanches, Combos, Bebidas, Sobremesas.</p>
          </div>
          <button onClick={closeDrawer} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome da categoria</div>
          <input
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && createCategoria()}
            placeholder="Ex.: Lanches"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary"
          />
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={closeDrawer}>Cancelar</Button>
          <Button variant="primary" className="flex-1" onClick={createCategoria} disabled={!newGroupName.trim()}>Criar categoria</Button>
        </div>
      </aside>

      {/* Drawer: importar grupo de complementos */}
      <aside className={['fixed right-0 top-0 z-[60] flex h-screen w-[420px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300', drawer === 'preset' ? 'translate-x-0' : 'translate-x-full'].join(' ')}>
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Importar grupo de complementos</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Selecione um grupo salvo para adicionar a este produto com as regras já configuradas.</p>
          </div>
          <button onClick={() => setDrawer('edit')} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          {presets.length === 0 && (
            <div className="py-10 text-center text-sm text-text-subtle">
              Nenhum grupo criado ainda. Vá para a aba{' '}
              <button
                onClick={() => { setDrawer(null); setCardapioTab('complementos') }}
                className="font-semibold text-purple-600 underline hover:text-purple-700"
              >
                Grupos de complementos
              </button>{' '}
              para criar o primeiro.
            </div>
          )}
          {presets.map((preset) => (
            <div key={preset.id} className="mb-3 overflow-hidden rounded-menuzia border border-purple-200 bg-purple-50/40">
              <div className="flex items-center gap-3 border-b border-purple-100 px-3.5 py-3">
                <div className="flex h-[36px] w-[36px] items-center justify-center rounded-menuzia bg-white shadow-sm">
                  <FoodIcon name={preset.nome} size={26} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="truncate text-sm font-semibold text-purple-900">{preset.nome}</h4>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className={`text-[10px] font-bold ${preset.obrigatorio ? 'text-danger' : 'text-text-subtle'}`}>
                      {preset.obrigatorio ? 'Obrigatório' : 'Opcional'}
                    </span>
                    <span className="text-[10px] text-text-subtle">· {ruleHint(preset)}</span>
                  </div>
                </div>
                <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-bold text-purple-700">{preset.itens.length} iten{preset.itens.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
                {preset.itens.map((entry) => (
                  <span key={entry.id} className="rounded-menuzia bg-purple-100 px-2 py-1 text-[11px] font-medium text-purple-700">
                    {entry.nome}{entry.preco === 0 ? ' · Grátis' : ''}
                  </span>
                ))}
              </div>
              <div className="px-3.5 pb-3.5">
                <button
                  onClick={() => importPreset(preset)}
                  className="w-full rounded-menuzia bg-purple-600 py-2 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-purple-700"
                >
                  Importar com 1 clique
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={() => setDrawer('edit')}>Voltar</Button>
        </div>
      </aside>

      {/* Drawer: editar/criar item */}
      <aside className={['fixed right-0 top-0 z-[60] flex h-screen w-[420px] max-w-[92vw] flex-col bg-white shadow-2xl transition-transform duration-300', drawer === 'edit' ? 'translate-x-0' : 'translate-x-full'].join(' ')}>
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">{form.id ? 'Editar item' : 'Novo item'}</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{form.id ? form.nome : `Novo item em ${activeGroup ?? ''}`}</p>
          </div>
          <button onClick={closeDrawer} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Foto do item</div>
          <div className="mb-4 flex items-center gap-3">
            {form.imagemUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={form.imagemUrl} alt={form.nome || 'Foto do item'} className="h-[64px] w-[64px] rounded-menuzia object-cover" />
              : <div className="flex h-[64px] w-[64px] items-center justify-center rounded-menuzia bg-gradient-to-br from-slate-100 to-slate-200">
                  <svg viewBox="0 0 24 24" className="h-7 w-7 fill-text-subtle/60"><path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" /></svg>
                </div>
            }
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Enviando…' : form.imagemUrl ? 'Trocar foto' : 'Enviar foto'}
            </Button>
          </div>

          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome do item</div>
          <input value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
            placeholder="Ex.: Burger Duplo Artesanal"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Descrição</div>
          <input value={form.descricao} onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
            placeholder="Ex.: Pão brioche, 2 hambúrgueres 120g, cheddar e molho da casa"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />

          <div className="mt-4 flex gap-3">
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Preço (R$)</div>
              <input value={form.preco} onChange={(e) => setForm((prev) => ({ ...prev, preco: e.target.value }))}
                placeholder="32,90"
                className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />
            </div>
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Categoria</div>
              <select value={form.grupoId ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, grupoId: e.target.value || null }))}
                className="w-full rounded-menuzia border border-border bg-white px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary">
                <option value="">Sem categoria</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Status</div>
              <select value={form.status} onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as StatusItem }))}
                className="w-full rounded-menuzia border border-border bg-white px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary">
                {STATUS_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Disponibilidade</div>
              <DayToggles days={form.diasDisponiveis} onChange={(days) => setForm((prev) => ({ ...prev, diasDisponiveis: days }))} />
            </div>
          </div>

          {/* Complementos section (only after item is saved) */}
          {form.id && (
            <>
              <div className="mt-6 flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Grupos de complementos</div>
                <button onClick={() => setDrawer('preset')} className="px-1.5 py-1 text-[11px] font-semibold text-purple-600 hover:text-purple-800">
                  Importar grupo
                </button>
              </div>
              <p className="mb-3 mt-1 text-[11px] text-text-subtle">
                Importe um grupo salvo ou crie um novo. Cada grupo pode ser obrigatório ou opcional, com regras de seleção mínima/máxima.
              </p>

              {/* Existing complement groups */}
              {(currentItem?.grupos ?? []).map((grupo) => (
                <GrupoItemCard
                  key={grupo.id}
                  grupo={grupo}
                  itemId={form.id!}
                  onRefresh={refreshItems}
                />
              ))}

              {/* Legacy loose complementos (old flat data) */}
              {(currentItem?.complementos ?? []).length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[11px] text-text-subtle">Adicionais avulsos</div>
                  {(currentItem?.complementos ?? []).map((comp) => (
                    <div key={comp.id} className="mb-1.5 flex items-center gap-2.5 rounded-menuzia border border-border px-2.5 py-2">
                      <span className="flex-1 text-[13px] font-medium">{comp.nome}</span>
                      {comp.preco > 0
                        ? <span className="text-xs font-semibold text-price-text">+ R$ {comp.preco.toFixed(2).replace('.', ',')}</span>
                        : <span className="rounded-menuzia bg-price-bg px-1.5 py-0.5 text-[11px] font-bold text-price-text">Grátis</span>
                      }
                      <button onClick={() => removeComplementoFromItem(comp.id)}
                        className="flex h-[26px] w-[26px] items-center justify-center rounded-menuzia bg-danger-bg text-[15px] text-danger hover:bg-[#FCA5A5] hover:text-white">
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state */}
              {(currentItem?.grupos ?? []).length === 0 && (currentItem?.complementos ?? []).length === 0 && (
                <div className="mb-3 rounded-menuzia border border-dashed border-border p-3 text-center text-[11px] text-text-subtle">
                  Nenhum grupo cadastrado. Importe um grupo salvo ou crie um novo abaixo.
                </div>
              )}

              {/* Create new group inline */}
              {creatingGrupo ? (
                <div className="mb-2 rounded-menuzia border border-border bg-page p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Novo grupo</div>
                  <input
                    value={newGrupoForm.nome}
                    onChange={(e) => setNewGrupoForm((prev) => ({ ...prev, nome: e.target.value }))}
                    placeholder="Nome do grupo (ex: Ponto da carne)"
                    className="w-full rounded-menuzia border border-border px-2.5 py-2 text-[13px] outline-none focus:border-primary"
                    autoFocus
                  />
                  <div className="mt-2.5 flex flex-wrap items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium">
                      <input
                        type="checkbox"
                        checked={newGrupoForm.obrigatorio}
                        onChange={(e) => setNewGrupoForm((prev) => ({ ...prev, obrigatorio: e.target.checked }))}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      Obrigatório
                    </label>
                    {newGrupoForm.obrigatorio && (
                      <label className="flex items-center gap-1.5 text-[12px] text-text-subtle">
                        Mín
                        <input
                          type="number"
                          min="0"
                          max={newGrupoForm.max}
                          value={newGrupoForm.min}
                          onChange={(e) => setNewGrupoForm((prev) => ({ ...prev, min: Math.max(0, Number(e.target.value)) }))}
                          className="w-14 rounded-menuzia border border-border px-2 py-1 text-center text-[12px] outline-none focus:border-primary"
                        />
                      </label>
                    )}
                    <label className="flex items-center gap-1.5 text-[12px] text-text-subtle">
                      Máx
                      <input
                        type="number"
                        min="1"
                        value={newGrupoForm.max}
                        onChange={(e) => setNewGrupoForm((prev) => ({ ...prev, max: Math.max(1, Number(e.target.value)) }))}
                        className="w-14 rounded-menuzia border border-border px-2 py-1 text-center text-[12px] outline-none focus:border-primary"
                      />
                    </label>
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button
                      onClick={createGrupoNoItem}
                      disabled={!newGrupoForm.nome.trim()}
                      className="rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-50"
                    >
                      Criar grupo
                    </button>
                    <button
                      onClick={() => { setCreatingGrupo(false); setNewGrupoForm({ nome: '', obrigatorio: false, min: 0, max: 1 }) }}
                      className="rounded-menuzia border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-page"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCreatingGrupo(true)}
                  className="w-full rounded-menuzia border border-dashed border-border bg-white py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle transition-colors hover:border-primary hover:text-primary"
                >
                  + Novo grupo de complementos
                </button>
              )}
            </>
          )}
          {!form.id && (
            <p className="mt-5 rounded-menuzia border border-dashed border-border p-3 text-center text-xs text-text-subtle">
              Salve o item para poder cadastrar grupos de complementos e importar grupos.
            </p>
          )}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={closeDrawer} disabled={saving}>Cancelar</Button>
          <Button variant="primary" className="flex-1" onClick={saveItem} disabled={saving || !form.nome.trim()}>
            {saving ? 'Salvando…' : form.id ? 'Salvar item' : 'Criar item'}
          </Button>
        </div>
      </aside>
    </>
  )
}
