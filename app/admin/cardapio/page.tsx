'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  adicionarComplemento,
  adicionarItemPreset,
  adicionarOrderBump,
  atualizarComplemento,
  atualizarGrupo,
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
  criarTamanho,
  definirStatusEmLote,
  enviarImagemItem,
  excluirItens,
  importarPresetNoItem,
  listarGrupos,
  listarItens,
  listarOrderBumps,
  listarPresets,
  removerComplemento,
  removerGrupo,
  reordenarGrupos,
  removerGrupoItem,
  removerItemPreset,
  removerOrderBump,
  removerPreset,
  removerTamanho,
  renomearPreset,
  reordenarOrderBumps,
  toggleOrderBumpAtivo,
  atualizarTamanho,
  type GrupoCardapio,
  type GrupoItemComplementos,
  type ItemCardapio,
  type OrderBumpEntry,
  type PresetComplementos,
  type StatusItem,
  type TamanhoItem,
  type TipoItem,
  type TagItem,
  TAGS_ITEM,
  type PizzaSabor,
  criarSabor,
  atualizarSabor,
  removerSabor,
  definirPrecoSabor,
} from '@/lib/queries/cardapio'
import {
  listarTamanhosPadraoPizza,
  criarTamanhoPadraoPizza,
  atualizarTamanhoPadraoPizza,
  removerTamanhoPadraoPizza,
  listarTamanhosPadraoMarmita,
  criarTamanhoPadraoMarmita,
  atualizarTamanhoPadraoMarmita,
  removerTamanhoPadraoMarmita,
  listarBordasPizza,
  criarBordaPizza,
  atualizarBordaPizza,
  removerBordaPizza,
  listarMassasPizza,
  criarMassaPizza,
  atualizarMassaPizza,
  removerMassaPizza,
  type TamanhoPadraoPizza,
  type TamanhoPadraoMarmita,
  type BordaPizza,
  type MassaPizza,
} from '@/lib/queries/pizza'

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
type CardapioTab = 'itens' | 'complementos' | 'tamanhos' | 'orderbump'
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
  promocaoPreco: string
  maisVendido: boolean
  tag: TagItem | null
  tipoItem: TipoItem
}

const TIPO_ITEM_OPTIONS: { value: TipoItem; label: string }[] = [
  { value: 'simples', label: 'Simples (lanche, bebida, etc.)' },
  { value: 'pizza', label: 'Pizza (sabores + tamanho)' },
  { value: 'marmita', label: 'Marmita (tamanhos com peso)' },
]

// ─── Utilities ────────────────────────────────────────────────────────────────

function blankForm(grupoId: string | null): ItemFormState {
  return {
    id: null, grupoId, nome: '', descricao: '', preco: '', status: 'disponivel', diasDisponiveis: ALL_DAYS, imagemUrl: null,
    promocaoPreco: '', maisVendido: false, tag: null, tipoItem: 'simples',
  }
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
    promocaoPreco: item.promocaoPreco !== null ? item.promocaoPreco.toFixed(2).replace('.', ',') : '',
    maisVendido: item.maisVendido,
    tag: item.tag,
    tipoItem: item.tipoItem,
  }
}

function parsePreco(value: string): number {
  const normalized = value.replace(/\./g, '').replace(',', '.').trim()
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Classes do modal centralizado (substitui o antigo drawer lateral). */
function modalClass(isOpen: boolean, width: string): string {
  return [
    'fixed left-1/2 top-1/2 z-[60] flex max-h-[88vh] -translate-x-1/2 -translate-y-1/2 flex-col rounded-menuzia bg-white shadow-2xl transition-all duration-200',
    width,
    isOpen ? 'scale-100 opacity-100' : 'pointer-events-none scale-95 opacity-0',
  ].join(' ')
}

function ruleHint(grupo: { obrigatorio: boolean; minEscolhas: number; maxEscolhas: number }): string {
  if (grupo.maxEscolhas === 0) {
    return grupo.obrigatorio && grupo.minEscolhas > 0
      ? `Escolha no mínimo ${grupo.minEscolhas}, sem máximo`
      : 'Escolha quantos quiser'
  }
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
              ? 'border-[#0688D4] bg-[#0688D4] text-white'
              : 'border-border bg-white text-text-subtle hover:border-[#0688D4]',
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
  restauranteId,
  onRefresh,
}: {
  grupo: GrupoItemComplementos
  itemId: string
  restauranteId: string
  onRefresh: () => Promise<void>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [editingHeader, setEditingHeader] = useState(false)
  const [nome, setNome] = useState(grupo.nome)
  const [obrigatorio, setObrigatorio] = useState(grupo.obrigatorio)
  const [minEsc, setMinEsc] = useState(grupo.minEscolhas)
  const [maxEsc, setMaxEsc] = useState(grupo.maxEscolhas)
  const [permiteQuantidade, setPermiteQuantidade] = useState(grupo.permiteQuantidade)
  const [newNome, setNewNome] = useState('')
  const [newPreco, setNewPreco] = useState('')
  const [saving, setSaving] = useState(false)

  async function saveHeader() {
    const trimmed = nome.trim() || grupo.nome
    const semMax = maxEsc === 0
    const effectiveMin = obrigatorio ? (semMax ? minEsc : Math.min(minEsc, maxEsc)) : 0
    try {
      await atualizarGrupoItem(supabase, grupo.id, trimmed, obrigatorio, effectiveMin, semMax ? 0 : Math.max(maxEsc, 1), permiteQuantidade)
      setEditingHeader(false)
      await onRefresh()
    } catch { /* silencioso */ }
  }

  function cancelEdit() {
    setNome(grupo.nome)
    setObrigatorio(grupo.obrigatorio)
    setMinEsc(grupo.minEscolhas)
    setMaxEsc(grupo.maxEscolhas)
    setPermiteQuantidade(grupo.permiteQuantidade)
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
                  max={maxEsc || undefined}
                  value={minEsc}
                  onChange={(e) => setMinEsc(Math.max(0, Number(e.target.value)))}
                  className="w-14 rounded-menuzia border border-border px-2 py-1 text-center text-[12px] outline-none focus:border-primary"
                />
              </label>
            )}
            <label className={`flex items-center gap-1.5 text-[12px] text-text-subtle ${maxEsc === 0 ? 'opacity-40' : ''}`}>
              Máx
              <input
                type="number"
                min="1"
                value={maxEsc === 0 ? '' : maxEsc}
                disabled={maxEsc === 0}
                onChange={(e) => setMaxEsc(Math.max(1, Number(e.target.value)))}
                className="w-14 rounded-menuzia border border-border px-2 py-1 text-center text-[12px] outline-none focus:border-primary disabled:bg-page"
              />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-main">
              <input
                type="checkbox"
                checked={maxEsc === 0}
                onChange={(e) => setMaxEsc(e.target.checked ? 0 : Math.max(1, grupo.maxEscolhas))}
                className="h-3.5 w-3.5 accent-primary"
              />
              Sem máximo
            </label>
          </div>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px] font-medium text-text-main">
            <input type="checkbox" checked={permiteQuantidade} onChange={(e) => setPermiteQuantidade(e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
            Permitir quantidade por opção
          </label>
          <p className="text-[11px] text-text-subtle">Na vitrine o cliente escolhe a quantidade de cada opção (− 1 +) em vez de só marcar.</p>
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
            <div className="relative h-9 w-9 flex-shrink-0">
              <label className="relative h-9 w-9 flex-shrink-0 cursor-pointer overflow-hidden rounded-menuzia border border-border bg-page block">
                {comp.imagemUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={comp.imagemUrl} alt={comp.nome} className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-[14px] text-text-subtle/50">＋</span>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    try {
                      const url = await enviarImagemItem(supabase, restauranteId, file)
                      await atualizarComplemento(supabase, comp.id, { nome: comp.nome, preco: comp.preco, imagemUrl: url })
                      await onRefresh()
                    } catch { /* silencioso */ }
                  }}
                />
              </label>
              {comp.imagemUrl && (
                <button
                  onClick={async () => {
                    try {
                      await atualizarComplemento(supabase, comp.id, { nome: comp.nome, preco: comp.preco, imagemUrl: null })
                      await onRefresh()
                    } catch { /* silencioso */ }
                  }}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold leading-none text-white shadow-sm hover:bg-[#DC2626]"
                  title="Remover foto"
                >
                  ×
                </button>
              )}
            </div>
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

const SABOR_STATUS_CYCLE: StatusItem[] = ['disponivel', 'pausado', 'esgotado']
const SABOR_STATUS_LABEL: Record<StatusItem, string> = { disponivel: 'Ativo', pausado: 'Inativo', esgotado: 'Em falta' }

/** Cabeçalho de seção do formulário de item — azul-escuro do design pedido (#1e3a8a). */
function SectionHeader({ children }: { children: string; tone?: string }) {
  return (
    <div className="-mx-4.5 mb-3 mt-5 border-y border-[#1e3a8a]/15 bg-[#1e3a8a]/5 px-4.5 py-2 text-[11px] font-bold uppercase tracking-wide text-[#1e3a8a]">
      {children}
    </div>
  )
}

function SaborCard({
  sabor,
  tamanhos,
  restauranteId,
  onRefresh,
}: {
  sabor: PizzaSabor
  tamanhos: TamanhoPadraoPizza[]
  restauranteId: string
  onRefresh: () => Promise<void>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [editingHeader, setEditingHeader] = useState(false)
  const [nome, setNome] = useState(sabor.nome)
  const [descricao, setDescricao] = useState(sabor.descricao)
  const [precoInputs, setPrecoInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(tamanhos.map((t) => [t.id, String(sabor.precos.find((p) => p.tamanhoPadraoId === t.id)?.preco ?? 0)]))
  )
  const [uploading, setUploading] = useState(false)
  const [editingPrecos, setEditingPrecos] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function saveHeader() {
    const trimmed = nome.trim() || sabor.nome
    try {
      await atualizarSabor(supabase, sabor.id, { nome: trimmed, descricao, status: sabor.status, imagemUrl: sabor.imagemUrl })
      setEditingHeader(false)
      await onRefresh()
    } catch { /* silencioso */ }
  }

  async function cycleStatus() {
    const next = SABOR_STATUS_CYCLE[(SABOR_STATUS_CYCLE.indexOf(sabor.status) + 1) % SABOR_STATUS_CYCLE.length]
    try {
      await atualizarSabor(supabase, sabor.id, { nome: sabor.nome, descricao: sabor.descricao, status: next, imagemUrl: sabor.imagemUrl })
      await onRefresh()
    } catch { /* silencioso */ }
  }

  async function removeSabor() {
    if (!confirm(`Remover o sabor "${sabor.nome}"?`)) return
    try {
      await removerSabor(supabase, sabor.id)
      await onRefresh()
    } catch { /* silencioso */ }
  }

  async function savePreco(tamanhoId: string) {
    const val = Number((precoInputs[tamanhoId] ?? '0').replace(',', '.'))
    const preco = Number.isFinite(val) && val >= 0 ? val : 0
    try {
      await definirPrecoSabor(supabase, sabor.id, tamanhoId, preco)
      await onRefresh()
    } catch { /* silencioso */ }
  }

  async function handleFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const url = await enviarImagemItem(supabase, restauranteId, file)
      await atualizarSabor(supabase, sabor.id, { nome: sabor.nome, descricao: sabor.descricao, status: sabor.status, imagemUrl: url })
      await onRefresh()
    } catch { /* silencioso */ }
    finally { setUploading(false) }
  }

  return (
    <div className="mb-3 overflow-hidden rounded-menuzia border border-border bg-white">
      <div className="flex items-center gap-2.5 border-b border-border bg-page px-3 py-2.5">
        {sabor.imagemUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={sabor.imagemUrl} alt={sabor.nome} className="h-8 w-8 flex-shrink-0 rounded-menuzia object-cover" />
          : <div className="h-8 w-8 flex-shrink-0 rounded-menuzia bg-gradient-to-br from-slate-100 to-slate-200" />
        }
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFoto} />
        <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-[11px] text-text-subtle hover:text-primary">
          {uploading ? '…' : 'Foto'}
        </button>
        {editingHeader ? (
          <input value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveHeader()}
            autoFocus className="flex-1 rounded-menuzia border border-primary px-2 py-1 text-[13px] outline-none" />
        ) : (
          <span className="flex-1 text-[13px] font-semibold text-text-main">{sabor.nome}</span>
        )}
        <button
          onClick={cycleStatus}
          className={[
            'rounded-menuzia px-1.5 py-0.5 text-[10px] font-bold',
            sabor.status === 'disponivel' ? 'bg-price-bg text-price-text' : sabor.status === 'pausado' ? 'bg-warn/10 text-warn' : 'bg-danger-bg text-danger',
          ].join(' ')}
        >
          {SABOR_STATUS_LABEL[sabor.status]}
        </button>
        {editingHeader ? (
          <button onClick={saveHeader} className="text-[11px] font-semibold text-primary hover:underline">Salvar</button>
        ) : (
          <button onClick={() => setEditingHeader(true)} className="text-[11px] text-text-subtle hover:text-primary">Editar</button>
        )}
        <button onClick={removeSabor} className="text-[11px] text-text-subtle hover:text-danger">Remover</button>
      </div>
      {editingHeader && (
        <div className="border-b border-border px-3 py-2">
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Descrição do sabor (opcional)"
            className="w-full rounded-menuzia border border-border px-2.5 py-1.5 text-[12px] outline-none focus:border-primary" />
        </div>
      )}
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Preços por tamanho</span>
          {tamanhos.length > 0 && (
            <button onClick={() => setEditingPrecos((v) => !v)} className="text-[11px] font-semibold text-[#1e3a8a] hover:underline">
              {editingPrecos ? 'Concluir' : 'Editar preços'}
            </button>
          )}
        </div>
        {tamanhos.length === 0 ? (
          <p className="text-[11px] text-text-subtle">Cadastre tamanhos de pizza na aba &ldquo;Tamanhos&rdquo; pra definir preços aqui.</p>
        ) : editingPrecos ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {tamanhos.map((t) => (
              <div key={t.id}>
                <div className="mb-1 text-[11px] font-medium text-text-subtle">{t.nome} ({t.fatias} fatias)</div>
                <div className="flex items-center gap-1">
                  <span className="text-[12px] text-text-subtle">R$</span>
                  <input
                    value={precoInputs[t.id] ?? '0'}
                    onChange={(e) => setPrecoInputs((prev) => ({ ...prev, [t.id]: e.target.value }))}
                    onBlur={() => savePreco(t.id)}
                    onKeyDown={(e) => e.key === 'Enter' && savePreco(t.id)}
                    className="w-full rounded-menuzia border border-border px-2 py-1.5 text-[13px] outline-none focus:border-primary"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tamanhos.map((t) => {
              const preco = sabor.precos.find((p) => p.tamanhoPadraoId === t.id)?.preco ?? 0
              return (
                <span key={t.id} className={['rounded-menuzia px-2 py-1 text-[12px] font-semibold', preco > 0 ? 'bg-price-bg text-price-text' : 'bg-[#fee2e2] text-[#ef4444]'].join(' ')}>
                  {t.nome}: R$ {preco.toFixed(2).replace('.', ',')}
                </span>
              )
            })}
          </div>
        )}
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
  imagemUrl: string | null
}

function PresetGroupCard({
  preset,
  restauranteId,
  onDeleted,
  onRenamed,
  onChanged,
}: {
  preset: PresetComplementos
  restauranteId: string
  onDeleted: (id: string) => void
  onRenamed: (id: string, nome: string) => void
  /** Propaga regras/itens editados pro state da página — o drawer de importar lê de lá. */
  onChanged: (id: string, patch: Partial<PresetComplementos>) => void
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [nome, setNome] = useState(preset.nome)
  const [editingNome, setEditingNome] = useState(false)
  const [obrigatorio, setObrigatorio] = useState(preset.obrigatorio)
  const [minEsc, setMinEsc] = useState(preset.minEscolhas)
  const [maxEsc, setMaxEsc] = useState(preset.maxEscolhas)
  const [permiteQuantidade, setPermiteQuantidade] = useState(preset.permiteQuantidade)
  const [items, setItems] = useState<PresetItemEdit[]>(
    preset.itens.map((i) => ({ id: i.id, nome: i.nome, preco: String(i.preco), editing: false, imagemUrl: i.imagemUrl }))
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

  /** Converte o state local de itens pro formato do preset (pro state da página). */
  function itensDe(lista: PresetItemEdit[]): PresetComplementos['itens'] {
    return lista.map((i) => {
      const val = parseFloat(i.preco.replace(',', '.'))
      return { id: i.id, nome: i.nome, preco: Number.isFinite(val) && val >= 0 ? val : 0, imagemUrl: i.imagemUrl }
    })
  }

  async function saveRules(newObrigatorio: boolean, newMin: number, newMax: number, newPermiteQuantidade?: boolean) {
    try {
      const pq = newPermiteQuantidade ?? permiteQuantidade
      await atualizarRegrasPreset(supabase, preset.id, newObrigatorio, newMin, newMax, pq)
      onChanged(preset.id, { obrigatorio: newObrigatorio, minEscolhas: newMin, maxEscolhas: newMax, permiteQuantidade: pq })
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
      const next = [...items, { id: created.id, nome: created.nome, preco: String(created.preco), editing: false, imagemUrl: created.imagemUrl }]
      setItems(next)
      onChanged(preset.id, { itens: itensDe(next) })
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
      await atualizarItemPreset(supabase, id, item.nome.trim(), preco, item.imagemUrl)
      const next = items.map((i) => (i.id === id ? { ...i, nome: item.nome.trim(), preco: String(preco), editing: false } : i))
      setItems(next)
      onChanged(preset.id, { itens: itensDe(next) })
    } catch { /* silencioso */ }
  }

  async function deleteItem(id: string) {
    try {
      await removerItemPreset(supabase, id)
      const next = items.filter((i) => i.id !== id)
      setItems(next)
      onChanged(preset.id, { itens: itensDe(next) })
    } catch { /* silencioso */ }
  }

  const hint = ruleHint({ obrigatorio, minEscolhas: minEsc, maxEscolhas: maxEsc })

  return (
    <div className="overflow-hidden rounded-menuzia border border-purple-300 bg-white shadow-sm">
      {/* Card header — roxo forte, marca visual do grupo */}
      <div className="flex items-center gap-3 border-b border-purple-800 bg-purple-700 px-4 py-3.5">
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
              className="w-full rounded-menuzia border border-purple-300 bg-white px-2.5 py-1.5 text-sm font-semibold text-purple-900 outline-none"
            />
          ) : (
            <h4 className="truncate text-[15px] font-bold text-white">{nome}</h4>
          )}
        </div>
        <span className="flex-shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold text-white">
          {items.length} iten{items.length !== 1 ? 's' : ''}
        </span>
        <button onClick={startEditNome} title="Renomear" className="flex-shrink-0 text-[11px] font-semibold text-purple-200 transition-colors hover:text-white">
          Renomear
        </button>
        <button onClick={deletePreset} title="Excluir" className="flex-shrink-0 text-[11px] font-semibold text-purple-200 transition-colors hover:text-[#FCA5A5]">
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
              max={maxEsc || undefined}
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
        <label className={`flex items-center gap-1.5 text-[12px] text-text-subtle ${maxEsc === 0 ? 'opacity-40' : ''}`}>
          Máx
          <input
            type="number"
            min="1"
            value={maxEsc === 0 ? '' : maxEsc}
            disabled={maxEsc === 0}
            onChange={(e) => {
              const v = Math.max(1, Number(e.target.value))
              setMaxEsc(v)
              saveRules(obrigatorio, minEsc, v)
            }}
            className="w-14 rounded-menuzia border border-purple-200 px-2 py-1 text-center text-[12px] outline-none focus:border-purple-400 disabled:bg-purple-50"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-medium text-text-main">
          <input
            type="checkbox"
            checked={maxEsc === 0}
            onChange={(e) => {
              const v = e.target.checked ? 0 : Math.max(1, preset.maxEscolhas)
              setMaxEsc(v)
              saveRules(obrigatorio, minEsc, v)
            }}
            className="h-3.5 w-3.5 accent-purple-600"
          />
          Sem máximo
        </label>
        <span className="ml-auto text-[11px] italic text-text-subtle">{hint}</span>
        <label className="mt-1 flex w-full cursor-pointer items-center gap-2 text-[12px] font-medium text-text-main">
          <input
            type="checkbox"
            checked={permiteQuantidade}
            onChange={(e) => {
              const v = e.target.checked
              setPermiteQuantidade(v)
              saveRules(obrigatorio, minEsc, maxEsc, v)
            }}
            className="h-3.5 w-3.5 accent-primary"
          />
          Permitir quantidade por opção
        </label>
        <p className="-mt-1 w-full rounded-menuzia bg-[#E0F2FE] px-2.5 py-1.5 text-[11px] font-medium leading-relaxed text-[#1e3a8a]">
          Na vitrine o cliente escolhe a quantidade de cada opção (− 1 +) em vez de só marcar.
        </p>
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
              <div className="relative h-9 w-9 flex-shrink-0">
                <label className="relative h-9 w-9 flex-shrink-0 cursor-pointer overflow-hidden rounded-menuzia border border-purple-200 bg-white block">
                  {item.imagemUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imagemUrl} alt={item.nome} className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[14px] text-text-subtle/50">＋</span>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0]
                      if (!file) return
                      const val = parseFloat(item.preco.replace(',', '.'))
                      const preco = Number.isFinite(val) && val >= 0 ? val : 0
                      try {
                        const url = await enviarImagemItem(supabase, restauranteId, file)
                        await atualizarItemPreset(supabase, item.id, item.nome.trim(), preco, url)
                        const next = items.map((i) => (i.id === item.id ? { ...i, imagemUrl: url } : i))
                        setItems(next)
                        onChanged(preset.id, { itens: itensDe(next) })
                      } catch { /* silencioso */ }
                    }}
                  />
                </label>
                {item.imagemUrl && (
                  <button
                    onClick={async () => {
                      const val = parseFloat(item.preco.replace(',', '.'))
                      const preco = Number.isFinite(val) && val >= 0 ? val : 0
                      try {
                        await atualizarItemPreset(supabase, item.id, item.nome.trim(), preco, null)
                        const next = items.map((i) => (i.id === item.id ? { ...i, imagemUrl: null } : i))
                        setItems(next)
                        onChanged(preset.id, { itens: itensDe(next) })
                      } catch { /* silencioso */ }
                    }}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold leading-none text-white shadow-sm hover:bg-[#DC2626]"
                    title="Remover foto"
                  >
                    ×
                  </button>
                )}
              </div>
              <span className="flex-1 text-[13px] font-medium text-text-main">{item.nome}</span>
              {Number(item.preco) > 0 ? (
                <span className="rounded-menuzia bg-price-bg px-1.5 py-0.5 tabular-nums text-[12px] font-bold text-price-text">+ R$ {Number(item.preco).toFixed(2).replace('.', ',')}</span>
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
      <div className="mb-5 flex flex-col gap-2">
        <h2 className="text-[15px] font-bold text-text-main">Grupos de complementos</h2>
        <p className="max-w-3xl rounded-menuzia bg-[#E0F2FE] px-3 py-2 text-[12px] font-medium leading-relaxed text-[#1e3a8a]">
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
            restauranteId={restauranteId}
            onDeleted={(id) => setPresets((prev) => prev.filter((p) => p.id !== id))}
            onRenamed={(id, nome) => setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, nome } : p)))}
            onChanged={(id, patch) => setPresets((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Tamanhos Tab (catálogos da loja: tamanhos de pizza/marmita, bordas, massas) ──

interface LinhaCatalogo {
  id: string
  nome: string
  extra: string
}

function ListaCatalogo({
  titulo,
  hint,
  itens,
  extraLabel,
  extraPlaceholder,
  extraType,
  extraIsPrice = false,
  formatExtra,
  onAdd,
  onUpdate,
  onRemove,
}: {
  titulo: string
  hint: string
  itens: LinhaCatalogo[]
  extraLabel: string
  extraPlaceholder: string
  extraType: 'text' | 'number'
  /** Quando o valor extra é um preço, exibe no verde padrão de valores. */
  extraIsPrice?: boolean
  formatExtra: (extra: string) => string
  onAdd: (nome: string, extra: string) => Promise<void>
  onUpdate: (id: string, nome: string, extra: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editExtra, setEditExtra] = useState('')
  const [newNome, setNewNome] = useState('')
  const [newExtra, setNewExtra] = useState('')
  const [busy, setBusy] = useState(false)

  function startEdit(linha: LinhaCatalogo) {
    setEditingId(linha.id)
    setEditNome(linha.nome)
    setEditExtra(linha.extra)
  }

  async function saveEdit() {
    if (!editingId || !editNome.trim()) return
    setBusy(true)
    try {
      await onUpdate(editingId, editNome.trim(), editExtra)
      setEditingId(null)
    } finally {
      setBusy(false)
    }
  }

  async function add() {
    if (!newNome.trim()) return
    setBusy(true)
    try {
      await onAdd(newNome.trim(), newExtra)
      setNewNome('')
      setNewExtra('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      {/* Cabeçalho da seção — título forte + observação em azul */}
      <div className="-mx-4.5 -mt-4.5 mb-3 rounded-t-menuzia border-b border-[#1e3a8a]/10 bg-[#1e3a8a] px-4.5 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-white">{titulo}</h3>
          <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold text-white">
            {itens.length} salvo{itens.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
      <p className="mb-3 rounded-menuzia bg-[#E0F2FE] px-3 py-2 text-[12px] font-medium leading-relaxed text-[#1e3a8a]">{hint}</p>

      {/* Lista do que já foi definido */}
      {itens.length === 0 && (
        <div className="mb-3 rounded-menuzia border border-dashed border-[#1e3a8a]/25 bg-[#EFF6FF] px-4 py-6 text-center text-[12px] font-medium text-[#1e3a8a]">
          Nada definido ainda — preencha os campos abaixo e clique em <strong>Adicionar</strong>.
        </div>
      )}
      <div className="mb-3 flex flex-col gap-1.5">
        {itens.map((linha) =>
          editingId === linha.id ? (
            <div key={linha.id} className="flex items-center gap-2 rounded-menuzia border border-[#1e3a8a]/30 bg-[#EFF6FF] px-3 py-2">
              <input
                value={editNome}
                onChange={(e) => setEditNome(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                autoFocus
                className="min-w-0 flex-1 rounded-menuzia border border-[#1e3a8a]/30 bg-white px-2.5 py-1.5 text-sm text-[#1e3a8a] outline-none focus:border-[#1e3a8a]"
              />
              <input
                type={extraType}
                value={editExtra}
                onChange={(e) => setEditExtra(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                placeholder={extraPlaceholder}
                className="w-24 rounded-menuzia border border-[#1e3a8a]/30 bg-white px-2.5 py-1.5 text-right text-sm text-[#1e3a8a] outline-none focus:border-[#1e3a8a]"
              />
              <button onClick={saveEdit} disabled={busy}
                className="rounded-menuzia bg-[#1e3a8a] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50">
                Salvar
              </button>
              <button onClick={() => setEditingId(null)} className="text-[12px] text-text-subtle hover:text-text-main">Cancelar</button>
            </div>
          ) : (
            <div key={linha.id} className="group flex items-center gap-2.5 rounded-menuzia border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 transition-colors hover:border-[#1e3a8a]/40">
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[#1e3a8a]">{linha.nome}</span>
              {extraIsPrice ? (
                <span className="rounded-menuzia bg-price-bg px-2 py-0.5 tabular-nums text-[12px] font-bold text-price-text">{formatExtra(linha.extra)}</span>
              ) : (
                <span className="rounded-menuzia bg-[#DBEAFE] px-2 py-0.5 tabular-nums text-[12px] font-bold text-[#1e3a8a]">{formatExtra(linha.extra)}</span>
              )}
              <button onClick={() => startEdit(linha)}
                className="rounded-menuzia border border-[#1e3a8a]/25 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#1e3a8a] transition-colors hover:bg-[#1e3a8a] hover:text-white">
                Editar
              </button>
              <button onClick={() => onRemove(linha.id)}
                className="rounded-menuzia bg-[#fee2e2] px-2 py-1 text-[11px] font-semibold text-[#ef4444] transition-colors hover:bg-[#ef4444] hover:text-white">
                ✕
              </button>
            </div>
          )
        )}
      </div>

      {/* Adicionar novo */}
      <div className="rounded-menuzia border border-border bg-page p-2.5">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Adicionar {titulo.toLowerCase().replace(/s$/, '').split(' de ')[0]}</div>
        <div className="flex items-center gap-2">
          <input value={newNome} onChange={(e) => setNewNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="Nome (ex: Grande)" className="min-w-0 flex-1 rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-sm outline-none focus:border-primary" />
          <input type={extraType} value={newExtra} onChange={(e) => setNewExtra(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder={extraPlaceholder} className="w-24 rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-right text-sm outline-none focus:border-primary" />
          <Button variant="primary" onClick={add} disabled={busy || !newNome.trim()}>+ Adicionar</Button>
        </div>
        <p className="mt-1.5 text-[11px] text-text-subtle">{extraLabel} fica no campo da direita. Aperte Enter ou clique em Adicionar pra salvar.</p>
      </div>
    </Card>
  )
}

function TamanhosTab({
  restauranteId,
  tamanhosPizza,
  setTamanhosPizza,
  tamanhosMarmita,
  setTamanhosMarmita,
}: {
  restauranteId: string
  // Catálogos vivem no state da página: o wizard de cadastro de item lê de lá,
  // então mudanças feitas aqui aparecem no cadastro sem recarregar.
  tamanhosPizza: TamanhoPadraoPizza[]
  setTamanhosPizza: React.Dispatch<React.SetStateAction<TamanhoPadraoPizza[]>>
  tamanhosMarmita: TamanhoPadraoMarmita[]
  setTamanhosMarmita: React.Dispatch<React.SetStateAction<TamanhoPadraoMarmita[]>>
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [bordas, setBordas] = useState<BordaPizza[]>([])
  const [massas, setMassas] = useState<MassaPizza[]>([])

  useEffect(() => {
    if (loaded) return
    Promise.all([
      listarBordasPizza(supabase, restauranteId),
      listarMassasPizza(supabase, restauranteId),
    ]).then(([b, ma]) => {
      setBordas(b)
      setMassas(ma)
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  if (!loaded) {
    return <div className="flex flex-1 items-center justify-center text-sm text-text-subtle">Carregando…</div>
  }

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="mb-5">
        <h2 className="text-[15px] font-bold text-text-main">Tamanhos</h2>
        <p className="mt-1.5 max-w-2xl rounded-menuzia bg-[#E0F2FE] px-3 py-2 text-[12px] font-medium leading-relaxed text-[#1e3a8a]">
          Defina aqui o que significa Pequena/Média/Grande na sua loja — cada item de pizza ou marmita reaproveita
          esses tamanhos no cadastro. Bordas e massas cadastradas aqui ficam disponíveis em todas as pizzas automaticamente.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <ListaCatalogo
          titulo="Tamanhos de pizza"
          hint='Ex.: "Pequena" com 4 fatias, "Grande" com 8 fatias. Cada sabor define o preço para cada um desses tamanhos.'
          itens={tamanhosPizza.map((t) => ({ id: t.id, nome: t.nome, extra: String(t.fatias) }))}
          extraLabel="Fatias"
          extraPlaceholder="Ex: 8"
          extraType="number"
          formatExtra={(e) => `${e} fatias`}
          onAdd={async (nome, extra) => {
            const novo = await criarTamanhoPadraoPizza(supabase, restauranteId, nome, Number(extra) || 0, tamanhosPizza.length)
            setTamanhosPizza((prev) => [...prev, novo])
          }}
          onUpdate={async (id, nome, extra) => {
            await atualizarTamanhoPadraoPizza(supabase, id, nome, Number(extra) || 0)
            setTamanhosPizza((prev) => prev.map((t) => (t.id === id ? { ...t, nome, fatias: Number(extra) || 0 } : t)))
          }}
          onRemove={async (id) => {
            if (!confirm('Excluir este tamanho de pizza? Preços de sabores cadastrados pra ele também serão excluídos.')) return
            await removerTamanhoPadraoPizza(supabase, id)
            setTamanhosPizza((prev) => prev.filter((t) => t.id !== id))
          }}
        />
        <ListaCatalogo
          titulo="Tamanhos de marmita"
          hint='Ex.: "Pequena" 500g, "Grande" 700g. Ao criar um item de marmita, importe esses tamanhos com 1 clique e só ajuste o preço.'
          itens={tamanhosMarmita.map((t) => ({ id: t.id, nome: t.nome, extra: t.peso }))}
          extraLabel="Peso"
          extraPlaceholder="Ex: 500g"
          extraType="text"
          formatExtra={(e) => e}
          onAdd={async (nome, extra) => {
            const novo = await criarTamanhoPadraoMarmita(supabase, restauranteId, nome, extra, tamanhosMarmita.length)
            setTamanhosMarmita((prev) => [...prev, novo])
          }}
          onUpdate={async (id, nome, extra) => {
            await atualizarTamanhoPadraoMarmita(supabase, id, nome, extra)
            setTamanhosMarmita((prev) => prev.map((t) => (t.id === id ? { ...t, nome, peso: extra } : t)))
          }}
          onRemove={async (id) => {
            if (!confirm('Excluir este tamanho de marmita?')) return
            await removerTamanhoPadraoMarmita(supabase, id)
            setTamanhosMarmita((prev) => prev.filter((t) => t.id !== id))
          }}
        />
        <ListaCatalogo
          titulo="Bordas de pizza"
          hint="Oferecidas como opção (com preço extra) em todas as pizzas da loja."
          itens={bordas.map((b) => ({ id: b.id, nome: b.nome, extra: String(b.preco) }))}
          extraLabel="Preço extra (R$)"
          extraPlaceholder="Ex: 8,00"
          extraType="text"
          extraIsPrice
          formatExtra={(e) => `+ R$ ${(Number(e) || 0).toFixed(2).replace('.', ',')}`}
          onAdd={async (nome, extra) => {
            const preco = Number(extra.replace(',', '.')) || 0
            const novo = await criarBordaPizza(supabase, restauranteId, nome, preco, bordas.length)
            setBordas((prev) => [...prev, novo])
          }}
          onUpdate={async (id, nome, extra) => {
            const preco = Number(extra.replace(',', '.')) || 0
            await atualizarBordaPizza(supabase, id, nome, preco)
            setBordas((prev) => prev.map((b) => (b.id === id ? { ...b, nome, preco } : b)))
          }}
          onRemove={async (id) => {
            if (!confirm('Excluir esta borda?')) return
            await removerBordaPizza(supabase, id)
            setBordas((prev) => prev.filter((b) => b.id !== id))
          }}
        />
        <ListaCatalogo
          titulo="Massas de pizza"
          hint="Oferecidas como opção (com preço extra) em todas as pizzas da loja."
          itens={massas.map((m) => ({ id: m.id, nome: m.nome, extra: String(m.preco) }))}
          extraLabel="Preço extra (R$)"
          extraPlaceholder="Ex: 5,00"
          extraType="text"
          extraIsPrice
          formatExtra={(e) => `+ R$ ${(Number(e) || 0).toFixed(2).replace('.', ',')}`}
          onAdd={async (nome, extra) => {
            const preco = Number(extra.replace(',', '.')) || 0
            const novo = await criarMassaPizza(supabase, restauranteId, nome, preco, massas.length)
            setMassas((prev) => [...prev, novo])
          }}
          onUpdate={async (id, nome, extra) => {
            const preco = Number(extra.replace(',', '.')) || 0
            await atualizarMassaPizza(supabase, id, nome, preco)
            setMassas((prev) => prev.map((m) => (m.id === id ? { ...m, nome, preco } : m)))
          }}
          onRemove={async (id) => {
            if (!confirm('Excluir esta massa?')) return
            await removerMassaPizza(supabase, id)
            setMassas((prev) => prev.filter((m) => m.id !== id))
          }}
        />
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
  const [tamanhosPizzaCatalogo, setTamanhosPizzaCatalogo] = useState<TamanhoPadraoPizza[]>([])
  const [tamanhosMarmitaCatalogo, setTamanhosMarmitaCatalogo] = useState<TamanhoPadraoMarmita[]>([])

  const [cardapioTab, setCardapioTab] = useState<CardapioTab>('itens')
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
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
  const [creatingTamanho, setCreatingTamanho] = useState(false)
  const [newTamanhoForm, setNewTamanhoForm] = useState({ nome: '', preco: '' })
  const [editingTamanhoId, setEditingTamanhoId] = useState<string | null>(null)
  const [editingTamanhoForm, setEditingTamanhoForm] = useState({ nome: '', preco: '' })
  const [creatingSabor, setCreatingSabor] = useState(false)
  const [newSaborNome, setNewSaborNome] = useState('')
  // Açaí = item simples COM tamanhos/volumes (sem novo tipo no banco).
  const [temTamanhos, setTemTamanhos] = useState(false)
  // Wizard do cadastro de item: 1 O básico · 2 Tamanhos/Sabores · 3 Complementos · 4 Exibição.
  const [formStep, setFormStep] = useState(1)

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
        const [gruposData, itensData, presetsData, tamanhosPizzaData, tamanhosMarmitaData] = await Promise.all([
          listarGrupos(supabase, id),
          listarItens(supabase, id),
          listarPresets(supabase, id),
          listarTamanhosPadraoPizza(supabase, id),
          listarTamanhosPadraoMarmita(supabase, id),
        ])
        if (cancelled) return
        setGroups(gruposData)
        setItems(itensData)
        setPresets(presetsData)
        setTamanhosPizzaCatalogo(tamanhosPizzaData)
        setTamanhosMarmitaCatalogo(tamanhosMarmitaData)
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
    setTemTamanhos(false)
    setFormStep(1)
    setDrawer('edit')
  }

  function openEditItem(item: ItemCardapio) {
    setForm(formFromItem(item))
    setCreatingGrupo(false)
    setNewGrupoForm({ nome: '', obrigatorio: false, min: 0, max: 1 })
    // açaí/sized: item simples que já tem tamanhos cadastrados
    setTemTamanhos(item.tipoItem === 'simples' && item.tamanhos.length > 0)
    setFormStep(1)
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

  /** Salva o item (create ou update). `fechar` controla se o drawer fecha — o wizard salva a cada etapa sem fechar. */
  async function saveItem(fechar = true): Promise<boolean> {
    if (!restauranteId || !form.nome.trim()) return false
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
        promocaoPreco: form.promocaoPreco.trim() ? parsePreco(form.promocaoPreco) : null,
        maisVendido: form.maisVendido,
        tag: form.tag,
        tipoItem: form.tipoItem,
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
      }
      if (fechar) setDrawer(null)
      return true
    } catch {
      setError('Não foi possível salvar o item. Tente novamente.')
      return false
    } finally {
      setSaving(false)
    }
  }

  // ── Navegação do wizard de cadastro ──────────────────────────────────────
  const temVariacoes = form.tipoItem === 'pizza' || form.tipoItem === 'marmita' || (form.tipoItem === 'simples' && temTamanhos)

  /** Avança pra próxima etapa; a etapa 1 salva o básico antes (cria o item se for novo). */
  async function wizardNext() {
    if (formStep === 1) {
      const ok = await saveItem(false)
      if (!ok) return
      setFormStep(temVariacoes ? 2 : 3)
      return
    }
    if (formStep === 2) { setFormStep(3); return }
    if (formStep === 3) { setFormStep(4); return }
    await saveItem(true) // etapa final: persiste exibição/disponibilidade e fecha
  }

  function wizardBack() {
    if (formStep === 4) { setFormStep(3); return }
    if (formStep === 3) { setFormStep(temVariacoes ? 2 : 1); return }
    if (formStep === 2) setFormStep(1)
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

  function startEditCategoria(group: GrupoCardapio) {
    setEditingGroupId(group.id)
    setEditingGroupName(group.nome)
  }

  async function saveEditCategoria() {
    if (!editingGroupId || !editingGroupName.trim()) return
    try {
      const updated = await atualizarGrupo(supabase, editingGroupId, editingGroupName.trim())
      setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
      if (activeGroup && groups.find((g) => g.id === editingGroupId)?.nome === activeGroup) {
        setActiveGroup(updated.nome)
      }
      setEditingGroupId(null)
    } catch {
      setError('Não foi possível renomear a categoria.')
    }
  }

  /** Move a categoria pra cima/baixo e persiste a nova ordem (vitrine segue essa ordem). */
  async function moveCategoria(group: GrupoCardapio, dir: -1 | 1) {
    const idx = groups.findIndex((g) => g.id === group.id)
    const alvo = idx + dir
    if (idx < 0 || alvo < 0 || alvo >= groups.length) return
    const nova = [...groups]
    ;[nova[idx], nova[alvo]] = [nova[alvo], nova[idx]]
    setGroups(nova) // otimista — reverte se falhar
    try {
      await reordenarGrupos(supabase, nova)
    } catch {
      setGroups(groups)
      setError('Não foi possível reordenar as categorias.')
    }
  }

  async function deleteCategoria(group: GrupoCardapio) {
    if (!confirm(`Excluir a categoria "${group.nome}"? Os itens dela não serão excluídos, apenas ficarão sem categoria.`)) return
    try {
      await removerGrupo(supabase, group.id)
      setGroups((prev) => prev.filter((g) => g.id !== group.id))
      if (activeGroup === group.nome) setActiveGroup(null)
    } catch {
      setError('Não foi possível excluir a categoria.')
    }
  }

  async function importPreset(preset: PresetComplementos) {
    if (!form.id) {
      setError('Salve o item antes de importar um grupo de complementos.')
      return
    }
    try {
      const posicao = currentItem?.grupos.length ?? 0
      await importarPresetNoItem(supabase, form.id, preset.id, posicao)
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

  async function createTamanho() {
    if (!form.id || !newTamanhoForm.nome.trim()) return
    const preco = Number(newTamanhoForm.preco.replace(',', '.')) || 0
    const posicao = currentItem?.tamanhos.length ?? 0
    try {
      await criarTamanho(supabase, form.id, newTamanhoForm.nome.trim(), preco, posicao)
      setCreatingTamanho(false)
      setNewTamanhoForm({ nome: '', preco: '' })
      await refreshItems()
    } catch {
      setError('Não foi possível criar o tamanho.')
    }
  }

  function startEditTamanho(tamanho: TamanhoItem) {
    setEditingTamanhoId(tamanho.id)
    setEditingTamanhoForm({ nome: tamanho.nome, preco: String(tamanho.preco).replace('.', ',') })
  }

  async function saveEditTamanho() {
    if (!editingTamanhoId || !editingTamanhoForm.nome.trim()) return
    const preco = Number(editingTamanhoForm.preco.replace(',', '.')) || 0
    try {
      await atualizarTamanho(supabase, editingTamanhoId, editingTamanhoForm.nome.trim(), preco)
      setEditingTamanhoId(null)
      await refreshItems()
    } catch {
      setError('Não foi possível atualizar o tamanho.')
    }
  }

  async function deleteTamanho(tamanho: TamanhoItem) {
    if (!confirm(`Excluir o tamanho "${tamanho.nome}"?`)) return
    try {
      await removerTamanho(supabase, tamanho.id)
      await refreshItems()
    } catch {
      setError('Não foi possível excluir o tamanho.')
    }
  }

  async function importarTamanhosMarmita() {
    if (!form.id) return
    const existentes = new Set((currentItem?.tamanhos ?? []).map((t) => t.nome))
    const faltantes = tamanhosMarmitaCatalogo.filter((t) => !existentes.has(t.nome))
    if (faltantes.length === 0) return
    try {
      for (const [i, t] of faltantes.entries()) {
        await criarTamanho(supabase, form.id, `${t.nome} (${t.peso})`, 0, (currentItem?.tamanhos.length ?? 0) + i)
      }
      await refreshItems()
    } catch {
      setError('Não foi possível importar os tamanhos da loja.')
    }
  }

  async function createSaborNoItem() {
    if (!form.id || !newSaborNome.trim()) return
    try {
      await criarSabor(supabase, form.id, newSaborNome.trim(), currentItem?.sabores.length ?? 0)
      setNewSaborNome('')
      setCreatingSabor(false)
      await refreshItems()
    } catch {
      setError('Não foi possível criar o sabor.')
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
            : cardapioTab === 'tamanhos'
            ? 'Cardápio › Tamanhos'
            : 'Cardápio › Order Bump'
        }
      />

      {/* Tab bar */}
      <div className="flex flex-shrink-0 gap-0.5 border-b border-border bg-main px-5 pt-3.5">
        {([
          { id: 'itens' as CardapioTab, label: 'Itens do cardápio' },
          { id: 'complementos' as CardapioTab, label: 'Grupos de complementos' },
          { id: 'tamanhos' as CardapioTab, label: 'Tamanhos' },
          { id: 'orderbump' as CardapioTab, label: 'Order Bump' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setCardapioTab(t.id)}
            className={[
              'rounded-t-menuzia border-b-2 px-4 pb-3 pt-2 text-[13px] font-semibold transition-colors',
              cardapioTab === t.id ? 'border-tab-active bg-tab-active text-white' : 'border-transparent text-text-subtle hover:text-text-main',
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
          <Button variant="primary" className="!bg-[#0688D4] hover:!bg-[#0574B4]" onClick={openNewItem} disabled={!activeGroupId}>
            + Novo item
          </Button>
          <Button variant="primary" className="!bg-[#0688D4] hover:!bg-[#0574B4]" onClick={() => setDrawer('categoria')}>
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
              {groups.map((group) =>
                editingGroupId === group.id ? (
                  <div key={group.id} className="flex items-center gap-1 px-1 py-1">
                    <input
                      autoFocus
                      value={editingGroupName}
                      onChange={(e) => setEditingGroupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEditCategoria()
                        if (e.key === 'Escape') setEditingGroupId(null)
                      }}
                      className="flex-1 rounded-menuzia border border-primary px-2 py-1.5 text-sm outline-none"
                    />
                    <button onClick={saveEditCategoria} title="Salvar" className="rounded-menuzia px-1.5 py-1 text-primary-dark hover:bg-page">✓</button>
                    <button onClick={() => setEditingGroupId(null)} title="Cancelar" className="rounded-menuzia px-1.5 py-1 text-text-subtle hover:bg-page">✕</button>
                  </div>
                ) : (
                  <div
                    key={group.id}
                    className={[
                      'group flex w-full items-center justify-between rounded-menuzia border-l-[3px] px-3 py-1 text-left text-sm font-medium transition-colors',
                      group.nome === activeGroup
                        ? 'border-l-primary bg-primary/10 font-semibold text-primary-dark'
                        : 'border-l-transparent text-text-main hover:bg-page',
                    ].join(' ')}
                  >
                    <button onClick={() => setActiveGroup(group.nome)} className="flex flex-1 items-center gap-2 py-1.5 text-left">
                      <span>{group.nome}</span>
                      <span className={['rounded-full px-2 py-0.5 text-[11px] font-bold', group.nome === activeGroup ? 'bg-white text-primary-dark' : 'bg-page text-text-subtle'].join(' ')}>
                        {groupCounts.get(group.id) ?? 0}
                      </span>
                    </button>
                    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => moveCategoria(group, -1)}
                        disabled={groups[0]?.id === group.id}
                        title="Mover pra cima (muda a ordem na vitrine)"
                        className="rounded-menuzia px-1 py-1 text-text-subtle hover:bg-white hover:text-primary-dark disabled:opacity-30"
                      >↑</button>
                      <button
                        onClick={() => moveCategoria(group, 1)}
                        disabled={groups[groups.length - 1]?.id === group.id}
                        title="Mover pra baixo (muda a ordem na vitrine)"
                        className="rounded-menuzia px-1 py-1 text-text-subtle hover:bg-white hover:text-primary-dark disabled:opacity-30"
                      >↓</button>
                      <button onClick={() => startEditCategoria(group)} title="Renomear categoria" className="rounded-menuzia px-1.5 py-1 text-text-subtle hover:bg-white hover:text-primary-dark">✎</button>
                      <button onClick={() => deleteCategoria(group)} title="Excluir categoria" className="rounded-menuzia px-1.5 py-1 text-text-subtle hover:bg-white hover:text-danger">🗑</button>
                    </span>
                  </div>
                )
              )}
            </div>
            <div className="flex gap-1.5 border-t border-border p-2.5">
              <Button variant="primary" className="flex-1 !bg-[#0688D4] hover:!bg-[#0574B4]" onClick={() => setDrawer('categoria')}>
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
                  Nenhum item nesta categoria ainda. Use &ldquo;+ Novo item&rdquo; para cadastrar o primeiro.
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
                      <tr key={item.id} className={selected.has(item.id) ? 'bg-primary/10' : 'hover:bg-[#F9FAFB]'}>
                        <td className="border-b border-border px-3.5 py-3">
                          <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.has(item.id)} onChange={() => toggleRow(item.id)} />
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <ItemThumb item={item} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                {item.maisVendido && (
                                  <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-[#F59E0B]" aria-label="Em destaque"><title>Em destaque</title><path d="M12 2l2.9 6.26L21.6 9l-4.8 4.68L17.94 21 12 17.27 6.06 21l1.14-7.32L2.4 9l6.7-.74z" /></svg>
                                )}
                                <span className="text-[13px] font-semibold">{item.nome}</span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-text-subtle">{item.descricao}</div>
                            </div>
                          </div>
                        </td>
                        <td className="border-b border-border px-3.5 py-3 text-[13px] font-semibold">
                          {item.promocaoPreco !== null ? (
                            <div className="flex flex-col">
                              <span className="text-price-text">R$ {item.promocaoPreco.toFixed(2).replace('.', ',')}</span>
                              <span className="text-[11px] font-normal text-text-subtle line-through">R$ {item.preco.toFixed(2).replace('.', ',')}</span>
                            </div>
                          ) : (
                            <>R$ {item.preco.toFixed(2).replace('.', ',')}</>
                          )}
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <DayToggles
                            days={item.diasDisponiveis}
                            onChange={(days) => {
                              setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, diasDisponiveis: days } : i)))
                              atualizarItem(supabase, item.id, {
                                grupoId: item.grupoId, nome: item.nome, descricao: item.descricao,
                                preco: item.preco, status: item.status, diasDisponiveis: days, imagemUrl: item.imagemUrl,
                                promocaoPreco: item.promocaoPreco, maisVendido: item.maisVendido, tag: item.tag, tipoItem: item.tipoItem,
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
                        <div className="flex items-center gap-1.5">
                          {item.maisVendido && (
                            <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 fill-[#F59E0B]" aria-label="Em destaque"><title>Em destaque</title><path d="M12 2l2.9 6.26L21.6 9l-4.8 4.68L17.94 21 12 17.27 6.06 21l1.14-7.32L2.4 9l6.7-.74z" /></svg>
                          )}
                          <div className="text-sm font-semibold">{item.nome}</div>
                        </div>
                        <div className="flex-1 text-xs leading-relaxed text-text-subtle">{item.descricao}</div>
                        <div className="mt-1 flex items-center justify-between">
                          {item.promocaoPreco !== null ? (
                            <span className="flex flex-col">
                              <span className="rounded-menuzia bg-price-bg px-2 py-1 text-[13px] font-bold text-price-text">
                                R$ {item.promocaoPreco.toFixed(2).replace('.', ',')}
                              </span>
                              <span className="mt-0.5 text-[11px] text-text-subtle line-through">R$ {item.preco.toFixed(2).replace('.', ',')}</span>
                            </span>
                          ) : (
                            <span className="rounded-menuzia bg-price-bg px-2 py-1 text-[13px] font-bold text-price-text">
                              R$ {item.preco.toFixed(2).replace('.', ',')}
                            </span>
                          )}
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

      {/* ── Tab: Tamanhos ── */}
      <div className={cardapioTab !== 'tamanhos' ? 'hidden' : 'flex flex-1 flex-col overflow-hidden'}>
        {restauranteId && (
          <TamanhosTab
            restauranteId={restauranteId}
            tamanhosPizza={tamanhosPizzaCatalogo}
            setTamanhosPizza={setTamanhosPizzaCatalogo}
            tamanhosMarmita={tamanhosMarmitaCatalogo}
            setTamanhosMarmita={setTamanhosMarmitaCatalogo}
          />
        )}
      </div>

      {/* ── Tab: Order Bump ── */}
      <div className={cardapioTab !== 'orderbump' ? 'hidden' : 'flex flex-1 flex-col overflow-hidden'}>
        {restauranteId && <OrderBumpTab restauranteId={restauranteId} items={items} />}
      </div>

      {/* Overlay + drawers */}
      {drawer && <div className="fixed inset-0 z-50 bg-[#111827]/45" onClick={closeDrawer} />}

      {/* Drawer: nova categoria */}
      <aside className={modalClass(drawer === 'categoria', 'w-[380px] max-w-[92vw]')}>
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
      <aside className={modalClass(drawer === 'preset', 'w-[420px] max-w-[92vw]')}>
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
      <aside className={modalClass(drawer === 'edit', 'w-[560px] max-w-[94vw]')}>
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">{form.id ? 'Editar item' : 'Novo item'}</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{form.id ? form.nome : `Novo item em ${activeGroup ?? ''}`}</p>
          </div>
          <button onClick={closeDrawer} className="flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        {/* Stepper do wizard */}
        <div className="border-b border-border bg-page px-4.5 py-2.5">
          <div className="flex items-center gap-1">
            {[
              { n: 1, label: 'O básico' },
              ...(temVariacoes ? [{ n: 2, label: form.tipoItem === 'pizza' ? 'Sabores' : temTamanhos ? 'Volumes' : 'Tamanhos' }] : []),
              { n: 3, label: 'Complementos' },
              { n: 4, label: 'Exibição' },
            ].map((s, i, arr) => {
              const podeIr = s.n === 1 || !!form.id
              return (
                <div key={s.n} className="flex flex-1 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => podeIr && setFormStep(s.n)}
                    disabled={!podeIr}
                    className={[
                      'flex flex-1 flex-col items-center gap-0.5 rounded-menuzia px-1 py-1.5 transition-colors',
                      formStep === s.n ? 'bg-white shadow-sm' : podeIr ? 'hover:bg-white/60' : 'opacity-40',
                    ].join(' ')}
                  >
                    <span className={[
                      'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                      formStep === s.n ? 'bg-[#1e3a8a] text-white' : form.id && formStep > s.n ? 'bg-status-ready text-white' : 'bg-border text-text-subtle',
                    ].join(' ')}>
                      {form.id && formStep > s.n ? '✓' : i + 1}
                    </span>
                    <span className={['text-[10px] font-semibold', formStep === s.n ? 'text-[#1e3a8a]' : 'text-text-subtle'].join(' ')}>{s.label}</span>
                  </button>
                  {i < arr.length - 1 && <span className="h-px w-2 flex-shrink-0 bg-border" />}
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          {/* ── ETAPA 1: o básico ─────────────────────────────────────── */}
          {formStep === 1 && (<>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Que tipo de item você vai cadastrar?</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: 'simples', icon: '🍔', label: 'Lanche / Simples', hint: 'Um preço só', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'simples' })); setTemTamanhos(false) }, active: form.tipoItem === 'simples' && !temTamanhos },
              { key: 'acai', icon: '🍧', label: 'Açaí / Volumes', hint: 'Preço por volume', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'simples' })); setTemTamanhos(true) }, active: form.tipoItem === 'simples' && temTamanhos },
              { key: 'pizza', icon: '🍕', label: 'Pizza', hint: 'Sabor × tamanho', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'pizza' })); setTemTamanhos(false) }, active: form.tipoItem === 'pizza' },
              { key: 'marmita', icon: '🍱', label: 'Marmita', hint: 'Preço por tamanho', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'marmita' })); setTemTamanhos(false) }, active: form.tipoItem === 'marmita' },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={t.onClick}
                className={[
                  'flex flex-col items-center gap-1 rounded-menuzia border-2 px-2 py-3 text-[11px] font-semibold transition-colors',
                  t.active ? 'border-[#1e3a8a] bg-[#1e3a8a] text-white' : 'border-border bg-white text-text-subtle hover:border-[#1e3a8a]/50',
                ].join(' ')}
              >
                <span className="text-xl leading-none">{t.icon}</span>
                {t.label}
                <span className={['text-[9px] font-normal', t.active ? 'text-white/70' : 'text-text-subtle/70'].join(' ')}>{t.hint}</span>
              </button>
            ))}
          </div>

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome do item *</div>
          <input value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
            placeholder="Ex.: Burger Duplo Artesanal"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Descrição</div>
          <input value={form.descricao} onChange={(e) => setForm((prev) => ({ ...prev, descricao: e.target.value }))}
            placeholder="Ex.: Pão brioche, 2 hambúrgueres 120g, cheddar e molho da casa"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />
          <p className="mt-1 text-[11px] text-text-subtle">Uma boa descrição ajuda o cliente a decidir — liste os principais ingredientes.</p>

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Foto do item</div>
          <div className="mb-4 flex items-center gap-3">
            {form.imagemUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={form.imagemUrl} alt={form.nome || 'Foto do item'} className="h-[64px] w-[64px] rounded-menuzia object-cover" />
              : <div className="flex h-[64px] w-[64px] items-center justify-center rounded-menuzia bg-gradient-to-br from-slate-100 to-slate-200">
                  <svg viewBox="0 0 24 24" className="h-7 w-7 fill-text-subtle/60"><path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" /></svg>
                </div>
            }
            <div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
              <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? 'Enviando…' : form.imagemUrl ? 'Trocar foto' : 'Enviar foto'}
              </Button>
              <p className="mt-1 text-[11px] text-text-subtle">Itens com foto vendem mais. Use foto real do prato.</p>
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Categoria</div>
              <select value={form.grupoId ?? ''} onChange={(e) => setForm((prev) => ({ ...prev, grupoId: e.target.value || null }))}
                className="w-full rounded-menuzia border border-border bg-white px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary">
                <option value="">Sem categoria</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{group.nome}</option>)}
              </select>
            </div>
            {form.tipoItem !== 'pizza' && (
              <div className="flex-1">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{temVariacoes ? 'Preço base (R$)' : 'Preço (R$)'}</div>
                <input value={form.preco} onChange={(e) => setForm((prev) => ({ ...prev, preco: e.target.value }))}
                  placeholder="32,90"
                  className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />
                {temVariacoes && <p className="mt-1 text-[11px] text-text-subtle">Opcional — o preço de cada {form.tipoItem === 'marmita' ? 'tamanho' : 'volume'} substitui esse valor.</p>}
              </div>
            )}
          </div>
          {form.tipoItem === 'pizza' && (
            <p className="mt-3 rounded-menuzia border border-dashed border-[#1e3a8a]/40 bg-[#1e3a8a]/5 p-2.5 text-[12px] text-text-main">
              Pizza não tem preço base: o preço vem do <b>sabor em cada tamanho</b> — você define na próxima etapa.
            </p>
          )}
          </>)}

          {/* ── ETAPA 2: tamanhos e sabores ───────────────────────────── */}
          {/* PIZZA — sabores × preço por tamanho */}
          {formStep === 2 && form.tipoItem === 'pizza' && (
            <div className="mt-4">
              <SectionHeader tone="blue">Sabores e preço por tamanho</SectionHeader>
              {!form.id ? (
                <div className="rounded-menuzia border border-dashed border-[#1e3a8a]/40 bg-[#1e3a8a]/5 p-3.5 text-center">
                  <p className="mb-2.5 text-[12px] text-text-main">A pizza não usa preço base: o preço vem do <b>sabor em cada tamanho</b>. Salve o item pra cadastrar os sabores e seus preços.</p>
                  <button onClick={() => saveItem(false)} disabled={saving || !form.nome.trim()}
                    className="rounded-menuzia bg-[#1e3a8a] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50">
                    {saving ? 'Salvando…' : 'Salvar e adicionar sabores'}
                  </button>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[11px] text-text-subtle">
                    Cada sabor tem seu preço por tamanho. Cadastre os tamanhos da pizza na aba &ldquo;Tamanhos&rdquo; antes de definir os preços.
                  </p>
                  {(currentItem?.sabores ?? []).map((sabor) => (
                    <SaborCard key={sabor.id} sabor={sabor} tamanhos={tamanhosPizzaCatalogo} restauranteId={restauranteId!} onRefresh={refreshItems} />
                  ))}
                  {(currentItem?.sabores ?? []).length === 0 && !creatingSabor && (
                    <div className="mb-3 rounded-menuzia border border-dashed border-border p-3 text-center text-[11px] text-text-subtle">Nenhum sabor cadastrado ainda.</div>
                  )}
                  {creatingSabor ? (
                    <div className="mb-2 mt-2 flex items-center gap-2 rounded-menuzia border border-border bg-page p-2.5">
                      <input autoFocus value={newSaborNome} onChange={(e) => setNewSaborNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createSaborNoItem()}
                        placeholder="Nome do sabor (ex: Mussarela)" className="flex-1 rounded-menuzia border border-border px-2.5 py-1.5 text-[13px] outline-none focus:border-primary" />
                      <button onClick={createSaborNoItem} disabled={!newSaborNome.trim()}
                        className="rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-50">Adicionar</button>
                      <button onClick={() => { setCreatingSabor(false); setNewSaborNome('') }}
                        className="rounded-menuzia border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-page">Cancelar</button>
                    </div>
                  ) : (
                    <button onClick={() => setCreatingSabor(true)}
                      className="mt-2 w-full rounded-menuzia border border-dashed border-border bg-white py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle transition-colors hover:border-[#1e3a8a] hover:text-[#1e3a8a]">+ Novo sabor</button>
                  )}
                </>
              )}
            </div>
          )}

          {/* MARMITA / AÇAÍ — tamanhos com preço próprio */}
          {formStep === 2 && (form.tipoItem === 'marmita' || (form.tipoItem === 'simples' && temTamanhos)) && (
            <div className="mt-4">
              <div className="-mx-4.5 mb-3 flex items-center justify-between border-y border-[#1e3a8a]/15 bg-[#1e3a8a]/5 px-4.5 py-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-[#1e3a8a]">{temTamanhos ? 'Tamanhos / Volumes' : 'Tamanhos'}</span>
                {form.id && tamanhosMarmitaCatalogo.length > 0 && form.tipoItem === 'marmita' && (
                  <button onClick={importarTamanhosMarmita} className="rounded-menuzia bg-[#1e3a8a] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white transition hover:brightness-110">Importar da loja</button>
                )}
              </div>
              {!form.id ? (
                <div className="rounded-menuzia border border-dashed border-[#1e3a8a]/40 bg-[#1e3a8a]/5 p-3.5 text-center">
                  <p className="mb-2.5 text-[12px] text-text-main">O cliente escolhe um {temTamanhos ? 'volume' : 'tamanho'} e o preço dele substitui o preço base. Salve o item pra cadastrar os {temTamanhos ? 'volumes' : 'tamanhos'}.</p>
                  <button onClick={() => saveItem(false)} disabled={saving || !form.nome.trim()}
                    className="rounded-menuzia bg-[#1e3a8a] px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50">
                    {saving ? 'Salvando…' : `Salvar e adicionar ${temTamanhos ? 'volumes' : 'tamanhos'}`}
                  </button>
                </div>
              ) : (
                <>
                  {(currentItem?.tamanhos ?? []).map((tamanho) =>
                    editingTamanhoId === tamanho.id ? (
                      <div key={tamanho.id} className="mb-1.5 flex items-center gap-2 rounded-menuzia border border-[#1e3a8a] bg-[#1e3a8a]/5 px-2.5 py-2">
                        <input autoFocus value={editingTamanhoForm.nome} onChange={(e) => setEditingTamanhoForm((prev) => ({ ...prev, nome: e.target.value }))}
                          placeholder="Nome" className="w-24 rounded-menuzia border border-border px-2 py-1 text-[13px] outline-none focus:border-primary" />
                        <input value={editingTamanhoForm.preco} onChange={(e) => setEditingTamanhoForm((prev) => ({ ...prev, preco: e.target.value }))}
                          placeholder="Preço" className="w-24 rounded-menuzia border border-border px-2 py-1 text-[13px] outline-none focus:border-primary" />
                        <button onClick={saveEditTamanho} className="rounded-menuzia px-1.5 py-1 text-[#1e3a8a] hover:bg-white">✓</button>
                        <button onClick={() => setEditingTamanhoId(null)} className="rounded-menuzia px-1.5 py-1 text-text-subtle hover:bg-white">✕</button>
                      </div>
                    ) : (
                      <div key={tamanho.id} className="mb-1.5 flex items-center gap-2.5 rounded-menuzia border border-border px-2.5 py-2">
                        <span className="flex-1 text-[13px] font-medium">{tamanho.nome}</span>
                        <span className="rounded-menuzia bg-price-bg px-1.5 py-0.5 text-[11px] font-bold text-price-text">R$ {tamanho.preco.toFixed(2).replace('.', ',')}</span>
                        <button onClick={() => startEditTamanho(tamanho)} title="Editar" className="flex h-[26px] w-[26px] items-center justify-center rounded-menuzia bg-page text-[13px] text-text-subtle hover:bg-border">✎</button>
                        <button onClick={() => deleteTamanho(tamanho)} title="Excluir"
                          className="flex h-[26px] w-[26px] items-center justify-center rounded-menuzia bg-[#fee2e2] text-[15px] text-[#ef4444] hover:bg-[#ef4444] hover:text-white">×</button>
                      </div>
                    )
                  )}
                  {(currentItem?.tamanhos ?? []).length === 0 && !creatingTamanho && (
                    <div className="mb-3 rounded-menuzia border border-dashed border-border p-3 text-center text-[11px] text-text-subtle">Nenhum {temTamanhos ? 'volume' : 'tamanho'} cadastrado. Sem isso, o item usa só o preço base.</div>
                  )}
                  {creatingTamanho ? (
                    <div className="mb-2 mt-2 flex items-center gap-2 rounded-menuzia border border-border bg-page p-2.5">
                      <input autoFocus value={newTamanhoForm.nome} onChange={(e) => setNewTamanhoForm((prev) => ({ ...prev, nome: e.target.value }))}
                        placeholder={temTamanhos ? 'Ex: 500ml' : 'Ex: G'} className="w-28 rounded-menuzia border border-border px-2 py-1.5 text-[13px] outline-none focus:border-primary" />
                      <input value={newTamanhoForm.preco} onChange={(e) => setNewTamanhoForm((prev) => ({ ...prev, preco: e.target.value }))}
                        placeholder="Preço (ex: 24,90)" className="w-28 rounded-menuzia border border-border px-2 py-1.5 text-[13px] outline-none focus:border-primary" />
                      <button onClick={createTamanho} disabled={!newTamanhoForm.nome.trim()}
                        className="rounded-menuzia bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white hover:bg-primary-dark disabled:opacity-50">Adicionar</button>
                      <button onClick={() => { setCreatingTamanho(false); setNewTamanhoForm({ nome: '', preco: '' }) }}
                        className="rounded-menuzia border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle hover:bg-page">Cancelar</button>
                    </div>
                  ) : (
                    <button onClick={() => setCreatingTamanho(true)}
                      className="mt-2 w-full rounded-menuzia border border-dashed border-border bg-white py-2.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle transition-colors hover:border-[#1e3a8a] hover:text-[#1e3a8a]">+ Novo {temTamanhos ? 'volume' : 'tamanho'}</button>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── ETAPA 4: exibição e disponibilidade ───────────────────── */}
          {formStep === 4 && (<>
          <SectionHeader>Exibição e disponibilidade</SectionHeader>
          <div className="mt-1 flex gap-3">
            {form.tipoItem !== 'pizza' && (
              <div className="flex-1">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Preço promocional (R$)</div>
                <input value={form.promocaoPreco} onChange={(e) => setForm((prev) => ({ ...prev, promocaoPreco: e.target.value }))}
                  placeholder="Opcional"
                  className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />
                <p className="mt-1 text-[11px] text-text-subtle">Se preenchido, o item aparece em promoção (com desconto) no cardápio.</p>
              </div>
            )}
            <div className="flex-1">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Destaque</div>
              <label className="flex h-[34px] cursor-pointer items-center gap-2 rounded-menuzia border border-border px-2.5 text-[13px] font-medium text-text-main">
                <input type="checkbox" checked={form.maisVendido} onChange={(e) => setForm((prev) => ({ ...prev, maisVendido: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-primary" />
                Item em destaque
              </label>
              <p className="mt-1 text-[11px] text-text-subtle">Marca o item com ⭐ aqui no painel e o destaca no cardápio do cliente.</p>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Etiqueta na vitrine</div>
            <select
              value={form.tag ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, tag: (e.target.value || null) as TagItem | null }))}
              className="w-full rounded-menuzia border border-border bg-white px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary"
            >
              <option value="">Sem etiqueta</option>
              {TAGS_ITEM.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-text-subtle">Pílula colorida exibida no card do produto na vitrine (ex.: &ldquo;Mais pedido&rdquo;, &ldquo;Edição limitada&rdquo;).</p>
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
          </>)}

          {/* ── ETAPA 3: complementos ─────────────────────────────────── */}
          {formStep === 3 && form.id && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Grupos de complementos</div>
                <button onClick={() => setDrawer('preset')} className="rounded-menuzia bg-purple-600 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-purple-700">
                  Importar grupo
                </button>
              </div>
              <p className="mb-3 mt-1 text-[11px] text-text-subtle">
                Adicionais que o cliente escolhe junto com o item (ex.: &ldquo;Bacon extra&rdquo;, &ldquo;Ponto da carne&rdquo;). Etapa opcional —
                importe um grupo salvo ou crie um novo. Cada grupo pode ser obrigatório ou opcional, com mínimo/máximo de escolhas.
              </p>

              {/* Existing complement groups */}
              {(currentItem?.grupos ?? []).map((grupo) => (
                <GrupoItemCard
                  key={grupo.id}
                  grupo={grupo}
                  itemId={form.id!}
                  restauranteId={restauranteId!}
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
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          {formStep === 1 ? (
            <Button variant="secondary" className="flex-1" onClick={closeDrawer} disabled={saving}>Cancelar</Button>
          ) : (
            <Button variant="secondary" className="flex-1" onClick={wizardBack} disabled={saving}>← Voltar</Button>
          )}
          <Button variant="primary" className="flex-1" onClick={wizardNext} disabled={saving || !form.nome.trim()}>
            {saving
              ? 'Salvando…'
              : formStep === 4
              ? 'Concluir'
              : formStep === 1 && !form.id
              ? 'Salvar e continuar →'
              : 'Continuar →'}
          </Button>
        </div>
      </aside>
    </>
  )
}
