'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, listarItens, type ItemCardapio } from '@/lib/queries/cardapio'
import type {
  CampanhaFidelidadeComStats,
  CampanhaFidelidadeInput,
  CupomComStats,
  CupomInput,
} from '@/lib/queries/fidelidade'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

const INPUT_CLS =
  'w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary placeholder:text-text-subtle/60'

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// Artigo correto em pt-BR (mesma convenção de lib/fidelidade-regras.ts).
const DIA_SEMANA_LABEL: Record<number, string> = {
  0: 'aos domingos',
  1: 'às segundas',
  2: 'às terças',
  3: 'às quartas',
  4: 'às quintas',
  5: 'às sextas',
  6: 'aos sábados',
}

const DIA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

function diasSemanaTexto(dias: number[]): string {
  const labels = [...dias].sort().map((d) => DIA_SEMANA_LABEL[d]).filter((l): l is string => Boolean(l))
  if (labels.length <= 1) return labels[0] ?? ''
  return `${labels.slice(0, -1).join(', ')} e ${labels[labels.length - 1]}`
}

function formatarData(iso: string | null): string {
  if (!iso) return ''
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  return `${dia}/${mes}/${ano}`
}

const TIPO_META_LABEL: Record<CampanhaFidelidadeInput['tipoMeta'], string> = {
  valor_gasto: 'Valor gasto (R$)',
  qtd_pedidos: 'Quantidade de pedidos',
  qtd_itens: 'Quantidade de itens',
}

const PREMIO_TIPO_LABEL: Record<CampanhaFidelidadeInput['premioTipo'], string> = {
  item_gratis: 'Item grátis',
  desconto_percentual: 'Desconto percentual (%)',
  desconto_valor: 'Desconto em valor (R$)',
  entrega_gratis: 'Entrega grátis',
}

const CUPOM_TIPO_LABEL: Record<CupomInput['tipo'], string> = {
  desconto_percentual: 'Desconto percentual (%)',
  desconto_valor: 'Desconto em valor (R$)',
  entrega_gratis: 'Entrega grátis',
  item_gratis: 'Item grátis',
}

const PUBLICO_LABEL: Record<NonNullable<CupomInput['publico']>, string> = {
  todos: 'Todos os clientes',
  primeira_compra: 'Primeira compra',
  recompra: 'Recompra (clientes sumidos)',
}

function metaLegivel(c: CampanhaFidelidadeComStats): string {
  let base: string
  if (c.tipoMeta === 'valor_gasto') base = `${brl(c.metaValor ?? 0)} gastos`
  else if (c.tipoMeta === 'qtd_pedidos') base = `${c.metaQuantidade ?? 0} pedidos`
  else base = `${c.metaQuantidade ?? 0} itens`
  if (c.diasSemanaContam.length > 0) base += ` ${diasSemanaTexto(c.diasSemanaContam)}`
  return base
}

function premioLegivel(c: { premioTipo: CampanhaFidelidadeInput['premioTipo']; premioValor: number | null; premioItemNome?: string }): string {
  switch (c.premioTipo) {
    case 'item_gratis':
      return `${c.premioItemNome ?? 'Item'} grátis`
    case 'desconto_percentual':
      return `${c.premioValor ?? 0}% de desconto`
    case 'desconto_valor':
      return `${brl(c.premioValor ?? 0)} de desconto`
    case 'entrega_gratis':
      return 'Entrega grátis'
  }
}

function cupomTipoLegivel(c: CupomComStats): string {
  switch (c.tipo) {
    case 'desconto_percentual':
      return `${c.valor ?? 0}% de desconto`
    case 'desconto_valor':
      return `${brl(c.valor ?? 0)} de desconto`
    case 'entrega_gratis':
      return 'Entrega grátis'
    case 'item_gratis':
      return `${c.itemNome ?? 'Item'} grátis`
  }
}

// ─── Componentes base ─────────────────────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-text-subtle">{hint}</p>}
    </div>
  )
}

function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={[
        'inline-flex h-[22px] w-[38px] flex-shrink-0 items-center rounded-full border p-[2px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-border bg-border',
      ].join(' ')}
    >
      <span
        className={[
          'block h-[16px] w-[16px] flex-shrink-0 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[16px]' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <div className="text-[13px] font-medium text-text-main">{label}</div>
        {hint && <p className="mt-0.5 text-[11px] text-text-subtle">{hint}</p>}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} />
    </div>
  )
}

/** Chips D S T Q Q S S — mesmo padrão do gestor de cardápio (disponibilidade por dia). */
function DiasChips({ dias, onChange }: { dias: number[]; onChange: (dias: number[]) => void }) {
  const ativos = useMemo(() => new Set(dias), [dias])
  function toggle(dia: number) {
    const next = new Set(ativos)
    if (next.has(dia)) next.delete(dia)
    else next.add(dia)
    onChange([...next].sort())
  }
  return (
    <div className="flex gap-1">
      {DAY_LABELS.map((label, dia) => (
        <button
          key={dia}
          type="button"
          onClick={() => toggle(dia)}
          className={[
            'flex h-6 w-6 select-none items-center justify-center rounded-menuzia border text-[11px] font-bold transition-colors',
            ativos.has(dia)
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

function ItemThumb({ nome, imagemUrl, size = 'h-8 w-8' }: { nome: string; imagemUrl: string | null; size?: string }) {
  if (imagemUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imagemUrl} alt={nome} className={`${size} flex-shrink-0 rounded-menuzia border border-border object-cover`} />
  }
  return (
    <div className={`${size} flex flex-shrink-0 items-center justify-center rounded-menuzia border border-border bg-page text-[12px] font-bold text-text-subtle`}>
      {nome.charAt(0).toUpperCase()}
    </div>
  )
}

/** Seletor de item do cardápio com busca client-side (thumb + nome + preço). */
function ItemSelector({ itens, value, onChange }: { itens: ItemCardapio[]; value: string | null; onChange: (id: string | null) => void }) {
  const [busca, setBusca] = useState('')
  const selecionado = itens.find((i) => i.id === value)

  if (selecionado) {
    return (
      <div className="flex items-center gap-3 rounded-menuzia border border-border bg-page px-3 py-2">
        <ItemThumb nome={selecionado.nome} imagemUrl={selecionado.imagemUrl} size="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-text-main">{selecionado.nome}</p>
          <p className="text-[12px] text-text-subtle">{brl(selecionado.preco)}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded px-3 py-1.5 text-[11px] font-semibold border border-border bg-white text-text-subtle hover:border-primary hover:text-primary"
        >
          Trocar
        </button>
      </div>
    )
  }

  const termo = busca.trim().toLowerCase()
  const filtrados = termo ? itens.filter((i) => i.nome.toLowerCase().includes(termo)) : itens

  return (
    <div className="space-y-2">
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Buscar item do cardápio…"
        className={INPUT_CLS}
      />
      <div className="max-h-52 divide-y divide-border overflow-y-auto rounded-menuzia border border-border">
        {itens.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-text-subtle">Nenhum item cadastrado no cardápio.</p>
        ) : filtrados.length === 0 ? (
          <p className="px-3 py-3 text-[12px] text-text-subtle">Nenhum item encontrado para “{busca}”.</p>
        ) : (
          filtrados.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange(item.id)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-page"
            >
              <ItemThumb nome={item.nome} imagemUrl={item.imagemUrl} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-main">{item.nome}</span>
              <span className="text-[12px] text-text-subtle">{brl(item.preco)}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Formulários (state) ──────────────────────────────────────────────────────

interface CampanhaForm {
  nome: string
  descricao: string
  ativa: boolean
  tipoMeta: CampanhaFidelidadeInput['tipoMeta']
  metaValor: string
  metaQuantidade: string
  diasSemanaContam: number[]
  diasSemanaResgate: number[]
  premioTipo: CampanhaFidelidadeInput['premioTipo']
  premioItemId: string | null
  premioValor: string
  repetivel: boolean
}

function campanhaFormDefault(): CampanhaForm {
  return {
    nome: '',
    descricao: '',
    ativa: true,
    tipoMeta: 'valor_gasto',
    metaValor: '',
    metaQuantidade: '',
    diasSemanaContam: [],
    diasSemanaResgate: [],
    premioTipo: 'item_gratis',
    premioItemId: null,
    premioValor: '',
    repetivel: true,
  }
}

function campanhaInputFromForm(f: CampanhaForm): CampanhaFidelidadeInput {
  const temDesconto = f.premioTipo === 'desconto_percentual' || f.premioTipo === 'desconto_valor'
  return {
    nome: f.nome.trim(),
    descricao: f.descricao.trim(),
    ativa: f.ativa,
    tipoMeta: f.tipoMeta,
    metaValor: f.tipoMeta === 'valor_gasto' ? Number(f.metaValor) : null,
    metaQuantidade: f.tipoMeta === 'valor_gasto' ? null : Number(f.metaQuantidade),
    diasSemanaContam: f.diasSemanaContam,
    diasSemanaResgate: f.diasSemanaResgate,
    premioTipo: f.premioTipo,
    premioItemId: f.premioTipo === 'item_gratis' ? f.premioItemId : null,
    premioValor: temDesconto ? Number(f.premioValor) : null,
    repetivel: f.repetivel,
  }
}

/** PATCH é replace-full: monta o Input COMPLETO a partir do registro da lista. */
function campanhaInputFromRecord(c: CampanhaFidelidadeComStats): CampanhaFidelidadeInput {
  return {
    nome: c.nome,
    descricao: c.descricao,
    ativa: c.ativa,
    tipoMeta: c.tipoMeta,
    metaValor: c.metaValor,
    metaQuantidade: c.metaQuantidade,
    diasSemanaContam: c.diasSemanaContam,
    diasSemanaResgate: c.diasSemanaResgate,
    premioTipo: c.premioTipo,
    premioItemId: c.premioItemId,
    premioValor: c.premioValor,
    repetivel: c.repetivel,
  }
}

interface CupomForm {
  codigo: string
  descricao: string
  ativo: boolean
  tipo: CupomInput['tipo']
  valor: string
  itemId: string | null
  publico: NonNullable<CupomInput['publico']>
  diasInatividade: string
  diasSemana: number[]
  validadeInicio: string
  validadeFim: string
  valorMinimoPedido: string
  usoUnicoPorCliente: boolean
  maxUsos: string
}

function cupomFormDefault(): CupomForm {
  return {
    codigo: '',
    descricao: '',
    ativo: true,
    tipo: 'desconto_percentual',
    valor: '',
    itemId: null,
    publico: 'todos',
    diasInatividade: '',
    diasSemana: [],
    validadeInicio: '',
    validadeFim: '',
    valorMinimoPedido: '',
    usoUnicoPorCliente: true,
    maxUsos: '',
  }
}

function cupomInputFromForm(f: CupomForm): CupomInput {
  const temValor = f.tipo === 'desconto_percentual' || f.tipo === 'desconto_valor'
  return {
    codigo: f.codigo.trim(),
    descricao: f.descricao.trim(),
    ativo: f.ativo,
    tipo: f.tipo,
    valor: temValor ? Number(f.valor) : null,
    itemId: f.tipo === 'item_gratis' ? f.itemId : null,
    publico: f.publico,
    diasInatividade: f.publico === 'recompra' && f.diasInatividade !== '' ? Number(f.diasInatividade) : null,
    diasSemana: f.diasSemana,
    validadeInicio: f.validadeInicio || null,
    validadeFim: f.validadeFim || null,
    valorMinimoPedido: f.valorMinimoPedido !== '' ? Number(f.valorMinimoPedido) : null,
    usoUnicoPorCliente: f.usoUnicoPorCliente,
    maxUsos: f.maxUsos !== '' ? Number(f.maxUsos) : null,
  }
}

/** PATCH é replace-full: monta o Input COMPLETO a partir do registro da lista. */
function cupomInputFromRecord(c: CupomComStats): CupomInput {
  return {
    codigo: c.codigo,
    descricao: c.descricao,
    ativo: c.ativo,
    tipo: c.tipo,
    valor: c.valor,
    itemId: c.itemId,
    publico: c.publico,
    diasInatividade: c.diasInatividade,
    diasSemana: c.diasSemana,
    validadeInicio: c.validadeInicio,
    validadeFim: c.validadeFim,
    valorMinimoPedido: c.valorMinimoPedido,
    usoUnicoPorCliente: c.usoUnicoPorCliente,
    maxUsos: c.maxUsos,
  }
}

// ─── Página ───────────────────────────────────────────────────────────────────

type Aba = 'campanhas' | 'cupons'

const ABAS: { id: Aba; label: string }[] = [
  { id: 'campanhas', label: 'Campanhas de fidelidade' },
  { id: 'cupons', label: 'Cupons' },
]

export default function FidelidadePage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [aba, setAba] = useState<Aba>('campanhas')
  const [campanhas, setCampanhas] = useState<CampanhaFidelidadeComStats[]>([])
  const [cupons, setCupons] = useState<CupomComStats[]>([])
  const [itens, setItens] = useState<ItemCardapio[]>([])
  const [loading, setLoading] = useState(true)

  // Drawer campanha
  const [drawerCampanha, setDrawerCampanha] = useState(false)
  const [editandoCampanhaId, setEditandoCampanhaId] = useState<string | null>(null)
  const [formCampanha, setFormCampanha] = useState<CampanhaForm>(campanhaFormDefault())

  // Drawer cupom
  const [drawerCupom, setDrawerCupom] = useState(false)
  const [editandoCupomId, setEditandoCupomId] = useState<string | null>(null)
  const [formCupom, setFormCupom] = useState<CupomForm>(cupomFormDefault())

  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // ── Carregar ──────────────────────────────────────────────────────────────

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const [resCampanhas, resCupons] = await Promise.all([
        fetch('/api/admin/fidelidade/campanhas'),
        fetch('/api/admin/fidelidade/cupons'),
      ])
      if (resCampanhas.ok) setCampanhas(await resCampanhas.json())
      if (resCupons.ok) setCupons(await resCupons.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then((id) => {
      if (!id) return
      carregar()
      listarItens(supabase, id).then(setItens).catch(() => {})
    })
  }, [supabase, carregar])

  // ── Campanhas: drawer + ações ─────────────────────────────────────────────

  function abrirNovaCampanha() {
    setEditandoCampanhaId(null)
    setFormCampanha(campanhaFormDefault())
    setErro(null)
    setDrawerCampanha(true)
  }

  function abrirEditarCampanha(c: CampanhaFidelidadeComStats) {
    setEditandoCampanhaId(c.id)
    setFormCampanha({
      nome: c.nome,
      descricao: c.descricao ?? '',
      ativa: c.ativa,
      tipoMeta: c.tipoMeta,
      metaValor: c.metaValor != null ? String(c.metaValor) : '',
      metaQuantidade: c.metaQuantidade != null ? String(c.metaQuantidade) : '',
      diasSemanaContam: c.diasSemanaContam,
      diasSemanaResgate: c.diasSemanaResgate,
      premioTipo: c.premioTipo,
      premioItemId: c.premioItemId,
      premioValor: c.premioValor != null ? String(c.premioValor) : '',
      repetivel: c.repetivel,
    })
    setErro(null)
    setDrawerCampanha(true)
  }

  async function salvarCampanha() {
    setSaving(true)
    setErro(null)
    try {
      const body = campanhaInputFromForm(formCampanha)
      const res = await fetch(
        editandoCampanhaId ? `/api/admin/fidelidade/campanhas/${editandoCampanhaId}` : '/api/admin/fidelidade/campanhas',
        { method: editandoCampanhaId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErro(data?.error ?? 'Erro ao salvar campanha.')
        return
      }
      setDrawerCampanha(false)
      setEditandoCampanhaId(null)
      carregar()
    } catch {
      setErro('Erro ao salvar campanha.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleCampanhaAtiva(c: CampanhaFidelidadeComStats) {
    setCampanhas((prev) => prev.map((x) => (x.id === c.id ? { ...x, ativa: !c.ativa } : x)))
    const res = await fetch(`/api/admin/fidelidade/campanhas/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...campanhaInputFromRecord(c), ativa: !c.ativa }),
    })
    if (!res.ok) carregar()
  }

  async function excluirCampanha(id: string) {
    if (!confirm('Excluir esta campanha de fidelidade? O progresso dos clientes será perdido.')) return
    await fetch(`/api/admin/fidelidade/campanhas/${id}`, { method: 'DELETE' })
    carregar()
  }

  // ── Cupons: drawer + ações ────────────────────────────────────────────────

  function abrirNovoCupom() {
    setEditandoCupomId(null)
    setFormCupom(cupomFormDefault())
    setErro(null)
    setDrawerCupom(true)
  }

  function abrirPresetCompreDeNovo() {
    setEditandoCupomId(null)
    setFormCupom({
      ...cupomFormDefault(),
      descricao: 'Sentimos sua falta! Volte a pedir com 10% de desconto.',
      tipo: 'desconto_percentual',
      valor: '10',
      publico: 'recompra',
      diasInatividade: '30',
    })
    setErro(null)
    setDrawerCupom(true)
  }

  function abrirEditarCupom(c: CupomComStats) {
    setEditandoCupomId(c.id)
    setFormCupom({
      codigo: c.codigo,
      descricao: c.descricao ?? '',
      ativo: c.ativo,
      tipo: c.tipo,
      valor: c.valor != null ? String(c.valor) : '',
      itemId: c.itemId,
      publico: c.publico,
      diasInatividade: c.diasInatividade != null ? String(c.diasInatividade) : '',
      diasSemana: c.diasSemana,
      validadeInicio: c.validadeInicio ? c.validadeInicio.slice(0, 10) : '',
      validadeFim: c.validadeFim ? c.validadeFim.slice(0, 10) : '',
      valorMinimoPedido: c.valorMinimoPedido != null ? String(c.valorMinimoPedido) : '',
      usoUnicoPorCliente: c.usoUnicoPorCliente,
      maxUsos: c.maxUsos != null ? String(c.maxUsos) : '',
    })
    setErro(null)
    setDrawerCupom(true)
  }

  async function salvarCupom() {
    setSaving(true)
    setErro(null)
    try {
      const body = cupomInputFromForm(formCupom)
      const res = await fetch(
        editandoCupomId ? `/api/admin/fidelidade/cupons/${editandoCupomId}` : '/api/admin/fidelidade/cupons',
        { method: editandoCupomId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      )
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setErro(data?.error ?? 'Erro ao salvar cupom.')
        return
      }
      setDrawerCupom(false)
      setEditandoCupomId(null)
      carregar()
    } catch {
      setErro('Erro ao salvar cupom.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleCupomAtivo(c: CupomComStats) {
    setCupons((prev) => prev.map((x) => (x.id === c.id ? { ...x, ativo: !c.ativo } : x)))
    const res = await fetch(`/api/admin/fidelidade/cupons/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cupomInputFromRecord(c), ativo: !c.ativo }),
    })
    if (!res.ok) carregar()
  }

  async function excluirCupom(id: string) {
    if (!confirm('Excluir este cupom permanentemente?')) return
    await fetch(`/api/admin/fidelidade/cupons/${id}`, { method: 'DELETE' })
    carregar()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const premioTemValor = formCampanha.premioTipo === 'desconto_percentual' || formCampanha.premioTipo === 'desconto_valor'
  const cupomTemValor = formCupom.tipo === 'desconto_percentual' || formCupom.tipo === 'desconto_valor'

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Fidelidade" breadcrumb="Campanhas de fidelidade e cupons de desconto" />

      {/* Tab bar */}
      <div className="flex flex-shrink-0 gap-0.5 border-b border-border bg-main px-5 pt-4">
        {ABAS.map((t) => (
          <button
            key={t.id}
            onClick={() => setAba(t.id)}
            className={[
              'rounded-t-menuzia border-b-2 px-4 pb-3 pt-2 text-[13px] font-semibold transition-colors',
              aba === t.id ? 'border-tab-active bg-tab-active text-white' : 'border-transparent text-text-subtle hover:text-text-main',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-1 flex-col space-y-4 overflow-y-auto p-5">
        {/* ── Aba Campanhas ──────────────────────────────────────────────── */}
        {aba === 'campanhas' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-text-subtle">
                Recompense clientes recorrentes: eles acumulam progresso a cada pedido entregue e ganham o prêmio ao bater a meta.
              </p>
              <Button onClick={abrirNovaCampanha}>+ Nova campanha</Button>
            </div>

            {loading ? (
              <p className="text-[13px] text-text-subtle">Carregando…</p>
            ) : campanhas.length === 0 ? (
              <Card className="flex flex-col items-center gap-3 py-12 text-center">
                <svg viewBox="0 0 24 24" className="h-10 w-10 fill-text-subtle/30">
                  <path d="M20 6h-2.18c.11-.31.18-.65.18-1 0-1.66-1.34-3-3-3-1.05 0-1.96.54-2.5 1.35l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-5-2c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z" />
                </svg>
                <p className="text-[13px] font-medium text-text-subtle">Nenhuma campanha de fidelidade criada ainda.</p>
                <Button onClick={abrirNovaCampanha}>Criar primeira campanha</Button>
              </Card>
            ) : (
              <Card className="overflow-hidden p-0">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-page">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Campanha</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Meta</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Prêmio</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Resgate</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Repetível</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Clientes</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ativa</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {campanhas.map((c) => (
                      <tr key={c.id} className="hover:bg-page/60">
                        <td className="px-4 py-3">
                          <p className="font-medium text-text-main">{c.nome}</p>
                          {c.descricao && <p className="mt-0.5 max-w-[220px] truncate text-[11px] text-text-subtle">{c.descricao}</p>}
                        </td>
                        <td className="px-4 py-3 text-text-subtle">{metaLegivel(c)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {c.premioTipo === 'item_gratis' && <ItemThumb nome={c.premioItemNome ?? 'Item'} imagemUrl={c.premioItemImagemUrl ?? null} />}
                            <span className="text-text-main">{premioLegivel(c)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-text-subtle">
                          {c.diasSemanaResgate.length === 0 ? 'Qualquer dia' : `Só ${diasSemanaTexto(c.diasSemanaResgate)}`}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={[
                              'inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold',
                              c.repetivel ? 'bg-alert text-alert' : 'bg-page text-text-subtle border border-border',
                            ].join(' ')}
                          >
                            {c.repetivel ? 'Sim' : 'Não'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[12px] text-text-subtle">
                          <span className="font-semibold text-text-main">{c.clientesProgredindo}</span> progredindo
                          <span className="mx-1">·</span>
                          <span className="font-semibold text-text-main">{c.recompensasGanhas}</span> ganhos
                          <span className="mx-1">·</span>
                          <span className="font-semibold text-text-main">{c.recompensasResgatadas}</span> resgatados
                        </td>
                        <td className="px-4 py-3">
                          <ToggleSwitch checked={c.ativa} onChange={() => toggleCampanhaAtiva(c)} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => abrirEditarCampanha(c)} className="rounded px-2 py-1 text-[11px] font-semibold text-primary hover:bg-alert/20">Editar</button>
                            <button onClick={() => excluirCampanha(c.id)} className="rounded px-2 py-1 text-[11px] font-semibold text-text-subtle hover:bg-danger/10 hover:text-danger">Excluir</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}

        {/* ── Aba Cupons ─────────────────────────────────────────────────── */}
        {aba === 'cupons' && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-text-subtle">Crie códigos de desconto que o cliente aplica no checkout do cardápio.</p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={abrirPresetCompreDeNovo}>
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                  </svg>
                  Compre de novo
                </Button>
                <Button onClick={abrirNovoCupom}>+ Novo cupom</Button>
              </div>
            </div>

            {loading ? (
              <p className="text-[13px] text-text-subtle">Carregando…</p>
            ) : cupons.length === 0 ? (
              <Card className="flex flex-col items-center gap-3 py-12 text-center">
                <svg viewBox="0 0 24 24" className="h-10 w-10 fill-text-subtle/30">
                  <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" />
                </svg>
                <p className="text-[13px] font-medium text-text-subtle">Nenhum cupom criado ainda.</p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={abrirPresetCompreDeNovo}>Compre de novo</Button>
                  <Button onClick={abrirNovoCupom}>Criar primeiro cupom</Button>
                </div>
              </Card>
            ) : (
              <Card className="overflow-hidden p-0">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-page">
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Código</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Desconto</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Público</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Dias</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Validade</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Usos</th>
                      <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ativo</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {cupons.map((c) => (
                      <tr key={c.id} className="hover:bg-page/60">
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded bg-page px-2 py-0.5 font-mono text-[12px] font-bold tracking-wide text-text-main border border-border">
                            {c.codigo}
                          </span>
                          {c.descricao && <p className="mt-1 max-w-[220px] truncate text-[11px] text-text-subtle">{c.descricao}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {c.tipo === 'item_gratis' && <ItemThumb nome={c.itemNome ?? 'Item'} imagemUrl={c.itemImagemUrl ?? null} />}
                            <span className="text-text-main">{cupomTipoLegivel(c)}</span>
                          </div>
                          {c.valorMinimoPedido != null && (
                            <p className="mt-0.5 text-[11px] text-text-subtle">Pedido mínimo {brl(c.valorMinimoPedido)}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-text-subtle">
                          {c.publico === 'todos' && 'Todos'}
                          {c.publico === 'primeira_compra' && 'Primeira compra'}
                          {c.publico === 'recompra' && `Recompra${c.diasInatividade != null ? ` (${c.diasInatividade}d)` : ''}`}
                        </td>
                        <td className="px-4 py-3 text-text-subtle">
                          {c.diasSemana.length === 0 ? 'Todos' : [...c.diasSemana].sort().map((d) => DIA_CURTO[d]).join(', ')}
                        </td>
                        <td className="px-4 py-3 text-text-subtle">
                          {!c.validadeInicio && !c.validadeFim
                            ? '—'
                            : `${c.validadeInicio ? formatarData(c.validadeInicio) : '…'} – ${c.validadeFim ? formatarData(c.validadeFim) : '…'}`}
                        </td>
                        <td className="px-4 py-3 text-text-subtle">
                          {c.usos}
                          {c.maxUsos != null && ` / ${c.maxUsos}`}
                          {c.usoUnicoPorCliente && <p className="mt-0.5 text-[11px]">1x por cliente</p>}
                        </td>
                        <td className="px-4 py-3">
                          <ToggleSwitch checked={c.ativo} onChange={() => toggleCupomAtivo(c)} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => abrirEditarCupom(c)} className="rounded px-2 py-1 text-[11px] font-semibold text-primary hover:bg-alert/20">Editar</button>
                            <button onClick={() => excluirCupom(c.id)} className="rounded px-2 py-1 text-[11px] font-semibold text-text-subtle hover:bg-danger/10 hover:text-danger">Excluir</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </div>

      {/* ── Drawer: Campanha ─────────────────────────────────────────────── */}
      {drawerCampanha && <div className="fixed inset-0 z-40 bg-[#111827]/40" onClick={() => setDrawerCampanha(false)} />}
      <div className={['fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl transition-transform duration-300', drawerCampanha ? 'translate-x-0' : 'translate-x-full'].join(' ')}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-bold text-text-main">{editandoCampanhaId ? 'Editar campanha de fidelidade' : 'Nova campanha de fidelidade'}</h2>
          <button onClick={() => setDrawerCampanha(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-page text-xl font-light text-text-subtle hover:text-text-main">×</button>
        </div>

        {drawerCampanha && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <Field label="Nome da campanha">
              <input
                value={formCampanha.nome}
                onChange={(e) => setFormCampanha((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Clube do burger"
                className={INPUT_CLS}
              />
            </Field>

            <Field label="Descrição" hint="Aparece para o cliente na aba Cupons do cardápio.">
              <textarea
                rows={2}
                value={formCampanha.descricao}
                onChange={(e) => setFormCampanha((f) => ({ ...f, descricao: e.target.value }))}
                placeholder="Ex: A cada R$ 200 em pedidos, ganhe um lanche grátis!"
                className={`${INPUT_CLS} resize-none`}
              />
            </Field>

            <Field label="Tipo de meta">
              <select
                value={formCampanha.tipoMeta}
                onChange={(e) => setFormCampanha((f) => ({ ...f, tipoMeta: e.target.value as CampanhaForm['tipoMeta'] }))}
                className={INPUT_CLS}
              >
                {(Object.keys(TIPO_META_LABEL) as CampanhaForm['tipoMeta'][]).map((t) => (
                  <option key={t} value={t}>{TIPO_META_LABEL[t]}</option>
                ))}
              </select>
            </Field>

            {formCampanha.tipoMeta === 'valor_gasto' ? (
              <Field label="Meta (R$)" hint="Quanto o cliente precisa gastar (soma dos pedidos entregues) para ganhar o prêmio.">
                <input
                  type="number" min={0} step={10}
                  value={formCampanha.metaValor}
                  onChange={(e) => setFormCampanha((f) => ({ ...f, metaValor: e.target.value }))}
                  placeholder="Ex: 200"
                  className={INPUT_CLS}
                />
              </Field>
            ) : (
              <Field
                label={formCampanha.tipoMeta === 'qtd_pedidos' ? 'Meta (pedidos)' : 'Meta (itens)'}
                hint={formCampanha.tipoMeta === 'qtd_pedidos' ? 'Quantos pedidos entregues para ganhar o prêmio.' : 'Quantos itens comprados para ganhar o prêmio.'}
              >
                <input
                  type="number" min={1} step={1}
                  value={formCampanha.metaQuantidade}
                  onChange={(e) => setFormCampanha((f) => ({ ...f, metaQuantidade: e.target.value }))}
                  placeholder="Ex: 10"
                  className={INPUT_CLS}
                />
              </Field>
            )}

            <Field label="Dias que contam" hint="Nenhum selecionado = pedidos de qualquer dia contam para a meta.">
              <DiasChips dias={formCampanha.diasSemanaContam} onChange={(dias) => setFormCampanha((f) => ({ ...f, diasSemanaContam: dias }))} />
            </Field>

            <Field label="Dias de resgate" hint="Nenhum selecionado = o prêmio pode ser resgatado em qualquer dia.">
              <DiasChips dias={formCampanha.diasSemanaResgate} onChange={(dias) => setFormCampanha((f) => ({ ...f, diasSemanaResgate: dias }))} />
            </Field>

            <Field label="Prêmio">
              <select
                value={formCampanha.premioTipo}
                onChange={(e) => setFormCampanha((f) => ({ ...f, premioTipo: e.target.value as CampanhaForm['premioTipo'] }))}
                className={INPUT_CLS}
              >
                {(Object.keys(PREMIO_TIPO_LABEL) as CampanhaForm['premioTipo'][]).map((t) => (
                  <option key={t} value={t}>{PREMIO_TIPO_LABEL[t]}</option>
                ))}
              </select>
            </Field>

            {formCampanha.premioTipo === 'item_gratis' && (
              <Field label="Item do prêmio">
                <ItemSelector itens={itens} value={formCampanha.premioItemId} onChange={(id) => setFormCampanha((f) => ({ ...f, premioItemId: id }))} />
              </Field>
            )}

            {premioTemValor && (
              <Field label={formCampanha.premioTipo === 'desconto_percentual' ? 'Desconto (%)' : 'Desconto (R$)'}>
                <input
                  type="number" min={0}
                  max={formCampanha.premioTipo === 'desconto_percentual' ? 100 : undefined}
                  step={formCampanha.premioTipo === 'desconto_percentual' ? 1 : 0.5}
                  value={formCampanha.premioValor}
                  onChange={(e) => setFormCampanha((f) => ({ ...f, premioValor: e.target.value }))}
                  placeholder={formCampanha.premioTipo === 'desconto_percentual' ? 'Ex: 10' : 'Ex: 15'}
                  className={INPUT_CLS}
                />
              </Field>
            )}

            <div className="space-y-3 border-t border-border pt-4">
              <ToggleRow
                label="Repetível"
                hint="Ao completar a meta, o progresso zera e o cliente pode ganhar de novo."
                checked={formCampanha.repetivel}
                onChange={(v) => setFormCampanha((f) => ({ ...f, repetivel: v }))}
              />
              <ToggleRow
                label="Campanha ativa"
                hint="Só campanhas ativas acumulam progresso e aparecem para o cliente."
                checked={formCampanha.ativa}
                onChange={(v) => setFormCampanha((f) => ({ ...f, ativa: v }))}
              />
            </div>

            {erro && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>}
          </div>
        )}

        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-border bg-white px-5 py-4">
          <Button variant="outline" onClick={() => setDrawerCampanha(false)}>Cancelar</Button>
          <Button disabled={saving} onClick={salvarCampanha}>
            {saving ? 'Salvando…' : editandoCampanhaId ? 'Salvar alterações' : 'Criar campanha'}
          </Button>
        </div>
      </div>

      {/* ── Drawer: Cupom ────────────────────────────────────────────────── */}
      {drawerCupom && <div className="fixed inset-0 z-40 bg-[#111827]/40" onClick={() => setDrawerCupom(false)} />}
      <div className={['fixed right-0 top-0 z-50 flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl transition-transform duration-300', drawerCupom ? 'translate-x-0' : 'translate-x-full'].join(' ')}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-bold text-text-main">{editandoCupomId ? 'Editar cupom' : 'Novo cupom'}</h2>
          <button onClick={() => setDrawerCupom(false)} className="flex h-8 w-8 items-center justify-center rounded-full bg-page text-xl font-light text-text-subtle hover:text-text-main">×</button>
        </div>

        {drawerCupom && (
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            <Field label="Código do cupom" hint="É o que o cliente digita no checkout. Sem espaços.">
              <input
                value={formCupom.codigo}
                onChange={(e) => setFormCupom((f) => ({ ...f, codigo: e.target.value.toUpperCase().replace(/\s+/g, '') }))}
                placeholder="Ex: VOLTA10"
                className={`${INPUT_CLS} font-mono font-bold tracking-wide uppercase`}
              />
            </Field>

            <Field label="Descrição" hint="Aparece para o cliente junto do cupom.">
              <textarea
                rows={2}
                value={formCupom.descricao}
                onChange={(e) => setFormCupom((f) => ({ ...f, descricao: e.target.value }))}
                placeholder="Ex: 10% de desconto para você voltar a pedir!"
                className={`${INPUT_CLS} resize-none`}
              />
            </Field>

            <Field label="Tipo de desconto">
              <select
                value={formCupom.tipo}
                onChange={(e) => setFormCupom((f) => ({ ...f, tipo: e.target.value as CupomForm['tipo'] }))}
                className={INPUT_CLS}
              >
                {(Object.keys(CUPOM_TIPO_LABEL) as CupomForm['tipo'][]).map((t) => (
                  <option key={t} value={t}>{CUPOM_TIPO_LABEL[t]}</option>
                ))}
              </select>
            </Field>

            {cupomTemValor && (
              <Field label={formCupom.tipo === 'desconto_percentual' ? 'Desconto (%)' : 'Desconto (R$)'}>
                <input
                  type="number" min={0}
                  max={formCupom.tipo === 'desconto_percentual' ? 100 : undefined}
                  step={formCupom.tipo === 'desconto_percentual' ? 1 : 0.5}
                  value={formCupom.valor}
                  onChange={(e) => setFormCupom((f) => ({ ...f, valor: e.target.value }))}
                  placeholder={formCupom.tipo === 'desconto_percentual' ? 'Ex: 10' : 'Ex: 15'}
                  className={INPUT_CLS}
                />
              </Field>
            )}

            {formCupom.tipo === 'item_gratis' && (
              <Field label="Item grátis">
                <ItemSelector itens={itens} value={formCupom.itemId} onChange={(id) => setFormCupom((f) => ({ ...f, itemId: id }))} />
              </Field>
            )}

            <Field label="Público">
              <select
                value={formCupom.publico}
                onChange={(e) => setFormCupom((f) => ({ ...f, publico: e.target.value as CupomForm['publico'] }))}
                className={INPUT_CLS}
              >
                {(Object.keys(PUBLICO_LABEL) as CupomForm['publico'][]).map((p) => (
                  <option key={p} value={p}>{PUBLICO_LABEL[p]}</option>
                ))}
              </select>
            </Field>

            {formCupom.publico === 'recompra' && (
              <Field label="Sem pedir há quantos dias?" hint="Também vale para quem fez no máximo 1 pedido.">
                <input
                  type="number" min={1} step={1}
                  value={formCupom.diasInatividade}
                  onChange={(e) => setFormCupom((f) => ({ ...f, diasInatividade: e.target.value }))}
                  placeholder="Ex: 30"
                  className={INPUT_CLS}
                />
              </Field>
            )}

            <Field label="Dias da semana" hint="Nenhum selecionado = vale todos os dias.">
              <DiasChips dias={formCupom.diasSemana} onChange={(dias) => setFormCupom((f) => ({ ...f, diasSemana: dias }))} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Válido a partir de">
                <input
                  type="date"
                  value={formCupom.validadeInicio}
                  onChange={(e) => setFormCupom((f) => ({ ...f, validadeInicio: e.target.value }))}
                  className={INPUT_CLS}
                />
              </Field>
              <Field label="Válido até">
                <input
                  type="date"
                  value={formCupom.validadeFim}
                  onChange={(e) => setFormCupom((f) => ({ ...f, validadeFim: e.target.value }))}
                  className={INPUT_CLS}
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Pedido mínimo (R$)" hint="Vazio = sem mínimo.">
                <input
                  type="number" min={0} step={5}
                  value={formCupom.valorMinimoPedido}
                  onChange={(e) => setFormCupom((f) => ({ ...f, valorMinimoPedido: e.target.value }))}
                  placeholder="Ex: 40"
                  className={INPUT_CLS}
                />
              </Field>
              <Field label="Máximo de usos" hint="Vazio = ilimitado.">
                <input
                  type="number" min={1} step={1}
                  value={formCupom.maxUsos}
                  onChange={(e) => setFormCupom((f) => ({ ...f, maxUsos: e.target.value }))}
                  placeholder="Ex: 100"
                  className={INPUT_CLS}
                />
              </Field>
            </div>

            <div className="space-y-3 border-t border-border pt-4">
              <ToggleRow
                label="Uso único por cliente"
                hint="Cada cliente só pode usar este cupom uma vez."
                checked={formCupom.usoUnicoPorCliente}
                onChange={(v) => setFormCupom((f) => ({ ...f, usoUnicoPorCliente: v }))}
              />
              <ToggleRow
                label="Cupom ativo"
                hint="Só cupons ativos podem ser aplicados no checkout."
                checked={formCupom.ativo}
                onChange={(v) => setFormCupom((f) => ({ ...f, ativo: v }))}
              />
            </div>

            {erro && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>}
          </div>
        )}

        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-border bg-white px-5 py-4">
          <Button variant="outline" onClick={() => setDrawerCupom(false)}>Cancelar</Button>
          <Button disabled={saving} onClick={salvarCupom}>
            {saving ? 'Salvando…' : editandoCupomId ? 'Salvar alterações' : 'Criar cupom'}
          </Button>
        </div>
      </div>
    </div>
  )
}
