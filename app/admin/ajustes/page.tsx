'use client'

import { useEffect, useMemo, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, type LayoutCardapio } from '@/lib/queries/cardapio'
import {
  buscarConfigLoja,
  atualizarConfigLoja,
  listarTaxasBairro,
  criarTaxaBairro,
  atualizarTaxaBairro,
  removerTaxaBairro,
  type ConfigLoja,
  type TaxaBairro,
} from '@/lib/queries/ajustes'

type Tab = 'loja' | 'entrega' | 'integracoes'

const TABS: { id: Tab; label: string }[] = [
  { id: 'loja', label: 'Perfil da loja' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'integracoes', label: 'Integrações' },
]

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11px] text-text-subtle">{hint}</p>}
    </div>
  )
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={[
        'w-full rounded-menuzia border border-border bg-white px-3 py-2.5 font-sans text-sm text-text-main outline-none transition-colors',
        'focus:border-primary placeholder:text-text-subtle/60 disabled:bg-page disabled:text-text-subtle',
        props.className ?? '',
      ].join(' ')}
    />
  )
}

function SaveBar({ saved, saving, onSave }: { saved: boolean; saving: boolean; onSave: () => void }) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-main px-5 py-3">
      {saved && !saving
        ? <span className="text-[13px] font-medium text-status-ready">Alterações salvas.</span>
        : <span />}
      <Button onClick={onSave} disabled={saving}>
        {saving ? 'Salvando…' : 'Salvar alterações'}
      </Button>
    </div>
  )
}

// ─── Aba Loja ─────────────────────────────────────────────────────────────────

function TabLoja({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [config, setConfig] = useState<ConfigLoja | null>(null)
  const [form, setForm] = useState({ nome: '', telefone: '', endereco: '', logoUrl: '', bannerUrl: '', layoutCardapio: 'categoria' as LayoutCardapio })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      setConfig(c)
      setForm({ nome: c.nome, telefone: c.telefone, endereco: c.endereco, logoUrl: c.logoUrl ?? '', bannerUrl: c.bannerUrl ?? '', layoutCardapio: c.layoutCardapio })
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  function set(key: 'nome' | 'telefone' | 'endereco' | 'logoUrl' | 'bannerUrl', value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  function setLayout(value: LayoutCardapio) {
    setForm((f) => ({ ...f, layoutCardapio: value }))
    setSaved(false)
  }

  async function save() {
    if (!form.nome.trim()) { setError('O nome do estabelecimento é obrigatório.'); return }
    setSaving(true)
    setError(null)
    try {
      const updated = await atualizarConfigLoja(supabase, restauranteId, {
        nome: form.nome.trim(),
        telefone: form.telefone.trim(),
        endereco: form.endereco.trim(),
        logoUrl: form.logoUrl.trim() || null,
        bannerUrl: form.bannerUrl.trim() || null,
        layoutCardapio: form.layoutCardapio,
      })
      setConfig(updated)
      setSaved(true)
    } catch {
      setError('Não foi possível salvar as alterações. Verifique sua conexão e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-xl space-y-5">
          <Field label="Nome do estabelecimento">
            <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex: Burger House" />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input value={form.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="(00) 00000-0000" />
          </Field>
          <Field label="Endereço">
            <Input value={form.endereco} onChange={(e) => set('endereco', e.target.value)} placeholder="Rua, número, bairro, cidade" />
          </Field>
          <Field label="URL do logotipo" hint="Deixe em branco para usar a inicial do nome como avatar.">
            <Input
              value={form.logoUrl}
              onChange={(e) => set('logoUrl', e.target.value)}
              placeholder="https://..."
            />
          </Field>
          <Field label="Banner de capa" hint="Imagem de capa exibida no topo do cardápio do cliente. Deixe em branco para usar o degradê padrão.">
            <Input
              value={form.bannerUrl}
              onChange={(e) => set('bannerUrl', e.target.value)}
              placeholder="https://..."
            />
          </Field>
          <Field label="Apresentação do cardápio" hint="Define como os itens aparecem para o cliente na vitrine pública.">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setLayout('categoria')}
                className={[
                  'rounded-menuzia border px-3.5 py-3 text-left transition-colors',
                  form.layoutCardapio === 'categoria' ? 'border-primary bg-[#ECFEFF]' : 'border-border bg-white hover:border-primary/50',
                ].join(' ')}
              >
                <div className="text-[13px] font-semibold text-text-main">Categorias</div>
                <div className="mt-0.5 text-[11px] text-text-subtle">Cards grandes, 2 por linha</div>
              </button>
              <button
                type="button"
                onClick={() => setLayout('lista')}
                className={[
                  'rounded-menuzia border px-3.5 py-3 text-left transition-colors',
                  form.layoutCardapio === 'lista' ? 'border-primary bg-[#ECFEFF]' : 'border-border bg-white hover:border-primary/50',
                ].join(' ')}
              >
                <div className="text-[13px] font-semibold text-text-main">Lista</div>
                <div className="mt-0.5 text-[11px] text-text-subtle">Itens em lista compacta</div>
              </button>
            </div>
          </Field>
          {config && (
            <Field label="Slug (endereço público da loja)" hint="O slug é gerado automaticamente e não pode ser alterado por aqui.">
              <div className="flex items-center gap-2.5 rounded-menuzia border border-border bg-page px-3 py-2.5">
                <span className="text-sm text-text-subtle">cardapio.app/loja/</span>
                <span className="text-sm font-semibold text-text-main">{config.slug}</span>
              </div>
            </Field>
          )}
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={save} />
    </div>
  )
}

// ─── Aba Entrega ──────────────────────────────────────────────────────────────

function TabEntrega({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [taxaPadrao, setTaxaPadrao] = useState('')
  const [taxaPadraoSalva, setTaxaPadraoSalva] = useState(0)
  const [bairros, setBairros] = useState<TaxaBairro[]>([])
  const [saving, setSaving] = useState(false)
  const [savedTaxa, setSavedTaxa] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBairro, setEditBairro] = useState('')
  const [editTaxa, setEditTaxa] = useState('')

  const [newBairro, setNewBairro] = useState('')
  const [newTaxa, setNewTaxa] = useState('')
  const [addingRow, setAddingRow] = useState(false)

  useEffect(() => {
    if (loaded) return
    async function load() {
      const [cfg, rows] = await Promise.all([
        buscarConfigLoja(supabase, restauranteId),
        listarTaxasBairro(supabase, restauranteId),
      ])
      if (cfg) {
        setTaxaPadrao(String(cfg.taxaEntregaPadrao))
        setTaxaPadraoSalva(cfg.taxaEntregaPadrao)
      }
      setBairros(rows)
      setLoaded(true)
    }
    load()
  }, [supabase, restauranteId, loaded])

  async function saveTaxaPadrao() {
    const val = parseFloat(taxaPadrao.replace(',', '.'))
    if (!Number.isFinite(val) || val < 0) { setError('Informe um valor numérico válido para a taxa padrão (ex: 5.00).'); return }
    setSaving(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, { taxaEntregaPadrao: val })
      setTaxaPadraoSalva(val)
      setSavedTaxa(true)
    } catch {
      setError('Não foi possível salvar a taxa padrão.')
    } finally {
      setSaving(false)
    }
  }

  async function addBairroRow() {
    if (!newBairro.trim()) return
    const val = parseFloat(newTaxa.replace(',', '.'))
    const taxa = Number.isFinite(val) && val >= 0 ? val : 0
    setAddingRow(true)
    setError(null)
    try {
      const row = await criarTaxaBairro(supabase, restauranteId, newBairro.trim(), taxa)
      setBairros((prev) => [...prev, row])
      setNewBairro('')
      setNewTaxa('')
    } catch {
      setError('Não foi possível adicionar o bairro.')
    } finally {
      setAddingRow(false)
    }
  }

  async function saveEditRow(id: string) {
    if (!editBairro.trim()) return
    const val = parseFloat(editTaxa.replace(',', '.'))
    const taxa = Number.isFinite(val) && val >= 0 ? val : 0
    setError(null)
    try {
      await atualizarTaxaBairro(supabase, id, editBairro.trim(), taxa)
      setBairros((prev) => prev.map((b) => (b.id === id ? { ...b, bairro: editBairro.trim(), taxa } : b)))
      setEditingId(null)
    } catch {
      setError('Não foi possível atualizar o bairro.')
    }
  }

  async function deleteRow(id: string) {
    setError(null)
    try {
      await removerTaxaBairro(supabase, id)
      setBairros((prev) => prev.filter((b) => b.id !== id))
    } catch {
      setError('Não foi possível remover o bairro.')
    }
  }

  const taxaChanged = parseFloat(taxaPadrao.replace(',', '.')) !== taxaPadraoSalva

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-xl space-y-8">
          {/* Taxa padrão */}
          <div>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Taxa padrão de entrega</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Aplicada quando o bairro do cliente não constar na tabela abaixo, ou quando nenhuma taxa por bairro estiver cadastrada.
            </p>
            <div className="flex items-center gap-3">
              <div className="w-40">
                <Input
                  value={taxaPadrao}
                  onChange={(e) => { setTaxaPadrao(e.target.value); setSavedTaxa(false) }}
                  placeholder="Ex: 5.00"
                />
              </div>
              <span className="text-sm text-text-subtle">R$</span>
              <Button variant="outline" onClick={saveTaxaPadrao} disabled={saving || !taxaChanged}>
                {saving ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
            {savedTaxa && !taxaChanged && <p className="mt-1.5 text-[12px] font-medium text-status-ready">Taxa padrão salva.</p>}
          </div>

          {/* Taxas por bairro */}
          <div>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Taxas por bairro</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Quando o cliente informa o bairro no checkout, o sistema usa a taxa correspondente (ou a padrão acima).
            </p>
            <div className="overflow-hidden rounded-menuzia border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-page">
                    <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Bairro</th>
                    <th className="px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Taxa (R$)</th>
                    <th className="w-24 px-3.5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {bairros.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3.5 py-4 text-center text-[13px] text-text-subtle">
                        Nenhum bairro cadastrado. Use a linha abaixo para adicionar.
                      </td>
                    </tr>
                  )}
                  {bairros.map((b) =>
                    editingId === b.id ? (
                      <tr key={b.id} className="border-b border-border bg-[#ECFEFF]">
                        <td className="px-2.5 py-2">
                          <Input value={editBairro} onChange={(e) => setEditBairro(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditRow(b.id)} className="py-1.5" />
                        </td>
                        <td className="px-2.5 py-2">
                          <Input value={editTaxa} onChange={(e) => setEditTaxa(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEditRow(b.id)} className="py-1.5 text-right" />
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex justify-end gap-1.5">
                            <button onClick={() => saveEditRow(b.id)} className="text-[12px] font-semibold text-primary hover:underline">Salvar</button>
                            <button onClick={() => setEditingId(null)} className="text-[12px] text-text-subtle hover:text-text-main">Cancelar</button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={b.id} className="border-b border-border last:border-none hover:bg-page">
                        <td className="px-3.5 py-2.5 font-medium">{b.bairro}</td>
                        <td className="px-3.5 py-2.5 text-right tabular-nums">{b.taxa.toFixed(2).replace('.', ',')}</td>
                        <td className="px-3.5 py-2.5">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => { setEditingId(b.id); setEditBairro(b.bairro); setEditTaxa(String(b.taxa)) }}
                              className="text-[12px] text-text-subtle hover:text-primary"
                            >Editar</button>
                            <button onClick={() => deleteRow(b.id)} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                  {/* Nova linha */}
                  <tr className="bg-page">
                    <td className="px-2.5 py-2">
                      <Input value={newBairro} onChange={(e) => setNewBairro(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addBairroRow()}
                        placeholder="Nome do bairro" className="py-1.5" />
                    </td>
                    <td className="px-2.5 py-2">
                      <Input value={newTaxa} onChange={(e) => setNewTaxa(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addBairroRow()}
                        placeholder="0,00" className="py-1.5 text-right" />
                    </td>
                    <td className="px-2.5 py-2">
                      <Button variant="outline" onClick={addBairroRow} disabled={addingRow || !newBairro.trim()} className="w-full justify-center">
                        + Adicionar
                      </Button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Aba Integrações ──────────────────────────────────────────────────────────

function TabIntegracoes({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({ facebookPixelId: '', googleTagId: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      setForm({ facebookPixelId: c.facebookPixelId ?? '', googleTagId: c.googleTagId ?? '' })
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  function set(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, {
        facebookPixelId: form.facebookPixelId.trim() || null,
        googleTagId: form.googleTagId.trim() || null,
      })
      setSaved(true)
    } catch {
      setError('Não foi possível salvar as integrações. Verifique sua conexão e tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-xl space-y-8">
          <div>
            <h3 className="mb-0.5 text-[13px] font-bold text-text-main">Facebook Pixel</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Rastreie visualizações, adições ao carrinho e pedidos concluídos no cardápio da sua loja.
              Cada loja tem seu próprio Pixel — o código é injetado apenas no cardápio público desta loja.
            </p>
            <Field label="Pixel ID">
              <Input value={form.facebookPixelId} onChange={(e) => set('facebookPixelId', e.target.value)} placeholder="Ex: 1234567890123456" />
            </Field>
          </div>
          <div>
            <h3 className="mb-0.5 text-[13px] font-bold text-text-main">Google Tag (GA4 / GTM)</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Insira o ID de medição do Google Analytics 4 (<code className="rounded bg-page px-1 text-[11px]">G-XXXXXXXXXX</code>) ou o ID do
              Google Tag Manager (<code className="rounded bg-page px-1 text-[11px]">GTM-XXXXXX</code>).
              O snippet é injetado no &lt;head&gt; do cardápio público desta loja.
            </p>
            <Field label="Tag ID">
              <Input value={form.googleTagId} onChange={(e) => set('googleTagId', e.target.value)} placeholder="Ex: G-ABC123XYZ ou GTM-XXXXXX" />
            </Field>
          </div>
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={save} />
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function AjustesPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('loja')

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then(setRestauranteId)
  }, [supabase])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Ajustes" breadcrumb="Configurações da loja" />

      {/* Tab bar */}
      <div className="flex flex-shrink-0 gap-0.5 border-b border-border bg-main px-5 pt-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={[
              'rounded-t-menuzia border-b-2 px-4 pb-3 pt-2 text-[13px] font-semibold transition-colors',
              tab === t.id ? 'border-primary text-primary' : 'border-transparent text-text-subtle hover:text-text-main',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content — all mounted, only active is visible (preserves form state on tab switch) */}
      {!restauranteId ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-subtle">Carregando…</div>
      ) : (
        <>
          <TabLoja restauranteId={restauranteId} active={tab === 'loja'} />
          <TabEntrega restauranteId={restauranteId} active={tab === 'entrega'} />
          <TabIntegracoes restauranteId={restauranteId} active={tab === 'integracoes'} />
        </>
      )}
    </div>
  )
}
