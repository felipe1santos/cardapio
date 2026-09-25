'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { descricaoEmTextoPuro } from '@/lib/descricao-rica'
import { avisoDoItem, erroDoItem, statusAoCriarItem } from '@/lib/item-cadastro'
import { ArrowDown, ArrowUp, Clock, CupSoda, GripVertical, Images, Pause, Pencil, Pizza, Play, Plus, Sandwich, Search, Soup, Star, Trash2 } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  adicionarComplemento,
  atualizarComplemento,
  atualizarGrupo,
  atualizarGrupoItem,
  atualizarItem,
  buscarRestauranteIdDoUsuario,
  criarGrupo,
  criarGrupoItem,
  criarItem,
  definirFavorito,
  definirStatusEmLote,
  enviarImagemItem,
  enviarImagemItemComThumb,
  excluirItens,
  importarPresetNoItem,
  listarGrupos,
  listarItens,
  listarPresets,
  removerComplemento,
  removerGrupo,
  removerGrupoItem,
  salvarOrdemCardapio,
  type GrupoCardapio,
  type GrupoItemComplementos,
  type ItemCardapio,
  type ComplementoItem,
  type PresetComplementos,
  type StatusItem,
  type TipoItem,
  type TagItem,
  TAGS_ITEM,
} from '@/lib/queries/cardapio'
import {
  listarTamanhosPadraoPizza,
  listarTamanhosPadraoMarmita,
  type TamanhoPadraoPizza,
  type TamanhoPadraoMarmita,
} from '@/lib/queries/pizza'
import { BulkUploadModal, type BulkUploadTarget } from './bulk-upload-modal'
import { AjustarFoco } from '@/components/ajustar-foco'
import { FOCO_PADRAO, objectPosition, type Foco } from '@/lib/foco-imagem'
import { enviarImagemCategoria } from '@/lib/queries/ajustes'
import { DescricaoEditor } from '@/components/admin/descricao-editor'
import { pode } from '@/lib/auth/permissoes'
import { precoDeVitrine } from '@/lib/garcom-catalogo'
import { mensagemErroCardapio } from '@/lib/nomes-catalogo'
import { AbasCardapio, abaDaUrl, type AbaCardapio } from '@/components/cardapio/abas-cardapio'
import { GruposComplementos } from '@/components/cardapio/grupos-complementos'
import { TamanhosLoja } from '@/components/cardapio/tamanhos-loja'
import { PecaTambem } from '@/components/cardapio/peca-tambem'
import { useOrdenacaoArrastavel } from '@/components/cardapio/ordenacao-arrastavel'
import { ordenar } from '@/lib/ordem-cardapio'
import { PizzaTamanhosPrecos } from '@/components/cardapio/pizza-tamanhos-precos'
import { TamanhosDoItem } from '@/components/cardapio/tamanhos-do-item'
import { FoodIcon } from '@/components/cardapio/icone-comida'
import { Aviso, BotaoIcone, FaixaErro, ItemThumb } from '@/components/cardapio/ui'

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
  imagemThumbUrl: string | null
  promocaoPreco: string
  maisVendido: boolean
  tag: TagItem | null
  tipoItem: TipoItem
  disponivelDelivery: boolean
  disponivelSalao: boolean
}


// ─── Utilities ────────────────────────────────────────────────────────────────

function blankForm(grupoId: string | null): ItemFormState {
  return {
    id: null, grupoId, nome: '', descricao: '', preco: '', status: 'disponivel', diasDisponiveis: ALL_DAYS, imagemUrl: null, imagemThumbUrl: null,
    promocaoPreco: '', maisVendido: false, tag: null, tipoItem: 'simples',
    // Item novo nasce nos dois canais: é o comportamento de sempre e o default da 0069.
    disponivelDelivery: true, disponivelSalao: true,
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
    imagemThumbUrl: item.imagemThumbUrl,
    promocaoPreco: item.promocaoPreco !== null ? item.promocaoPreco.toFixed(2).replace('.', ',') : '',
    maisVendido: item.maisVendido,
    tag: item.tag,
    tipoItem: item.tipoItem,
    disponivelDelivery: item.disponivelDelivery,
    disponivelSalao: item.disponivelSalao,
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

/**
 * Um campo de foto de categoria: envio, prévia no recorte real e a mira.
 *
 * Existe porque a categoria tem DUAS fotos com recortes opostos — o cartão da
 * grade (5:2, largo e baixo) e o topo da ficha (quase um retrato) — e os dois
 * campos aparecem em dois lugares cada: no formulário de edição, na coluna de
 * categorias, e no drawer de categoria nova. Quatro cópias do mesmo bloco é
 * onde um ajuste passa a valer só em três.
 *
 * Não sobe nem grava nada: recebe o arquivo escolhido e devolve pra tela, que
 * é quem conhece as guardas de upload concorrente.
 */
function CampoFotoCategoria({
  rotulo,
  obrigatoria = false,
  explicacao,
  proporcoes,
  proporcaoPrevia,
  tituloModal,
  descricaoModal,
  url,
  foco,
  enviando,
  onArquivo,
  onFoco,
  onRemover,
}: {
  rotulo: string
  obrigatoria?: boolean
  explicacao: string
  proporcoes: { rotulo: string; ratio: number }[]
  /** Classe `aspect-*` da miniatura — o mesmo recorte que a vitrine faz. */
  proporcaoPrevia: string
  tituloModal: string
  descricaoModal: string
  url: string | null
  foco: Foco
  enviando: boolean
  onArquivo: (file: File) => void
  onFoco: (f: Foco) => void
  onRemover: () => void
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
        {rotulo}
        <span
          className={[
            'rounded-menuzia px-1.5 py-[2px] text-[9px] font-bold uppercase tracking-wide',
            obrigatoria ? 'bg-[#FEE2E2] text-danger' : 'bg-[#F3F4F6] text-text-subtle',
          ].join(' ')}
        >
          {obrigatoria ? 'Obrigatória' : 'Opcional'}
        </span>
      </div>
      <p className="mb-1.5 text-[10px] leading-snug text-text-subtle">{explicacao}</p>
      <input
        type="file"
        accept="image/*"
        aria-label={`Escolher imagem — ${rotulo}`}
        disabled={enviando}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) onArquivo(file)
        }}
        className="block w-full text-[11px] text-text-subtle file:mr-2 file:rounded-menuzia file:border-0 file:bg-primary file:px-2.5 file:py-1 file:text-[10px] file:font-semibold file:uppercase file:tracking-wide file:text-white"
      />
      {enviando && <p className="mt-1 text-[11px] text-text-subtle">Enviando…</p>}
      {url && (
        <div className="mt-2">
          {/* Miniatura no recorte real da vitrine, com o foco aplicado: é a
              prévia do que o cliente vai ver, não uma segunda cópia da foto. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt=""
            className={`${proporcaoPrevia} w-full rounded-menuzia border border-border object-cover`}
            style={{ objectPosition: objectPosition(foco) }}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <AjustarFoco
              src={url}
              foco={foco}
              onChange={onFoco}
              proporcoes={proporcoes}
              titulo={tituloModal}
              descricao={descricaoModal}
            />
            <button
              type="button"
              onClick={onRemover}
              className="text-[11px] font-semibold uppercase tracking-wide text-danger"
            >
              Remover foto
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Proporções reais em que cada foto de categoria é recortada na vitrine.
// O cartão é fixo em 5:2 em qualquer largura. A ficha varia: `h-[42vh]` num
// contêiner de até 600 px dá ≈1,1:1 num celular comum, e o desktop é 520×260.
const PROPORCOES_CARTAO = [{ rotulo: 'Cartão', ratio: 2.5 }]
const PROPORCOES_FICHA = [{ rotulo: 'Celular', ratio: 1.1 }, { rotulo: 'Computador', ratio: 2 }]

// ─── Item-level sub-components ───────────────────────────────────────────────

/**
 * Estrela do favorito, agora clicável na própria lista (antes só pelo formulário do item).
 * Favorito aparece como "★ Favorito" na vitrine e nos QR; não muda a posição do item.
 */
function BotaoFavorito({ item, salvando, desabilitado, onAlternar }: { item: ItemCardapio; salvando: boolean; desabilitado: boolean; onAlternar: () => void }) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      disabled={salvando || desabilitado}
      aria-pressed={item.maisVendido}
      aria-label={item.maisVendido ? `Remover ${item.nome} dos favoritos` : `Marcar ${item.nome} como favorito`}
      title={item.maisVendido ? 'Favorito — clique para remover' : 'Marcar como favorito'}
      data-testid="favorito-item"
      className="toque-icone flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[4px] hover:bg-[#FEF3C7] disabled:opacity-50"
    >
      <Star className={`h-4 w-4 ${item.maisVendido ? 'fill-[#F59E0B] text-[#F59E0B]' : 'text-[#C2CBD6]'}`} strokeWidth={2} aria-hidden="true" />
    </button>
  )
}

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
            // 21px no desktop é alvo de mouse; no dedo erra o dia vizinho. Abaixo de
            // `lg` a pílula cresce nos dois eixos (a de altura vem da camada do painel).
            'flex h-6 w-6 max-lg:h-10 max-lg:w-10 max-lg:text-[13px] select-none items-center justify-center rounded-menuzia border text-[11px] font-bold transition-colors',
            active.has(day)
              ? 'border-[var(--adm-azul)] bg-[var(--adm-azul)] text-white'
              : 'border-border bg-white text-text-subtle hover:border-[var(--adm-azul)]',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
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
  const [pausaSavingId, setPausaSavingId] = useState<string | null>(null)

  /** Ação rápida: pausa/retoma um complemento do item (pausado some da vitrine). */
  async function togglePausadoComp(comp: ComplementoItem) {
    if (pausaSavingId) return
    setPausaSavingId(comp.id)
    try {
      await atualizarComplemento(supabase, comp.id, { nome: comp.nome, preco: comp.preco, imagemUrl: comp.imagemUrl, pausado: !comp.pausado })
      await onRefresh()
    } catch { /* silencioso */ }
    finally { setPausaSavingId(null) }
  }

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
          <div
            key={comp.id}
            className={`flex items-center gap-2 border-b border-border py-1.5 last:border-none ${comp.pausado ? 'opacity-60' : ''}`}
          >
            <div className="relative h-9 w-9 flex-shrink-0">
              <label className="relative h-9 w-9 flex-shrink-0 cursor-pointer overflow-hidden rounded-menuzia border border-border bg-page block">
                {comp.imagemUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={comp.imagemUrl} alt={comp.nome} loading="lazy" decoding="async" className="h-full w-full object-cover" />
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
                      const url = await enviarImagemItem(supabase, restauranteId, file, 'thumb')
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
            {comp.pausado && (
              <span className="flex-shrink-0 rounded-menuzia bg-warn-bg px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warn">
                Pausado
              </span>
            )}
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
              onClick={() => togglePausadoComp(comp)}
              disabled={pausaSavingId === comp.id}
              title={comp.pausado ? 'Retomar complemento' : 'Pausar complemento'}
              className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {comp.pausado
                ? <Play className="h-[13px] w-[13px]" strokeWidth={2} />
                : <Pause className="h-[13px] w-[13px]" strokeWidth={2} />}
            </button>
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

/**
 * Preço na lista do gestor. Pizza e item com tamanho não têm preço-base de verdade:
 * mostrar "R$ 0,00" assustava. Vira "a partir de", a mesma regra do painel do garçom.
 */
function PrecoDaLista({ item }: { item: ItemCardapio }) {
  const p = precoDeVitrine(item)
  if (!p.aPartirDe) return <>R$ {p.valor.toFixed(2).replace('.', ',')}</>
  if (!(p.valor > 0)) return <span className="text-[12px] font-semibold text-[#92400E]">Sem preço</span>
  return <><span className="text-[11px] font-normal">a partir de </span>R$ {p.valor.toFixed(2).replace('.', ',')}</>
}

/** Cabeçalho de seção do formulário de item. */
function SectionHeader({ children }: { children: string }) {
  return (
    <div className="-mx-4.5 mb-3 mt-1 border-b border-[var(--adm-borda)] px-4.5 pb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--adm-texto-medio)]">
      {children}
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

  // Aba na URL (?tab=), como na Logística: recarregar ou mandar o link abre a mesma aba.
  const [cardapioTab, setCardapioTab] = useState<AbaCardapio>('itens')
  useEffect(() => {
    setCardapioTab(abaDaUrl(new URLSearchParams(window.location.search).get('tab')))
  }, [])
  function irParaAba(aba: AbaCardapio) {
    setCardapioTab(aba)
    const url = new URL(window.location.href)
    if (aba === 'itens') url.searchParams.delete('tab')
    else url.searchParams.set('tab', aba)
    // replaceState: trocar de aba não merece entrada no histórico nem remontar a página.
    window.history.replaceState(null, '', url)
  }
  // Papel de quem está logado: só dono/gerente mexem nos catálogos da loja (0066).
  // Enquanto não sabe, mostra — o erro de permissão aparece na tela se for o caso.
  const [papel, setPapel] = useState<string | null>(null)
  useEffect(() => {
    let ativo = true
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user || !ativo) return
      const { data: u } = await supabase.from('usuarios').select('papel').eq('id', data.user.id).maybeSingle()
      if (ativo && u) setPapel(u.papel as string)
    })
    return () => { ativo = false }
  }, [supabase])
  const podeEditarCatalogo = papel === null || pode(papel, 'cardapio.editar')
  // Item novo de marmita/açaí nasce pausado até ganhar um tamanho com preço.
  const [pausadoAteTerPreco, setPausadoAteTerPreco] = useState(false)
  const [avisoItem, setAvisoItem] = useState<string | null>(null)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [schedulingGroupId, setSchedulingGroupId] = useState<string | null>(null)
  const [scheduleForm, setScheduleForm] = useState({ ativo: false, inicio: '11:00', fim: '15:00' })
  // Foto/foco da categoria em edição — preenchidos em startEditCategoria e
  // zerados ao abrir o drawer de categoria nova, pra não vazar entre categorias.
  const [catImagemUrl, setCatImagemUrl] = useState<string | null>(null)
  const [catFoco, setCatFoco] = useState<Foco>(FOCO_PADRAO)
  const [catEnviando, setCatEnviando] = useState(false)
  // Segunda foto da categoria: a que abre no topo da ficha quando a categoria
  // tem um item só. Opcional — sem ela a ficha usa a foto do cartão. Estado e
  // geração próprios, pra que subir uma não atrapalhe o upload da outra.
  const [catFichaUrl, setCatFichaUrl] = useState<string | null>(null)
  const [catFichaFoco, setCatFichaFoco] = useState<Foco>(FOCO_PADRAO)
  const [catFichaEnviando, setCatFichaEnviando] = useState(false)
  const uploadFichaGenRef = useRef(0)
  // Espelha editingGroupId "ao vivo" pro upload de foto da categoria conferir, na
  // hora que a Promise resolve, se ainda é a mesma categoria em edição. Ler
  // editingGroupId direto de dentro do onChange (closure) ficaria congelado no
  // valor de quando o upload começou — a ref é a única forma de pegar o valor
  // atual depois de um await.
  const editingGroupIdRef = useRef<string | null>(null)
  useEffect(() => { editingGroupIdRef.current = editingGroupId }, [editingGroupId])
  // Conta uploads de foto de categoria. O id sozinho não distingue duas fotos
  // enviadas em sequência pra MESMA categoria: se a primeira demorar mais que a
  // segunda, ela resolveria depois e "venceria" por engano, mesmo já superada.
  // Cada upload trava a geração vigente no início; só quem ainda for a mais
  // recente no fim tem permissão de escrever o resultado.
  const uploadGenRef = useRef(0)
  const [view, setView] = useState<View>('table')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [bulkTarget, setBulkTarget] = useState<BulkUploadTarget | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusSavingId, setStatusSavingId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')

  const [form, setForm] = useState<ItemFormState>(blankForm(null))

  // State for creating a new complement group inside the item drawer
  const [creatingGrupo, setCreatingGrupo] = useState(false)
  const [newGrupoForm, setNewGrupoForm] = useState({ nome: '', obrigatorio: false, min: 0, max: 1 })
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
        setGroups(ordenar(gruposData))
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

  // Na ordem do Gestor (0101) — a mesma que a vitrine e os QR mostram.
  const visibleItems = useMemo(
    () => ordenar(items.filter((item) => item.grupoId === activeGroupId && item.nome.toLowerCase().includes(search.toLowerCase()))),
    [items, activeGroupId, search]
  )

  // ── Ordem por arraste ─────────────────────────────────────────────────────
  // Com busca, a lista na tela é só parte da categoria: gravar a ordem dela seria
  // ambíguo (onde entram os escondidos?). O arraste fica desligado, com o motivo.
  const buscaAtiva = search.trim() !== ''
  const [avisoOrdem, setAvisoOrdem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [salvandoOrdem, setSalvandoOrdem] = useState(false)
  useEffect(() => {
    if (avisoOrdem?.tipo !== 'ok') return
    const t = setTimeout(() => setAvisoOrdem(null), 2500)
    return () => clearTimeout(t)
  }, [avisoOrdem])

  async function salvarOrdemItens(nova: string[]) {
    if (!activeGroupId) return
    const antes = items
    const pos = new Map(nova.map((id, i) => [id, i]))
    // Otimista: a lista já fica na ordem nova; volta se o servidor recusar.
    setItems((prev) => prev.map((i) => (pos.has(i.id) ? { ...i, posicao: pos.get(i.id) } : i)))
    setSalvandoOrdem(true)
    const r = await salvarOrdemCardapio({ tipo: 'itens', grupoId: activeGroupId, ids: nova })
    setSalvandoOrdem(false)
    if (r.ok) {
      setAvisoOrdem({ tipo: 'ok', texto: 'Ordem salva. Vitrine e QR já mostram assim.' })
      return
    }
    setItems(antes)
    setAvisoOrdem({ tipo: 'erro', texto: r.erro })
    if (r.codigo === 'ordem_desatualizada') await refreshItems().catch(() => {})
  }

  async function salvarOrdemCategorias(nova: string[]) {
    const antes = groups
    const porId = new Map(groups.map((g) => [g.id, g]))
    setGroups(nova.map((id, i) => ({ ...porId.get(id)!, posicao: i })))
    setSalvandoOrdem(true)
    const r = await salvarOrdemCardapio({ tipo: 'categorias', ids: nova })
    setSalvandoOrdem(false)
    if (r.ok) {
      setAvisoOrdem({ tipo: 'ok', texto: 'Ordem das categorias salva.' })
      return
    }
    setGroups(antes)
    setAvisoOrdem({ tipo: 'erro', texto: r.erro })
    if (r.codigo === 'ordem_desatualizada' && restauranteId) {
      await listarGrupos(supabase, restauranteId).then((g) => setGroups(ordenar(g))).catch(() => {})
    }
  }

  const ordemItens = useOrdenacaoArrastavel({
    ids: visibleItems.map((i) => i.id),
    onSoltar: (nova) => void salvarOrdemItens(nova),
    desabilitado: buscaAtiva || salvandoOrdem || !podeEditarCatalogo,
    rotulo: (id) => items.find((i) => i.id === id)?.nome ?? 'item',
  })
  const itensNaOrdem = useMemo(() => {
    const porId = new Map(visibleItems.map((i) => [i.id, i]))
    return ordemItens.ordem.map((id) => porId.get(id)).filter((i): i is ItemCardapio => !!i)
  }, [visibleItems, ordemItens.ordem])

  const ordemCategorias = useOrdenacaoArrastavel({
    ids: groups.map((g) => g.id),
    onSoltar: (nova) => void salvarOrdemCategorias(nova),
    desabilitado: salvandoOrdem || !podeEditarCatalogo || editingGroupId !== null || schedulingGroupId !== null,
    rotulo: (id) => groups.find((g) => g.id === id)?.nome ?? 'categoria',
  })
  const categoriasNaOrdem = useMemo(() => {
    const porId = new Map(groups.map((g) => [g.id, g]))
    return ordemCategorias.ordem.map((id) => porId.get(id)).filter((g): g is GrupoCardapio => !!g)
  }, [groups, ordemCategorias.ordem])

  /** Favorito: só a coluna, sem reescrever o item nem mexer na posição. */
  const [favoritoSalvandoId, setFavoritoSalvandoId] = useState<string | null>(null)
  async function alternarFavorito(item: ItemCardapio) {
    if (favoritoSalvandoId) return
    const novo = !item.maisVendido
    setFavoritoSalvandoId(item.id)
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, maisVendido: novo } : i)))
    try {
      await definirFavorito(supabase, item.id, novo)
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, maisVendido: !novo } : i)))
      setError('Não foi possível salvar o favorito.')
    } finally {
      setFavoritoSalvandoId(null)
    }
  }

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
    setPausadoAteTerPreco(false)
    setAvisoItem(null)
    setDrawer('edit')
  }

  function openEditItem(item: ItemCardapio) {
    setForm(formFromItem(item))
    setCreatingGrupo(false)
    setNewGrupoForm({ nome: '', obrigatorio: false, min: 0, max: 1 })
    // açaí/sized: item simples que já tem tamanhos cadastrados
    setTemTamanhos(item.tipoItem === 'simples' && item.tamanhos.length > 0)
    setFormStep(1)
    setPausadoAteTerPreco(false)
    setAvisoItem(null)
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
      // Gera full + miniatura numa operação só. Se a thumb falhar, vem null e a
      // listagem cai no fallback — o cadastro não é bloqueado por causa dela.
      const { url, thumbUrl } = await enviarImagemItemComThumb(supabase, restauranteId, file)
      setForm((prev) => ({ ...prev, imagemUrl: url, imagemThumbUrl: thumbUrl }))
    } catch {
      setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
    } finally {
      setUploading(false)
    }
  }

  const temVariacoes = form.tipoItem === 'pizza' || form.tipoItem === 'marmita' || (form.tipoItem === 'simples' && temTamanhos)

  /** Salva o item (create ou update). `fechar` controla se o drawer fecha — o wizard salva a cada etapa sem fechar. */
  async function saveItem(fechar = true): Promise<boolean> {
    if (!restauranteId || !form.nome.trim()) return false
    // Item de graça na vitrine e "promoção" sem desconto: dois cadastros que o
    // cliente sente antes do lojista perceber (lib/item-cadastro.ts).
    // Tamanho a R$ 0 não conta: o tamanho substitui o preço-base, então marmita só
    // com tamanhos zerados sai de graça do mesmo jeito (lib/item-cadastro.ts).
    const tamanhosAtuais = form.id ? items.find((i) => i.id === form.id)?.tamanhos ?? [] : []
    const validar = {
      preco: parsePreco(form.preco),
      promocaoPreco: form.promocaoPreco.trim() ? parsePreco(form.promocaoPreco) : null,
      tipoItem: form.tipoItem,
      qtdTamanhos: tamanhosAtuais.filter((t) => t.preco > 0).length,
      status: form.status,
    }
    // Marmita/açaí NOVO sem preço: grava pausado em vez de travar — o tamanho só
    // pode ser cadastrado depois que o item existe.
    const inicial = form.id ? { status: form.status, pausadoAteTerPreco: false } : statusAoCriarItem({ ...validar, cobraPorTamanho: temVariacoes })
    const problema = erroDoItem({ ...validar, status: inicial.status })
    if (problema) {
      setError(problema)
      return false
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        grupoId: form.grupoId,
        nome: form.nome.trim(),
        descricao: form.descricao.trim(),
        preco: parsePreco(form.preco),
        status: inicial.status as StatusItem,
        diasDisponiveis: form.diasDisponiveis,
        promocaoPreco: form.promocaoPreco.trim() ? parsePreco(form.promocaoPreco) : null,
        maisVendido: form.maisVendido,
        tag: form.tag,
        tipoItem: form.tipoItem,
        disponivelDelivery: form.disponivelDelivery,
        disponivelSalao: form.disponivelSalao,
      }
      if (form.id) {
        const updated = await atualizarItem(supabase, form.id, { ...payload, imagemUrl: form.imagemUrl, imagemThumbUrl: form.imagemThumbUrl })
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      } else {
        const created = await criarItem(supabase, restauranteId, payload)
        let final = created
        if (form.imagemUrl) {
          final = await atualizarItem(supabase, created.id, { ...payload, imagemUrl: form.imagemUrl, imagemThumbUrl: form.imagemThumbUrl })
        }
        setItems((prev) => [...prev, final])
        // Update form with the new item id so complementos can be added
        setForm((prev) => ({ ...prev, id: final.id, status: final.status }))
        if (inicial.pausadoAteTerPreco) {
          setPausadoAteTerPreco(true)
          setAvisoItem('Item salvo como PAUSADO: ele volta a aparecer quando tiver um tamanho com preço.')
        }
      }
      if (fechar) setDrawer(null)
      return true
    } catch (e) {
      setError(mensagemErroCardapio(e, 'Não foi possível salvar o item. Tente novamente.'))
      return false
    } finally {
      setSaving(false)
    }
  }

  // ── Navegação do wizard de cadastro ──────────────────────────────────────

  /** Avança pra próxima etapa; a etapa 1 salva o básico antes (cria o item se for novo). */
  async function wizardNext() {
    if (formStep === 1) {
      const ok = await saveItem(false)
      if (!ok) return
      setFormStep(temVariacoes ? 2 : 3)
      return
    }
    if (formStep === 2) {
      // Pausado só por falta de preço e agora com tamanho precificado: volta a vender.
      const precificado = (currentItem?.tamanhos ?? []).some((t) => t.preco > 0)
      if (pausadoAteTerPreco && precificado) {
        setForm((prev) => ({ ...prev, status: 'disponivel' }))
        setPausadoAteTerPreco(false)
        setAvisoItem('Pronto: com tamanho com preço, o item volta a ficar disponível ao concluir.')
      }
      setFormStep(3)
      return
    }
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

  /** Ação rápida da tabela: pausa um item disponível ou retoma um pausado/esgotado. */
  async function toggleItemStatus(item: ItemCardapio) {
    if (statusSavingId) return
    const novoStatus: StatusItem = item.status === 'disponivel' ? 'pausado' : 'disponivel'
    setStatusSavingId(item.id)
    try {
      await definirStatusEmLote(supabase, [item.id], novoStatus)
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: novoStatus } : i)))
    } catch {
      setError('Não foi possível atualizar o status do item.')
    } finally {
      setStatusSavingId(null)
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
    // A foto é obrigatória aqui: é ela que o modo gaveta mostra no cartão da
    // categoria, e sem ela o lojista só descobre o problema lá em Ajustes, na
    // hora em que o modo se recusa a ligar. O botão já fica desabilitado sem
    // foto; esta guarda é a que vale se alguém chamar a função por outro
    // caminho (Enter no campo do nome, por exemplo).
    if (!restauranteId || !newGroupName.trim() || !catImagemUrl) return
    try {
      const group = await criarGrupo(
        supabase,
        restauranteId,
        newGroupName.trim(),
        groups.length,
        { url: catImagemUrl, foco: catFoco },
        // Opcional: sem foto própria a ficha usa a do cartão.
        { url: catFichaUrl, foco: catFichaFoco },
      )
      setGroups((prev) => [...prev, group])
      setActiveGroup(group.nome)
      setNewGroupName('')
      setDrawer(null)
    } catch {
      setError('Não foi possível criar a categoria.')
    }
  }

  /**
   * Sobe uma foto de categoria e aterrissa no campo certo do formulário.
   *
   * `grupoId` null = drawer de categoria nova, onde não existe categoria pra
   * conferir. Com id, a resposta só escreve se a categoria em edição ainda for
   * a mesma: trocar de categoria no meio do upload não pode contaminar o
   * formulário da outra. A geração cobre o que o id não cobre — duas fotos do
   * MESMO campo em sequência, em que a primeira poderia demorar mais e vencer
   * a segunda. Cada campo tem a sua, pra que subir a foto do cartão não
   * invalide um upload da ficha em voo.
   */
  async function enviarFotoCategoria(file: File, grupoId: string | null, campo: 'cartao' | 'ficha') {
    if (!restauranteId) return
    const genRef = campo === 'cartao' ? uploadGenRef : uploadFichaGenRef
    const setEnviando = campo === 'cartao' ? setCatEnviando : setCatFichaEnviando
    const geracao = ++genRef.current
    const aindaVale = () =>
      (grupoId === null || grupoId === editingGroupIdRef.current) && geracao === genRef.current
    setEnviando(true)
    setError(null)
    try {
      const url = await enviarImagemCategoria(supabase, restauranteId, file)
      if (!aindaVale()) return
      // Foto nova, enquadramento novo: o foco anterior foi escolhido pra outra
      // imagem e recortaria esta num ponto que ninguém pediu.
      if (campo === 'cartao') { setCatImagemUrl(url); setCatFoco(FOCO_PADRAO) }
      else { setCatFichaUrl(url); setCatFichaFoco(FOCO_PADRAO) }
    } catch {
      if (!aindaVale()) return
      setError('Não foi possível enviar a imagem da categoria. Tente novamente.')
    } finally {
      if (aindaVale()) setEnviando(false)
    }
  }

  function startEditCategoria(group: GrupoCardapio) {
    setEditingGroupId(group.id)
    setEditingGroupName(group.nome)
    setCatImagemUrl(group.imagemUrl)
    setCatFoco(group.imagemFoco)
    setCatFichaUrl(group.imagemFichaUrl)
    setCatFichaFoco(group.imagemFichaFoco)
    // Se um upload de OUTRA categoria (ou um upload abandonado desta mesma
    // categoria, de antes de fechar e reabrir a caixa) ainda estiver em voo, sua
    // resolução vai se recusar a mexer nesse estado (guardas por id e por geração
    // em cima), então "Enviando…" nunca mais se apagaria sozinho sem esse reset.
    setCatEnviando(false)
    setCatFichaEnviando(false)
    uploadFichaGenRef.current += 1
    // Avança a geração: invalida qualquer upload capturado antes deste ponto,
    // mesmo que seja da mesma categoria — sem isso, reabrir a caixa e mandar uma
    // foto nova não bastaria pra livrar o formulário de um upload velho ainda
    // em voo (o guard por id sozinho não distingue duas fotos da mesma categoria).
    uploadGenRef.current += 1
  }

  /** Abre o drawer de categoria nova — sempre sem foto, pra não herdar a da última categoria editada. */
  function openCreateCategoria() {
    setCatImagemUrl(null)
    setCatFoco(FOCO_PADRAO)
    setCatEnviando(false)
    setCatFichaUrl(null)
    setCatFichaFoco(FOCO_PADRAO)
    setCatFichaEnviando(false)
    uploadFichaGenRef.current += 1
    // Invalida qualquer upload ainda em voo de uma sessão anterior do drawer
    // ou do formulário de edição: sem isso, uma foto abandonada poderia
    // aterrissar no formulário de categoria nova.
    uploadGenRef.current += 1
    setDrawer('categoria')
  }

  async function saveEditCategoria() {
    if (!editingGroupId || !editingGroupName.trim()) return
    try {
      // imagem sempre explícita aqui: o valor vem do form (carregado em
      // startEditCategoria), então renomear sem mexer na foto grava a mesma
      // foto de volta em vez de apagá-la.
      const updated = await atualizarGrupo(
        supabase,
        editingGroupId,
        editingGroupName.trim(),
        undefined,
        { url: catImagemUrl, foco: catFoco },
        { url: catFichaUrl, foco: catFichaFoco },
      )
      setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
      if (activeGroup && groups.find((g) => g.id === editingGroupId)?.nome === activeGroup) {
        setActiveGroup(updated.nome)
      }
      setEditingGroupId(null)
    } catch {
      setError('Não foi possível salvar a categoria.')
    }
  }

  function startScheduleCategoria(group: GrupoCardapio) {
    setSchedulingGroupId(group.id)
    setScheduleForm({
      ativo: !!(group.horarioAtivoInicio && group.horarioAtivoFim),
      inicio: group.horarioAtivoInicio ?? '11:00',
      fim: group.horarioAtivoFim ?? '15:00',
    })
  }

  async function saveScheduleCategoria() {
    if (!schedulingGroupId) return
    const group = groups.find((g) => g.id === schedulingGroupId)
    if (!group) return
    try {
      const updated = await atualizarGrupo(supabase, schedulingGroupId, group.nome, {
        horarioAtivoInicio: scheduleForm.ativo ? scheduleForm.inicio : null,
        horarioAtivoFim: scheduleForm.ativo ? scheduleForm.fim : null,
      })
      setGroups((prev) => prev.map((g) => (g.id === updated.id ? updated : g)))
      setSchedulingGroupId(null)
    } catch {
      setError('Não foi possível salvar o horário da categoria.')
    }
  }

  /** Move a categoria pra cima/baixo e persiste a nova ordem (vitrine e QR seguem essa ordem). */
  async function moveCategoria(group: GrupoCardapio, dir: -1 | 1) {
    const idx = groups.findIndex((g) => g.id === group.id)
    const alvo = idx + dir
    if (idx < 0 || alvo < 0 || alvo >= groups.length || salvandoOrdem) return
    const nova = groups.map((g) => g.id)
    ;[nova[idx], nova[alvo]] = [nova[alvo], nova[idx]]
    await salvarOrdemCategorias(nova)
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

  const activeGroupIdObj = groups.find((g) => g.nome === activeGroup) ?? null

  /** Ações da categoria: ordem, editar, horário, fotos em massa e excluir — tocáveis, não só no hover. */
  function acoesCategoria(group: GrupoCardapio, compacto = false) {
    const cls = compacto ? 'h-6 w-6 border-transparent bg-transparent' : ''
    const ic = compacto ? 'h-3 w-3' : 'h-3.5 w-3.5'
    return (
      <>
        <BotaoIcone rotulo="Subir categoria (ordem na vitrine)" className={cls} disabled={groups[0]?.id === group.id} onClick={() => moveCategoria(group, -1)}>
          <ArrowUp className={ic} />
        </BotaoIcone>
        <BotaoIcone rotulo="Descer categoria (ordem na vitrine)" className={cls} disabled={groups[groups.length - 1]?.id === group.id} onClick={() => moveCategoria(group, 1)}>
          <ArrowDown className={ic} />
        </BotaoIcone>
        <BotaoIcone rotulo="Editar categoria (nome e foto)" className={cls} onClick={() => startEditCategoria(group)}>
          <Pencil className={ic} />
        </BotaoIcone>
        <BotaoIcone rotulo="Horário automático da categoria" className={cls} onClick={() => startScheduleCategoria(group)}>
          <Clock className={ic} />
        </BotaoIcone>
        <BotaoIcone rotulo="Subir fotos em massa" className={cls} onClick={() => setBulkTarget({ tipo: 'item', grupoId: group.id, nome: group.nome })}>
          <Images className={ic} />
        </BotaoIcone>
        <BotaoIcone rotulo="Excluir categoria" perigo className={cls} onClick={() => deleteCategoria(group)}>
          <Trash2 className={ic} />
        </BotaoIcone>
      </>
    )
  }

  function formEdicaoCategoria(group: GrupoCardapio) {
    return (
                  <div className="space-y-2 rounded-menuzia border border-primary/40 bg-primary/5 px-2 py-2">
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={editingGroupName}
                        onChange={(e) => setEditingGroupName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !catEnviando && !catFichaEnviando) saveEditCategoria()
                          if (e.key === 'Escape') setEditingGroupId(null)
                        }}
                        className="flex-1 rounded-menuzia border border-primary px-2 py-1.5 text-sm outline-none"
                      />
                      {/* Desabilitado durante o upload: salvar nesse instante gravaria a foto de
                          antes do upload, sem nenhum aviso — o captured-id guard no onChange do
                          input de arquivo cobre o caso de trocar de categoria, mas aqui o risco é
                          salvar cedo demais na própria categoria em edição. */}
                      <button onClick={saveEditCategoria} disabled={catEnviando || catFichaEnviando} title="Salvar" className="rounded-menuzia px-1.5 py-1 text-primary-dark hover:bg-page disabled:opacity-30">✓</button>
                      <button onClick={() => setEditingGroupId(null)} title="Cancelar" className="rounded-menuzia px-1.5 py-1 text-text-subtle hover:bg-page">✕</button>
                    </div>
                    <CampoFotoCategoria
                      rotulo="Foto de capa"
                      obrigatoria
                      explicacao='Cartão da categoria na visualização “Gaveta”, onde o cliente escolhe a categoria antes dos produtos. Recortada em 5:2.'
                      proporcoes={PROPORCOES_CARTAO}
                      proporcaoPrevia="aspect-[5/2]"
                      tituloModal="Posição da foto do cartão"
                      descricaoModal="O cartão da categoria é recortado em 5:2. Marque o que não pode ser cortado."
                      url={catImagemUrl}
                      foco={catFoco}
                      enviando={catEnviando}
                      onArquivo={(file) => enviarFotoCategoria(file, group.id, 'cartao')}
                      onFoco={setCatFoco}
                      onRemover={() => { setCatImagemUrl(null); setCatFoco(FOCO_PADRAO) }}
                    />
                    <CampoFotoCategoria
                      rotulo="Foto da ficha"
                      explicacao='Topo da ficha quando a categoria tem um item só e abre direto. Sem ela, a ficha usa a foto do cartão.'
                      proporcoes={PROPORCOES_FICHA}
                      proporcaoPrevia="aspect-[1.1/1]"
                      tituloModal="Posição da foto da ficha"
                      descricaoModal="O topo da ficha é quase um retrato no celular e mais largo no computador. Marque o que não pode ser cortado."
                      url={catFichaUrl}
                      foco={catFichaFoco}
                      enviando={catFichaEnviando}
                      onArquivo={(file) => enviarFotoCategoria(file, group.id, 'ficha')}
                      onFoco={setCatFichaFoco}
                      onRemover={() => { setCatFichaUrl(null); setCatFichaFoco(FOCO_PADRAO) }}
                    />
                  </div>
    )
  }

  function formHorarioCategoria() {
    return (
                  <div className="space-y-1.5 rounded-menuzia border border-primary/40 bg-primary/5 px-2 py-2">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-text-main">
                      <input
                        type="checkbox"
                        checked={scheduleForm.ativo}
                        onChange={(e) => setScheduleForm((prev) => ({ ...prev, ativo: e.target.checked }))}
                      />
                      Ativar automaticamente por horário
                    </label>
                    {scheduleForm.ativo && (
                      <div className="flex items-center gap-1 text-xs">
                        <input
                          type="time"
                          value={scheduleForm.inicio}
                          onChange={(e) => setScheduleForm((prev) => ({ ...prev, inicio: e.target.value }))}
                          className="w-full rounded-menuzia border border-border px-1.5 py-1 text-xs outline-none focus:border-primary"
                        />
                        <span className="text-text-subtle">até</span>
                        <input
                          type="time"
                          value={scheduleForm.fim}
                          onChange={(e) => setScheduleForm((prev) => ({ ...prev, fim: e.target.value }))}
                          className="w-full rounded-menuzia border border-border px-1.5 py-1 text-xs outline-none focus:border-primary"
                        />
                      </div>
                    )}
                    <p className="text-[10px] leading-tight text-text-subtle">
                      {scheduleForm.ativo
                        ? 'Categoria só aparece na vitrine dentro desse horário (fuso de São Paulo).'
                        : 'Desativado: categoria sempre aparece na vitrine.'}
                    </p>
                    <div className="flex justify-end gap-1 pt-0.5">
                      <button onClick={() => setSchedulingGroupId(null)} className="rounded-menuzia px-2 py-1 text-[11px] font-semibold text-text-subtle hover:bg-white">Cancelar</button>
                      <button onClick={saveScheduleCategoria} className="rounded-menuzia bg-primary px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary-dark">Salvar</button>
                    </div>
                  </div>
    )
  }

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
            : 'Cardápio › Peça também'
        }
      />

      <AbasCardapio
        ativa={cardapioTab}
        onTrocar={irParaAba}
        contadores={{ itens: items.length, complementos: presets.length, tamanhos: tamanhosPizzaCatalogo.length + tamanhosMarmitaCatalogo.length }}
      />

      {/* ── Tab: Itens do cardápio ── */}
      <div className={cardapioTab !== 'itens' ? 'hidden' : 'flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 max-lg:overflow-y-auto max-lg:p-3'}>
        <FaixaErro mensagem={error} onFechar={() => setError(null)} className="flex-shrink-0" />

        {/* Celular/tablet: categorias em chips roláveis, sem ocupar meia tela. */}
        <div className="flex flex-shrink-0 flex-col gap-2 lg:hidden">
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categorias">
            {groups.map((group) => {
              const ativa = group.nome === activeGroup
              return (
                <button
                  key={group.id}
                  type="button"
                  role="tab"
                  aria-selected={ativa}
                  onClick={() => setActiveGroup(group.nome)}
                  className={`flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                    ativa ? 'border-[var(--adm-azul)] bg-[var(--adm-azul)] text-white' : 'border-[var(--adm-borda)] bg-white text-[var(--adm-texto-medio)]'
                  }`}
                >
                  {group.nome}
                  <span className={`rounded-full px-1.5 text-[11px] font-bold ${ativa ? 'bg-white/25 text-white' : 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]'}`}>{groupCounts.get(group.id) ?? 0}</span>
                </button>
              )
            })}
            <button
              type="button"
              onClick={openCreateCategoria}
              className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-[var(--adm-borda-forte)] bg-white px-3 py-1.5 text-[13px] font-semibold text-[var(--adm-azul)]"
            >
              <Plus className="h-3.5 w-3.5" /> Categoria
            </button>
          </div>
          {activeGroupIdObj && editingGroupId !== activeGroupIdObj.id && schedulingGroupId !== activeGroupIdObj.id && (
            <div className="flex items-center justify-end gap-2 rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)] bg-white px-3 py-1.5 sm:justify-between">
              <span className="min-w-0 truncate text-[12px] text-[var(--adm-texto-suave)] max-sm:hidden">
                Categoria <b className="text-[var(--adm-texto)]">{activeGroupIdObj.nome}</b>
                {activeGroupIdObj.horarioAtivoInicio && activeGroupIdObj.horarioAtivoFim ? ` · ${activeGroupIdObj.horarioAtivoInicio}–${activeGroupIdObj.horarioAtivoFim}` : ''}
              </span>
              <div className="flex flex-shrink-0 items-center gap-1">{acoesCategoria(activeGroupIdObj)}</div>
            </div>
          )}
          {activeGroupIdObj && editingGroupId === activeGroupIdObj.id && formEdicaoCategoria(activeGroupIdObj)}
          {activeGroupIdObj && schedulingGroupId === activeGroupIdObj.id && formHorarioCategoria()}
        </div>

        <div className="flex min-h-0 flex-1 gap-4 max-lg:flex-none">
          {/* Categorias (desktop) */}
          <aside className="flex w-[260px] flex-shrink-0 flex-col overflow-hidden rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)] bg-white max-lg:hidden">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--adm-borda)] px-3.5 py-2.5">
              <h3 className="flex items-center gap-2 text-[13px] font-bold text-[var(--adm-texto-forte)]">
                Categorias
                <span className="rounded-full bg-[#f1f2f4] px-2 py-[1px] text-[11px] font-bold text-[var(--adm-texto-medio)]">{groups.length}</span>
              </h3>
              <button type="button" onClick={openCreateCategoria} className="flex items-center gap-1 rounded-[4px] px-2 py-1 text-[12px] font-semibold text-[var(--adm-azul)] hover:bg-[var(--adm-azul-claro)]">
                <Plus className="h-3.5 w-3.5" /> Nova
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {groups.length === 0 && (
                <div className="px-2 py-6 text-center text-xs text-text-subtle">Nenhuma categoria cadastrada ainda.</div>
              )}
              {categoriasNaOrdem.map((group) =>
                editingGroupId === group.id ? (
                  <div key={group.id}>{formEdicaoCategoria(group)}</div>
                ) : schedulingGroupId === group.id ? (
                  <div key={group.id}>{formHorarioCategoria()}</div>
                ) : (
                  <div
                    key={group.id}
                    ref={ordemCategorias.refDoItem(group.id)}
                    style={ordemCategorias.estiloDoItem(group.id)}
                    data-categoria-ordem={group.id}
                    className={[
                      'group mb-0.5 flex w-full items-center justify-between gap-1 rounded-[4px] border-l-[3px] pl-0.5 pr-1 text-left text-[13px] transition-colors',
                      ordemCategorias.arrastando === group.id ? 'bg-white' : '',
                      group.nome === activeGroup
                        ? 'border-l-[var(--adm-azul)] bg-[var(--adm-azul-claro)] font-semibold text-[var(--adm-azul-escuro)]'
                        : 'border-l-transparent font-medium text-[var(--adm-texto)] hover:bg-[var(--adm-hover)]',
                    ].join(' ')}
                  >
                    <span
                      {...ordemCategorias.propsDaAlca(group.id)}
                      title="Arraste para mudar a ordem da categoria (ou use as setas)"
                      className="flex h-7 w-5 flex-shrink-0 items-center justify-center rounded-[3px] text-[var(--adm-texto-suave)] outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)]"
                    >
                      <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <button onClick={() => setActiveGroup(group.nome)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left">
                      <span className="truncate">{group.nome}</span>
                      {group.horarioAtivoInicio && group.horarioAtivoFim && (
                        <Clock className="h-3.5 w-3.5 flex-shrink-0 text-[var(--adm-azul)]" aria-label={`Ativa das ${group.horarioAtivoInicio} às ${group.horarioAtivoFim}`} />
                      )}
                      <span className={['ml-auto rounded-full px-2 py-[1px] text-[11px] font-bold', group.nome === activeGroup ? 'bg-white text-[var(--adm-azul-escuro)]' : 'bg-[#f1f2f4] text-[var(--adm-texto-medio)]'].join(' ')}>
                        {groupCounts.get(group.id) ?? 0}
                      </span>
                    </button>
                    {/* Ações sempre visíveis na categoria aberta; nas outras, ao passar o mouse
                        ou focar pelo teclado (antes só existiam no hover). */}
                    <span className={`flex flex-shrink-0 items-center gap-0.5 ${group.nome === activeGroup ? '' : 'opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100'}`}>
                      {group.nome === activeGroup ? acoesCategoria(group, true) : (
                        <button type="button" onClick={() => startEditCategoria(group)} title="Editar categoria" aria-label={`Editar ${group.nome}`} className="toque-icone flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--adm-texto-suave)] hover:bg-white hover:text-[var(--adm-azul)]">
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  </div>
                )
              )}
            </div>
          </aside>

          {/* Itens */}
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)] bg-white max-lg:overflow-visible">
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--adm-borda)] px-3.5 py-2.5">
              <div className="mr-auto min-w-0">
                <h2 className="truncate text-[14px] font-bold text-[var(--adm-texto-forte)]">{activeGroup ?? 'Sem categoria'}</h2>
                <p className="text-[11.5px] text-[var(--adm-texto-suave)]">
                  {visibleItems.length} {visibleItems.length === 1 ? 'item' : 'itens'}
                  {selected.size > 0 && <> · <b className="text-[var(--adm-azul)]">{selected.size} selecionado(s)</b></>}
                </p>
              </div>
              <div className="relative min-w-[180px] flex-1 sm:max-w-[260px] max-sm:order-last max-sm:basis-full">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--adm-texto-suave)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar item…"
                  aria-label="Buscar item pelo nome"
                  className="w-full rounded-[4px] border border-[var(--adm-borda)] bg-white py-1.5 pl-8 pr-2.5 text-[13px] text-[var(--adm-texto)] outline-none focus:border-[var(--adm-azul)]"
                />
              </div>
              {/* No celular a lista é sempre em cartões — a tabela não cabe —, então o
                  par de botões some para não prometer uma visão que não existe lá. */}
              <div className="flex overflow-hidden rounded-[4px] border border-[var(--adm-borda)] bg-white max-lg:hidden">
                <button type="button" onClick={() => setView('table')} title="Tabela" aria-pressed={view === 'table'}
                  className={`flex items-center px-2.5 py-1.5 ${view === 'table' ? 'bg-[var(--adm-azul)] text-white' : 'text-text-subtle'}`}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 5h18v2H3zm0 6h18v2H3zm0 6h18v2H3z" /></svg>
                </button>
                <button type="button" onClick={() => setView('grid')} title="Grade" aria-pressed={view === 'grid'}
                  className={`flex items-center px-2.5 py-1.5 ${view === 'grid' ? 'bg-[var(--adm-azul)] text-white' : 'text-text-subtle'}`}>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z" /></svg>
                </button>
              </div>
              {selected.size > 0 && (
                <div className="relative">
                  <Button variant="secondary" onClick={() => setActionsOpen((open) => !open)}>
                    Ação
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current"><path d="M7 10l5 5 5-5z" /></svg>
                  </Button>
                  {actionsOpen && (
                    <div className="absolute right-0 top-[calc(100%+4px)] z-40 min-w-[160px] rounded-menuzia border border-border bg-white p-1 shadow-xl">
                      <button onClick={() => applyBulkStatus('disponivel')} className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page">Deixar disponível</button>
                      <button onClick={() => applyBulkStatus('pausado')} className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page">Pausar</button>
                      <button onClick={() => applyBulkStatus('esgotado')} className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-text-main hover:bg-page">Esgotar</button>
                      <button onClick={deleteSelected} className="flex w-full items-center gap-2.5 rounded-menuzia px-2.5 py-2 text-left text-[13px] font-medium text-danger hover:bg-page">Excluir</button>
                    </div>
                  )}
                </div>
              )}
              <Button variant="primary" onClick={openNewItem} disabled={!activeGroupId} data-testid="novo-item">
                <Plus className="h-3.5 w-3.5" /> Novo item
              </Button>
            </div>
            {/* Retorno da ordem: discreto, some sozinho quando deu certo. O erro fica até
                a próxima ação — a lista já voltou para a ordem salva. */}
            <div className="px-3.5" aria-live="polite">
              {avisoOrdem ? (
                <p data-testid="aviso-ordem" className={`py-1.5 text-[12px] font-semibold ${avisoOrdem.tipo === 'ok' ? 'text-status-ready' : 'text-danger'}`}>
                  {avisoOrdem.texto}
                </p>
              ) : activeGroupId && visibleItems.length > 1 ? (
                <p data-testid="dica-ordem" className="py-1.5 text-[11.5px] text-[var(--adm-texto-suave)]">
                  {buscaAtiva
                    ? 'Com a busca ativa a ordem não pode ser alterada. Limpe a busca para arrastar.'
                    : 'Arraste pela alça ⋮⋮ para mudar a ordem na vitrine e nos QR Codes. No teclado: foque a alça e use as setas.'}
                </p>
              ) : null}
              <span className="sr-only">{ordemItens.aviso || ordemCategorias.aviso}</span>
            </div>
            <div className="flex-1 overflow-y-auto max-lg:overflow-visible">
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
              {/* `lg:contents` deixa a tabela no lugar dela no desktop; abaixo de `lg` o
                  bloco some inteiro e quem aparece é a grade de cartões logo abaixo. */}
              {activeGroupId && visibleItems.length > 0 && view === 'table' && (
                <div className="hidden lg:contents">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th className="sticky top-0 w-8 border-b border-border bg-[#F9FAFB] py-2.5 pl-2 pr-0"><span className="sr-only">Ordem</span></th>
                      <th className="sticky top-0 w-9 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5">
                        <input type="checkbox" aria-label="Selecionar todos os itens da lista" className="h-4 w-4 accent-primary" checked={allSelected} onChange={toggleAll} />
                      </th>
                      <th className="sticky top-0 border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Item</th>
                      <th className="sticky top-0 w-[120px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Preço</th>
                      <th className="sticky top-0 w-[230px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Disponibilidade</th>
                      <th className="sticky top-0 w-[110px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Status</th>
                      <th className="sticky top-0 w-[90px] border-b border-border bg-[#F9FAFB] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {itensNaOrdem.map((item) => (
                      <tr
                        key={item.id}
                        ref={ordemItens.refDoItem(item.id)}
                        style={ordemItens.estiloDoItem(item.id)}
                        data-item-ordem={item.id}
                        className={ordemItens.arrastando === item.id ? 'bg-white' : selected.has(item.id) ? 'bg-primary/10' : 'hover:bg-[#F9FAFB]'}
                      >
                        <td className="border-b border-border py-3 pl-2 pr-0">
                          <span
                            {...ordemItens.propsDaAlca(item.id)}
                            title={buscaAtiva ? 'Limpe a busca para reordenar' : 'Arraste para mudar a ordem (ou use as setas)'}
                            className={`flex h-8 w-7 items-center justify-center rounded-[4px] text-[var(--adm-texto-suave)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)] ${buscaAtiva ? 'opacity-30' : 'hover:bg-[#EEF2F6] hover:text-[var(--adm-texto)]'}`}
                          >
                            <GripVertical className="h-4 w-4" aria-hidden="true" />
                          </span>
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <input type="checkbox" aria-label={`Selecionar ${item.nome}`} className="h-4 w-4 accent-primary" checked={selected.has(item.id)} onChange={() => toggleRow(item.id)} />
                        </td>
                        <td className="border-b border-border px-3.5 py-3">
                          <div className="flex items-center gap-3">
                            <ItemThumb item={item} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <BotaoFavorito item={item} salvando={favoritoSalvandoId === item.id} desabilitado={!podeEditarCatalogo} onAlternar={() => alternarFavorito(item)} />
                                <span className="text-[13px] font-semibold">{item.nome}</span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-text-subtle">{descricaoEmTextoPuro(item.descricao)}</div>
                              {/* Mesmo alerta da grade: a tabela é a visão padrão no
                                  desktop, e é nela que o lojista passa o olho. */}
                              {(() => {
                                const aviso = avisoDoItem({
                                  preco: item.preco,
                                  promocaoPreco: item.promocaoPreco,
                                  tipoItem: item.tipoItem,
                                  qtdTamanhos: item.tamanhos.filter((t) => t.preco > 0).length,
                                  qtdTamanhosSemPreco: item.tamanhos.filter((t) => !(t.preco > 0)).length,
                                  status: item.status,
                                })
                                return aviso ? (
                                  <p className="mt-1 inline-block rounded-menuzia bg-warn-bg px-1.5 py-0.5 text-[11px] font-semibold text-warn">{aviso}</p>
                                ) : null
                              })()}
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
                            <PrecoDaLista item={item} />
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
                          <div className="flex items-center gap-1.5">
                            <button onClick={() => openEditItem(item)} title="Editar"
                              className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary">
                              <svg viewBox="0 0 24 24" className="h-[15px] w-[15px] fill-current">
                                <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 000-1.41l-2.34-2.34a1 1 0 00-1.41 0l-1.83 1.83 3.75 3.75z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => toggleItemStatus(item)}
                              disabled={statusSavingId === item.id}
                              title={item.status === 'disponivel' ? 'Pausar item' : 'Retomar item'}
                              className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {item.status === 'disponivel'
                                ? <Pause className="h-[15px] w-[15px]" strokeWidth={2} />
                                : <Play className="h-[15px] w-[15px]" strokeWidth={2} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              {activeGroupId && visibleItems.length > 0 && (
                <div className={`grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5 p-4 ${view === 'table' ? 'lg:hidden' : ''}`}>
                  {itensNaOrdem.map((item) => (
                    <div
                      key={item.id}
                      ref={ordemItens.refDoItem(item.id)}
                      style={ordemItens.estiloDoItem(item.id)}
                      data-item-ordem={item.id}
                      className="flex flex-col overflow-hidden rounded-menuzia border border-border bg-white"
                    >
                      <div className="relative flex h-[120px] items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                        {(item.imagemThumbUrl ?? item.imagemUrl)
                          // Card de 120px de altura: miniatura basta.
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={item.imagemThumbUrl ?? item.imagemUrl!} alt={item.nome} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                          : <svg viewBox="0 0 24 24" className="h-[46px] w-[46px] fill-text-subtle/50"><path d="M12 6c-3.87 0-7 2.46-7 5.5 0 .5.09.98.26 1.43.07.2.27.32.49.27.21-.05.34-.26.3-.47A4 4 0 017 11.5C7 9.57 9.24 8 12 8s5 1.57 5 3.5c0 .42-.07.82-.2 1.2-.05.21.08.42.29.47.22.05.42-.07.49-.27.17-.45.26-.93.26-1.4C19 8.46 15.87 6 12 6zM4 15h16v2H4zm0 3h16v2H4z" /></svg>
                        }
                        {item.status !== 'disponivel' && <div className="absolute left-2 top-2"><StatusBadge status={item.status} /></div>}
                      </div>
                      <div className="flex flex-1 flex-col gap-1.5 p-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            {...ordemItens.propsDaAlca(item.id)}
                            title={buscaAtiva ? 'Limpe a busca para reordenar' : 'Arraste para mudar a ordem (ou use as setas)'}
                            className={`-ml-1 flex h-9 w-8 flex-shrink-0 items-center justify-center rounded-[4px] text-[var(--adm-texto-suave)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--adm-azul)] ${buscaAtiva ? 'opacity-30' : 'hover:bg-[#EEF2F6]'}`}
                          >
                            <GripVertical className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <BotaoFavorito item={item} salvando={favoritoSalvandoId === item.id} desabilitado={!podeEditarCatalogo} onAlternar={() => alternarFavorito(item)} />
                          <div className="text-sm font-semibold">{item.nome}</div>
                        </div>
                        <div className="flex-1 text-xs leading-relaxed text-text-subtle">{descricaoEmTextoPuro(item.descricao)}</div>
                        {/* Cadastro que o cliente sente antes do lojista perceber: item de
                            graça na vitrine, promoção que não desconta (lib/item-cadastro.ts). */}
                        {(() => {
                          const aviso = avisoDoItem({
                            preco: item.preco,
                            promocaoPreco: item.promocaoPreco,
                            tipoItem: item.tipoItem,
                            qtdTamanhos: item.tamanhos.filter((t) => t.preco > 0).length,
                                  qtdTamanhosSemPreco: item.tamanhos.filter((t) => !(t.preco > 0)).length,
                            status: item.status,
                          })
                          return aviso ? (
                            <p className="rounded-menuzia bg-warn-bg px-2 py-1 text-[11px] font-semibold leading-snug text-warn">{aviso}</p>
                          ) : null
                        })()}
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
                              <PrecoDaLista item={item} />
                            </span>
                          )}
                          <button onClick={() => openEditItem(item)} aria-label={`Editar ${item.nome}`}
                            className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia border border-border bg-white text-text-subtle hover:border-primary hover:text-primary">
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
          <TamanhosLoja
            restauranteId={restauranteId}
            itens={items}
            tamanhosPizza={tamanhosPizzaCatalogo}
            setTamanhosPizza={setTamanhosPizzaCatalogo}
            tamanhosMarmita={tamanhosMarmitaCatalogo}
            setTamanhosMarmita={setTamanhosMarmitaCatalogo}
          />
        )}
      </div>

      {/* ── Tab: Peça também (antes "Order Bump") ── */}
      <div className={cardapioTab !== 'peca-tambem' ? 'hidden' : 'flex flex-1 flex-col overflow-hidden'}>
        {restauranteId && cardapioTab === 'peca-tambem' && <PecaTambem restauranteId={restauranteId} itens={items} grupos={groups} />}
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
          <button onClick={closeDrawer} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
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

          {/* Foto de capa obrigatória. O modo gaveta mostra a categoria como um
              cartão com foto; pedir a imagem aqui é o único momento em que o
              lojista tem o contexto todo na cabeça. Cobrar depois, em Ajustes,
              vira uma caça às categorias pendentes. A foto da ficha é opcional
              porque tem queda: sem ela, a ficha usa a do cartão. */}
          <div className="mt-4 space-y-4">
            <CampoFotoCategoria
              rotulo="Foto de capa"
              obrigatoria
              explicacao='Cartão da categoria na visualização “Gaveta”. Recortada em 5:2.'
              proporcoes={PROPORCOES_CARTAO}
              proporcaoPrevia="aspect-[5/2]"
              tituloModal="Posição da foto do cartão"
              descricaoModal="O cartão da categoria é recortado em 5:2. Marque o que não pode ser cortado."
              url={catImagemUrl}
              foco={catFoco}
              enviando={catEnviando}
              onArquivo={(file) => enviarFotoCategoria(file, null, 'cartao')}
              onFoco={setCatFoco}
              onRemover={() => { setCatImagemUrl(null); setCatFoco(FOCO_PADRAO) }}
            />
            <CampoFotoCategoria
              rotulo="Foto da ficha"
              explicacao='Topo da ficha quando a categoria tem um item só e abre direto. Sem ela, a ficha usa a foto do cartão.'
              proporcoes={PROPORCOES_FICHA}
              proporcaoPrevia="aspect-[1.1/1]"
              tituloModal="Posição da foto da ficha"
              descricaoModal="O topo da ficha é quase um retrato no celular e mais largo no computador. Marque o que não pode ser cortado."
              url={catFichaUrl}
              foco={catFichaFoco}
              enviando={catFichaEnviando}
              onArquivo={(file) => enviarFotoCategoria(file, null, 'ficha')}
              onFoco={setCatFichaFoco}
              onRemover={() => { setCatFichaUrl(null); setCatFichaFoco(FOCO_PADRAO) }}
            />
          </div>
        </div>
        <div className="border-t border-border p-4.5">
          {!catImagemUrl && (
            <p className="mb-2.5 text-[11px] leading-snug text-text-subtle">
              Envie a foto de capa para criar a categoria.
            </p>
          )}
          <div className="flex gap-2.5">
            <Button variant="secondary" className="flex-1" onClick={closeDrawer}>Cancelar</Button>
            <Button
              variant="primary"
              className="flex-1 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={createCategoria}
              disabled={!newGroupName.trim() || !catImagemUrl || catEnviando || catFichaEnviando}
            >
              Criar categoria
            </Button>
          </div>
        </div>
      </aside>

      {/* Drawer: importar grupo de complementos */}
      <aside className={modalClass(drawer === 'preset', 'w-[420px] max-w-[92vw]')}>
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">Importar grupo de complementos</h2>
            <p className="mt-0.5 text-xs text-text-subtle">Selecione um grupo salvo para adicionar a este produto com as regras já configuradas.</p>
          </div>
          <button onClick={() => setDrawer('edit')} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          {presets.length === 0 && (
            <div className="py-10 text-center text-sm text-text-subtle">
              Nenhum grupo criado ainda. Vá para a aba{' '}
              <button
                onClick={() => { setDrawer(null); irParaAba('complementos') }}
                className="font-semibold text-[var(--adm-azul)] underline"
              >
                Grupos de complementos
              </button>{' '}
              para criar o primeiro.
            </div>
          )}
          {presets.map((preset) => (
            <div key={preset.id} className="mb-3 overflow-hidden rounded-[6px] border-[0.8px] border-[var(--adm-borda-cartao)] bg-white">
              <div className="flex items-center gap-3 border-b border-[var(--adm-borda)] px-3.5 py-3">
                <div className="flex h-[36px] w-[36px] items-center justify-center rounded-full bg-[#F3E8FF]">
                  <FoodIcon name={preset.nome} size={26} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="truncate text-sm font-semibold text-[var(--adm-texto)]">{preset.nome}</h4>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className={`text-[10px] font-bold ${preset.obrigatorio ? 'text-danger' : 'text-text-subtle'}`}>
                      {preset.obrigatorio ? 'Obrigatório' : 'Opcional'}
                    </span>
                    <span className="text-[10px] text-text-subtle">· {ruleHint(preset)}</span>
                  </div>
                </div>
                <span className="rounded-full bg-[#f1f2f4] px-2 py-0.5 text-[11px] font-bold text-[var(--adm-texto-medio)]">{preset.itens.length} {preset.itens.length === 1 ? 'opção' : 'opções'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
                {preset.itens.map((entry) => (
                  <span key={entry.id} className="rounded-[4px] bg-[#f1f2f4] px-2 py-1 text-[11px] font-medium text-[var(--adm-texto-medio)]">
                    {entry.nome}{entry.preco === 0 ? ' · Grátis' : ''}
                  </span>
                ))}
              </div>
              <div className="px-3.5 pb-3.5">
                <button
                  onClick={() => importPreset(preset)}
                  className="w-full rounded-[4px] bg-[var(--adm-azul)] py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-[var(--adm-azul-escuro)]"
                >
                  Importar neste item
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
      <aside className={modalClass(drawer === 'edit', formStep === 2 && form.tipoItem === 'pizza' ? 'w-[980px] max-w-[96vw]' : 'w-[600px] max-w-[94vw]')}>
        <div className="flex items-center justify-between border-b border-border px-4.5 py-4">
          <div>
            <h2 className="text-[15px] font-bold">{form.id ? 'Editar item' : 'Novo item'}</h2>
            <p className="mt-0.5 text-xs text-text-subtle">{form.id ? form.nome : `Novo item em ${activeGroup ?? ''}`}</p>
          </div>
          <button onClick={closeDrawer} className="toque-icone flex h-[30px] w-[30px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        {/* Stepper do wizard */}
        <div className="border-b border-border bg-page px-4.5 py-2.5">
          <div className="flex items-center gap-1">
            {[
              { n: 1, label: 'O básico' },
              ...(temVariacoes ? [{ n: 2, label: form.tipoItem === 'pizza' ? 'Tamanhos e preços' : temTamanhos ? 'Volumes' : 'Tamanhos' }] : []),
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
                      formStep === s.n ? 'bg-[var(--adm-azul)] text-white' : form.id && formStep > s.n ? 'bg-status-ready text-white' : 'bg-border text-text-subtle',
                    ].join(' ')}>
                      {form.id && formStep > s.n ? '✓' : i + 1}
                    </span>
                    <span className={['text-[10.5px] font-semibold', formStep === s.n ? 'text-[var(--adm-azul)]' : 'text-text-subtle'].join(' ')}>{s.label}</span>
                  </button>
                  {i < arr.length - 1 && <span className="h-px w-2 flex-shrink-0 bg-border" />}
                </div>
              )
            })}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4.5">
          <FaixaErro mensagem={drawer === 'edit' ? error : null} onFechar={() => setError(null)} className="mb-3" />
          {avisoItem && (
            <Aviso tom="azul" className="mb-3">
              <span className="flex items-start justify-between gap-2">
                <span>{avisoItem}</span>
                <button type="button" data-toque-livre onClick={() => setAvisoItem(null)} className="font-bold" aria-label="Dispensar aviso">✕</button>
              </span>
            </Aviso>
          )}
          {/* ── ETAPA 1: o básico ─────────────────────────────────────── */}
          {formStep === 1 && (<>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Que tipo de item você vai cadastrar?</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { key: 'simples', icon: <Sandwich className="h-5 w-5" />, label: 'Lanche / Simples', hint: 'Um preço só', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'simples' })); setTemTamanhos(false) }, active: form.tipoItem === 'simples' && !temTamanhos },
              { key: 'acai', icon: <CupSoda className="h-5 w-5" />, label: 'Açaí / Volumes', hint: 'Preço por volume', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'simples' })); setTemTamanhos(true) }, active: form.tipoItem === 'simples' && temTamanhos },
              { key: 'pizza', icon: <Pizza className="h-5 w-5" />, label: 'Pizza', hint: 'Sabor × tamanho', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'pizza' })); setTemTamanhos(false) }, active: form.tipoItem === 'pizza' },
              { key: 'marmita', icon: <Soup className="h-5 w-5" />, label: 'Marmita', hint: 'Preço por tamanho', onClick: () => { setForm((p) => ({ ...p, tipoItem: 'marmita' })); setTemTamanhos(false) }, active: form.tipoItem === 'marmita' },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={t.onClick}
                className={[
                  'flex flex-col items-center gap-1 rounded-[6px] border px-2 py-3 text-[12px] font-semibold transition-colors',
                  t.active ? 'border-[var(--adm-azul)] bg-[var(--adm-azul-claro)] text-[var(--adm-azul-escuro)] ring-1 ring-[var(--adm-azul)]' : 'border-[var(--adm-borda)] bg-white text-[var(--adm-texto-medio)] hover:border-[var(--adm-azul)]',
                ].join(' ')}
              >
                <span className={t.active ? 'text-[var(--adm-azul)]' : 'text-[var(--adm-texto-suave)]'}>{t.icon}</span>
                {t.label}
                <span className="text-[10.5px] font-normal text-[var(--adm-texto-suave)]">{t.hint}</span>
              </button>
            ))}
          </div>

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome do item *</div>
          <input value={form.nome} onChange={(e) => setForm((prev) => ({ ...prev, nome: e.target.value }))}
            placeholder="Ex.: Burger Duplo Artesanal"
            className="w-full rounded-menuzia border border-border px-2.5 py-2 font-sans text-[13px] text-text-main outline-none focus:border-primary" />

          <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Descrição</div>
          <DescricaoEditor
            valor={form.descricao}
            onChange={(descricao) => setForm((prev) => ({ ...prev, descricao }))}
            placeholder="Ex.: Pão brioche, 2 hambúrgueres 120g, cheddar e molho da casa"
          />

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
            <Aviso tom="azul" className="mt-3">
              Pizza não tem preço base: o preço vem do <b>sabor em cada tamanho</b>. Na próxima etapa você monta a tabela de sabores × tamanhos.
            </Aviso>
          )}
          {!form.id && form.tipoItem !== 'pizza' && temVariacoes && !(parsePreco(form.preco) > 0) && (
            <Aviso tom="azul" className="mt-3">
              Sem preço-base, o item é salvo <b>pausado</b> e volta a aparecer assim que um {temTamanhos ? 'volume' : 'tamanho'} tiver preço.
            </Aviso>
          )}
          </>)}

          {/* ── ETAPA 2: tamanhos e preços / tamanhos / volumes ─────────── */}
          {formStep === 2 && form.tipoItem === 'pizza' && currentItem && restauranteId && (
            <PizzaTamanhosPrecos
              item={currentItem}
              tamanhos={tamanhosPizzaCatalogo}
              restauranteId={restauranteId}
              podeEditarCatalogo={podeEditarCatalogo}
              onTamanhoCriado={(t) => setTamanhosPizzaCatalogo((prev) => [...prev, t])}
              onAtualizar={refreshItems}
            />
          )}
          {formStep === 2 && (form.tipoItem === 'marmita' || (form.tipoItem === 'simples' && temTamanhos)) && currentItem && (
            <TamanhosDoItem
              item={currentItem}
              rotulo={temTamanhos ? 'volume' : 'tamanho'}
              catalogoMarmita={form.tipoItem === 'marmita' ? tamanhosMarmitaCatalogo : undefined}
              onAtualizar={refreshItems}
            />
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
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Favorito</div>
              <label className="flex h-[34px] cursor-pointer items-center gap-2 rounded-menuzia border border-border px-2.5 text-[13px] font-medium text-text-main">
                <input type="checkbox" checked={form.maisVendido} onChange={(e) => setForm((prev) => ({ ...prev, maisVendido: e.target.checked }))}
                  className="h-3.5 w-3.5 accent-primary" />
                Item favorito
              </label>
              <p className="mt-1 text-[11px] text-text-subtle">Marca o item com ★ aqui no painel e mostra “★ Favorito” na vitrine e nos QR Codes. Não muda a posição do item.</p>
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
              {pausadoAteTerPreco && (
                <p className="mb-1.5 text-[11px] font-medium text-[#92400E]">Pausado até ter um {temTamanhos ? 'volume' : 'tamanho'} com preço.</p>
              )}
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

          {/* Onde o item é vendido. O cadastro é ESTE — não existe cardápio separado para
              o salão: a mesma foto, descrição, preço, promoção e complementos valem nos
              dois canais, e aqui só se escolhe onde aparecem. */}
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Onde vender</div>
            <div className="flex flex-wrap gap-2">
              {([
                { chave: 'disponivelDelivery' as const, rotulo: 'Delivery e retirada', dica: 'Aparece na vitrine do cliente' },
                { chave: 'disponivelSalao' as const, rotulo: 'Salão e balcão', dica: 'Aparece na mesa (QR), no painel do garçom e no PDV' },
              ]).map(({ chave, rotulo, dica }) => {
                const marcado = form[chave]
                // O banco recusa item fora dos dois canais (CHECK da 0069): desmarcar o
                // último é bloqueado aqui, com o motivo, em vez de estourar ao salvar.
                const ultimo = marcado && !form[chave === 'disponivelDelivery' ? 'disponivelSalao' : 'disponivelDelivery']
                return (
                  <label
                    key={chave}
                    title={ultimo ? 'O item precisa ser vendido em pelo menos um canal.' : dica}
                    className={`flex flex-1 min-w-[180px] cursor-pointer items-start gap-2 rounded-menuzia border px-3 py-2 ${
                      marcado ? 'border-primary bg-alert-bg' : 'border-border bg-white'
                    } ${ultimo ? 'cursor-not-allowed opacity-80' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={ultimo}
                      onChange={(e) => setForm((prev) => ({ ...prev, [chave]: e.target.checked }))}
                      className="mt-0.5 h-3.5 w-3.5 accent-primary"
                    />
                    <span>
                      <span className="block text-[13px] font-semibold text-text-main">{rotulo}</span>
                      <span className="block text-[11px] text-text-subtle">{dica}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
          </>)}

          {/* ── ETAPA 3: complementos ─────────────────────────────────── */}
          {formStep === 3 && form.id && (
            <>
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Grupos de complementos</div>
                <button onClick={() => setDrawer('preset')} className="rounded-[4px] bg-[var(--adm-azul)] px-2.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--adm-azul-escuro)]">
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

      {bulkTarget && restauranteId && (
        <BulkUploadModal
          restauranteId={restauranteId}
          target={bulkTarget}
          onClose={async (criados) => {
            setBulkTarget(null)
            if (criados.length > 0) await refreshItems()
          }}
        />
      )}
    </>
  )
}
