'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { FacebookIcon, GoogleIcon, WhatsAppIcon } from '@/components/ui/brand-icons'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, type LayoutCardapio } from '@/lib/queries/cardapio'
import {
  buscarConfigLoja,
  atualizarConfigLoja,
  enviarLogoLoja,
  enviarBannerLoja,
  listarTaxasBairro,
  criarTaxaBairro,
  atualizarTaxaBairro,
  removerTaxaBairro,
  type ConfigLoja,
  type TaxaBairro,
} from '@/lib/queries/ajustes'
import { PALETAS, temaCores } from '@/lib/paletas'
import {
  buscarConfigImpressao,
  atualizarConfigImpressao,
  gerarTokenAgente,
  listarImpressoras,
  criarImpressora,
  atualizarImpressora,
  removerImpressora,
  type ConfigImpressao,
  type Impressora,
  type ImpressoraInput,
} from '@/lib/queries/impressao'

type Tab = 'loja' | 'entrega' | 'impressao' | 'integracoes' | 'conta' | 'aparencia'

const TABS: { id: Tab; label: string }[] = [
  { id: 'loja', label: 'Perfil da loja' },
  { id: 'entrega', label: 'Entrega' },
  { id: 'aparencia', label: 'Aparência' },
  { id: 'impressao', label: 'Impressão' },
  { id: 'integracoes', label: 'Integrações' },
  { id: 'conta', label: 'Conta' },
]

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

function ToggleRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-none">
      <div>
        <div className="text-[13px] font-medium text-text-main">{label}</div>
        {hint && <p className="mt-0.5 text-[11px] text-text-subtle">{hint}</p>}
      </div>
      <ToggleSwitch checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  )
}

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
  const [form, setForm] = useState({ nome: '', telefone: '', endereco: '', cep: '', logoUrl: '', bannerUrl: '', layoutCardapio: 'categoria' as LayoutCardapio, imagemGrande: false })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const bannerInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      setConfig(c)
      setForm({ nome: c.nome, telefone: c.telefone, endereco: c.endereco, cep: c.cep ?? '', logoUrl: c.logoUrl ?? '', bannerUrl: c.bannerUrl ?? '', layoutCardapio: c.layoutCardapio, imagemGrande: c.imagemGrande })
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  function set(key: 'nome' | 'telefone' | 'endereco' | 'cep' | 'logoUrl' | 'bannerUrl', value: string) {
    setForm((f) => ({ ...f, [key]: value }))
    setSaved(false)
  }

  async function handleLogoPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingLogo(true)
    setError(null)
    try {
      const url = await enviarLogoLoja(supabase, restauranteId, file)
      set('logoUrl', url)
    } catch {
      setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function handleBannerPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setUploadingBanner(true)
    setError(null)
    try {
      const url = await enviarBannerLoja(supabase, restauranteId, file)
      set('bannerUrl', url)
    } catch {
      setError('Não foi possível enviar a imagem. Verifique se o bucket "cardapio" existe no Supabase Storage.')
    } finally {
      setUploadingBanner(false)
    }
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
        cep: form.cep.trim(),
        logoUrl: form.logoUrl.trim() || null,
        bannerUrl: form.bannerUrl.trim() || null,
        layoutCardapio: form.layoutCardapio,
        imagemGrande: form.imagemGrande,
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
        <Card className="max-w-xl space-y-5">
          <Field label="Nome do estabelecimento">
            <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex: Burger House" />
          </Field>
          <Field label="Telefone / WhatsApp">
            <Input value={form.telefone} onChange={(e) => set('telefone', e.target.value)} placeholder="(00) 00000-0000" />
          </Field>
          <Field label="Endereço">
            <Input value={form.endereco} onChange={(e) => set('endereco', e.target.value)} placeholder="Rua, número, bairro, cidade" />
          </Field>
          <Field label="CEP" hint="Usado para centralizar o mapa de calor do Dashboard na região da sua loja e posicionar corretamente os bairros das entregas.">
            <Input value={form.cep} onChange={(e) => set('cep', e.target.value)} placeholder="00000-000" inputMode="numeric" autoComplete="postal-code" name="cep" />
          </Field>
          <Field label="Logotipo" hint="Exibido como avatar da loja no painel e no cardápio do cliente. Deixe em branco para usar a inicial do nome.">
            <div className="flex items-center gap-3">
              {form.logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={form.logoUrl} alt="Logotipo" className="h-16 w-16 rounded-menuzia border border-border object-cover" />
                : <div className="flex h-16 w-16 items-center justify-center rounded-menuzia border border-border bg-page text-xl font-bold text-text-subtle">
                    {form.nome.trim().charAt(0).toUpperCase() || '?'}
                  </div>
              }
              <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
              <div className="flex flex-col gap-1.5">
                <Button variant="outline" type="button" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo}>
                  {uploadingLogo ? 'Enviando…' : form.logoUrl ? 'Trocar imagem' : 'Enviar imagem'}
                </Button>
                {form.logoUrl && (
                  <button type="button" onClick={() => set('logoUrl', '')} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                )}
              </div>
            </div>
          </Field>
          <Field label="Banner de capa" hint="Imagem de capa exibida no topo do cardápio do cliente. Deixe em branco para usar o degradê padrão.">
            <div className="space-y-2.5">
              {form.bannerUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={form.bannerUrl} alt="Banner de capa" className="h-28 w-full rounded-menuzia border border-border object-cover" />
              )}
              <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerPick} />
              <div className="flex items-center gap-3">
                <Button variant="outline" type="button" onClick={() => bannerInputRef.current?.click()} disabled={uploadingBanner}>
                  {uploadingBanner ? 'Enviando…' : form.bannerUrl ? 'Trocar imagem' : 'Enviar imagem'}
                </Button>
                {form.bannerUrl && (
                  <button type="button" onClick={() => set('bannerUrl', '')} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                )}
              </div>
            </div>
          </Field>
          <Field label="Apresentação do cardápio" hint="Define como os itens aparecem para o cliente na vitrine pública.">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setLayout('categoria')}
                className={[
                  'rounded-menuzia border px-3.5 py-3 text-left transition-colors',
                  form.layoutCardapio === 'categoria' ? 'border-primary bg-primary/10' : 'border-border bg-white hover:border-primary/50',
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
                  form.layoutCardapio === 'lista' ? 'border-primary bg-primary/10' : 'border-border bg-white hover:border-primary/50',
                ].join(' ')}
              >
                <div className="text-[13px] font-semibold text-text-main">Lista</div>
                <div className="mt-0.5 text-[11px] text-text-subtle">Itens em lista compacta</div>
              </button>
            </div>
          </Field>
          <Field label="Imagem grande" hint="Na visualização em lista, mostra as imagens dos itens em 100×100 px.">
            <label className="flex cursor-pointer items-center gap-2.5 rounded-menuzia border border-border bg-white px-3.5 py-3">
              <input
                type="checkbox"
                checked={form.imagemGrande}
                onChange={(e) => setForm((f) => ({ ...f, imagemGrande: e.target.checked }))}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-[13px] font-medium text-text-main">Usar imagens grandes (100×100) na lista do cardápio</span>
            </label>
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
        </Card>
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
        <div className="max-w-xl space-y-6">
          {/* Taxa padrão */}
          <Card>
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
          </Card>

          {/* Taxas por bairro */}
          <Card>
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
                      <tr key={b.id} className="border-b border-border bg-primary/10">
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
          </Card>

          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
      </div>
    </div>
  )
}

// ─── Aba Impressão ──────────────────────────────────────────────────────────

const FABRICANTES = ['Epson', 'Bematech', 'Elgin', 'Daruma', 'Outra']
const TAMANHOS_FONTE = [
  { value: 'pequena', label: 'Pequena (recomendado)' },
  { value: 'media', label: 'Média' },
  { value: 'grande', label: 'Grande' },
]

const IMPRESSORA_VAZIA: ImpressoraInput = { nome: '', fabricante: 'Epson', impressoraSistema: '', tamanhoFonte: 'pequena', largura: 48, copias: 1 }

function ImpressoraModal({
  initial,
  onSave,
  onClose,
}: {
  initial: ImpressoraInput
  onSave: (input: ImpressoraInput) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<ImpressoraInput>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!form.nome.trim() || !form.impressoraSistema.trim()) {
      setError('Preencha o nome da impressora e o nome dela no sistema operacional.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(form)
    } catch {
      setError('Não foi possível salvar a impressora.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-menuzia bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-4.5 py-3.5">
          <h3 className="text-[15px] font-bold">Editar impressora</h3>
          <button onClick={onClose} className="flex h-[28px] w-[28px] items-center justify-center rounded-menuzia bg-page text-lg text-text-subtle hover:bg-border">×</button>
        </div>
        <div className="space-y-3.5 p-4.5">
          <Field label="Nome da impressora">
            <Input value={form.nome} onChange={(e) => setForm((p) => ({ ...p, nome: e.target.value }))} placeholder="Ex: Impressora Padrão" />
          </Field>
          <Field label="Fabricante da impressora">
            <select value={form.fabricante} onChange={(e) => setForm((p) => ({ ...p, fabricante: e.target.value }))}
              className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary">
              {FABRICANTES.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Nome da impressora no Windows" hint='Copie o nome exato como aparece em "Impressoras e scanners" do Windows. Depois que o Assistente de Impressão estiver pareado, essa lista passa a ser preenchida automaticamente.'>
            <Input value={form.impressoraSistema} onChange={(e) => setForm((p) => ({ ...p, impressoraSistema: e.target.value }))} placeholder="Ex: EPSON TM-T20X" />
          </Field>
          <div className="flex gap-3">
            <div className="flex-1">
              <Field label="Tamanho da fonte">
                <select value={form.tamanhoFonte} onChange={(e) => setForm((p) => ({ ...p, tamanhoFonte: e.target.value }))}
                  className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary">
                  {TAMANHOS_FONTE.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
            </div>
            <div className="w-28">
              <Field label="Largura" hint="colunas">
                <Input type="number" min={32} value={form.largura} onChange={(e) => setForm((p) => ({ ...p, largura: Number(e.target.value) || 0 }))} />
              </Field>
            </div>
          </div>
          <Field label="Cópias impressas por pedido">
            <Input type="number" min={1} max={5} value={form.copias} onChange={(e) => setForm((p) => ({ ...p, copias: Number(e.target.value) || 1 }))} />
          </Field>
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
        <div className="flex gap-2.5 border-t border-border p-4.5">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button className="flex-1" onClick={handleSave} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
        </div>
      </div>
    </div>
  )
}

// Pedido fictício só pra ilustrar o preview — não vem do banco.
const PEDIDO_PREVIEW = {
  numero: 1234,
  tipo: 'Entrega',
  cliente: 'João Silva',
  endereco: 'Rua das Flores, 123 - Centro',
  pagamento: 'Pix',
  itens: [
    { qtd: 2, nome: 'Pizza Grande - Calabresa', precoUnit: 45, complementos: [{ nome: 'Borda: Catupiry', preco: 8 }] },
    { qtd: 1, nome: 'Coca-Cola 2L', precoUnit: 12, complementos: [] },
  ],
  taxaEntrega: 6,
}

function gerarPreviewRecibo(config: ConfigImpressao, nomeLoja: string, logoUrl: string | null): string[] {
  const linhas: string[] = []
  if (config.imprimirLogo && !logoUrl) linhas.push(`[ LOGO — ${nomeLoja || 'SUA LOJA'} ]`)
  linhas.push(`PEDIDO #${PEDIDO_PREVIEW.numero}  ·  ${PEDIDO_PREVIEW.tipo.toUpperCase()}`)
  linhas.push('--------------------------------')
  linhas.push(`Cliente: ${PEDIDO_PREVIEW.cliente}`)
  linhas.push(`End.: ${PEDIDO_PREVIEW.endereco}`)
  linhas.push('--------------------------------')

  let subtotal = 0
  for (const item of PEDIDO_PREVIEW.itens) {
    const nomeItem = config.mostrarNumeroItem ? `${item.qtd}x ${item.nome}` : item.nome
    const totalItem = item.precoUnit * item.qtd
    subtotal += totalItem
    linhas.push(`${config.fonteMaiorProducao ? nomeItem.toUpperCase() : nomeItem}  R$ ${totalItem.toFixed(2).replace('.', ',')}`)
    if (config.mostrarNomeComplementos) {
      for (const comp of item.complementos) {
        const precoComp = comp.preco * (config.multiplicarOpcoesQtd ? item.qtd : 1)
        const precoTxt = config.mostrarPrecoComplementos ? ` (+R$ ${precoComp.toFixed(2).replace('.', ',')})` : ''
        linhas.push(`   + ${comp.nome}${precoTxt}`)
      }
    }
  }

  linhas.push('--------------------------------')
  linhas.push(`Subtotal              R$ ${subtotal.toFixed(2).replace('.', ',')}`)
  linhas.push(`Taxa de entrega       R$ ${PEDIDO_PREVIEW.taxaEntrega.toFixed(2).replace('.', ',')}`)
  linhas.push(`TOTAL                 R$ ${(subtotal + PEDIDO_PREVIEW.taxaEntrega).toFixed(2).replace('.', ',')}`)
  linhas.push('--------------------------------')
  linhas.push(`Pagamento: ${PEDIDO_PREVIEW.pagamento.toUpperCase()}`)
  if (config.imprimirQrcodeAvaliacao) linhas.push('', '[ QR CODE — avalie seu pedido ]')
  return linhas
}

function ReciboPreview({ config, nomeLoja, logoUrl }: { config: ConfigImpressao; nomeLoja: string; logoUrl: string | null }) {
  const linhas = useMemo(() => gerarPreviewRecibo(config, nomeLoja, logoUrl), [config, nomeLoja, logoUrl])
  return (
    <div className="sticky top-0">
      <h3 className="mb-2 text-[13px] font-bold text-text-main">Como vai ficar o recibo</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
        Prévia ilustrativa — atualiza ao vivo conforme você muda as configurações. O agente desktop usa essas mesmas regras de verdade.
      </p>
      <div className="rounded-menuzia border border-border bg-[#F3F4F6] p-4">
        {config.imprimirLogo && logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo da loja" className="mx-auto mb-2 h-12 w-12 rounded-menuzia border border-border bg-white object-contain" />
        )}
        <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-white p-3 font-mono text-[11px] leading-relaxed text-text-main shadow-sm">
          {linhas.join('\n')}
        </pre>
      </div>
      {config.imprimirComprovanteCancelamento && (
        <p className="mt-2 text-[11px] text-text-subtle">+ pedidos cancelados também geram um comprovante extra (não mostrado aqui).</p>
      )}
    </div>
  )
}

function TabImpressao({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [config, setConfig] = useState<ConfigImpressao | null>(null)
  const [impressoras, setImpressoras] = useState<Impressora[]>([])
  const [nomeLoja, setNomeLoja] = useState('')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<{ id: string | null; input: ImpressoraInput } | null>(null)
  const [gerandoToken, setGerandoToken] = useState(false)
  const [tokenCopiado, setTokenCopiado] = useState(false)

  useEffect(() => {
    if (loaded) return
    Promise.all([buscarConfigImpressao(supabase, restauranteId), listarImpressoras(supabase, restauranteId), buscarConfigLoja(supabase, restauranteId)]).then(([cfg, lista, loja]) => {
      setConfig(cfg)
      setImpressoras(lista)
      setNomeLoja(loja?.nome ?? '')
      setLogoUrl(loja?.logoUrl ?? null)
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  async function patch(p: Partial<ConfigImpressao>) {
    if (!config) return
    setConfig({ ...config, ...p })
    try {
      await atualizarConfigImpressao(supabase, restauranteId, p)
    } catch {
      setError('Não foi possível salvar a configuração.')
    }
  }

  async function handleGerarToken() {
    setGerandoToken(true)
    try {
      const token = await gerarTokenAgente(supabase, restauranteId)
      setConfig((prev) => (prev ? { ...prev, agenteToken: token } : prev))
    } catch {
      setError('Não foi possível gerar o token de pareamento.')
    } finally {
      setGerandoToken(false)
    }
  }

  function copiarToken() {
    if (!config?.agenteToken) return
    navigator.clipboard.writeText(config.agenteToken).then(() => {
      setTokenCopiado(true)
      setTimeout(() => setTokenCopiado(false), 2000)
    })
  }

  async function salvarImpressora(input: ImpressoraInput) {
    if (modal?.id) {
      await atualizarImpressora(supabase, modal.id, input)
      setImpressoras((prev) => prev.map((i) => (i.id === modal.id ? { ...i, ...input } : i)))
    } else {
      const nova = await criarImpressora(supabase, restauranteId, input, impressoras.length)
      setImpressoras((prev) => [...prev, nova])
    }
    setModal(null)
  }

  async function excluirImpressora(id: string) {
    if (!confirm('Excluir esta impressora?')) return
    try {
      await removerImpressora(supabase, id)
      setImpressoras((prev) => prev.filter((i) => i.id !== id))
    } catch {
      setError('Não foi possível excluir a impressora.')
    }
  }

  if (!loaded || !config) {
    return <div className={['flex flex-1 items-center justify-center text-sm text-text-subtle', !active ? 'hidden' : ''].join(' ')}>Carregando…</div>
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="grid grid-cols-1 gap-5 xl:max-w-[1040px] xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Assistente de Impressão */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Assistente de Impressão Menuzia</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Programa instalado no computador da loja que liga o Menuzia à impressora física. Baixe, gere o
              token abaixo e cole-o no Assistente ao abrir pela primeira vez — depois disso, os pedidos podem ser
              impressos automaticamente sem precisar abrir o navegador.
            </p>
            <a
              href="https://github.com/felipe1santos/cardapio/releases/download/printer-agent-v0.1.3/AssistenteImpressaoMenuzia-Setup-0.1.3.exe"
              className="mb-3 inline-flex items-center gap-1.5 rounded-menuzia bg-yellow-300 px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-black transition-colors hover:bg-yellow-400"
            >
              ⬇ Baixar Assistente de Impressão (Windows)
            </a>
            <p className="mb-3 text-[11px] text-text-subtle">
              Baixa o instalador (.exe, ~75MB). É só dar dois cliques: ele instala sozinho (sem pedir senha de
              administrador), cria um atalho na área de trabalho e abre o programa. Se aparecer
              &ldquo;O Windows protegeu o computador&rdquo;, clique em &ldquo;Mais informações&rdquo; → &ldquo;Executar assim mesmo&rdquo;.
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-menuzia border border-alert-bg bg-alert-bg/60 p-3">
              <span className="text-[12px] font-semibold text-alert-text">Primeira vez configurando? Siga o guia passo a passo:</span>
              <a
                href="/guia-impressora.pdf"
                download
                className="inline-flex items-center gap-1.5 rounded-menuzia bg-primary px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-white transition-colors hover:bg-primary-dark"
              >
                📄 Baixar guia em PDF
              </a>
              <a
                href="/guia-impressora.html"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-main transition-colors hover:border-primary hover:text-primary"
              >
                Abrir guia online
              </a>
            </div>
            <div className="rounded-menuzia border border-border p-4">
              <ToggleRow label="Ativar uso do Assistente de Impressão" checked={config.ativarAssistente} onChange={(v) => patch({ ativarAssistente: v })} />
              <ToggleRow label="Impressão automática de pedidos" hint="Imprime sozinho assim que o pedido chega, sem precisar clicar em nada." checked={config.impressaoAutomatica} onChange={(v) => patch({ impressaoAutomatica: v })} />
              <ToggleRow label="Aceitar pedidos automaticamente" hint="Move o pedido para “Preparando” no Kanban assim que ele chega." checked={config.aceitarPedidosAutomaticamente} onChange={(v) => patch({ aceitarPedidosAutomaticamente: v })} />

              <div className="mt-3 rounded-menuzia bg-page p-3">
                {config.agenteToken ? (
                  <>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Token de pareamento</div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 truncate rounded-menuzia border border-[#0B1220] bg-[#0B1220] px-2.5 py-2 font-mono text-[12px] tracking-wide text-cyan-300">{config.agenteToken}</code>
                      <Button variant="outline" onClick={copiarToken}>{tokenCopiado ? 'Copiado!' : 'Copiar'}</Button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-text-subtle">Cole esse token na tela de pareamento do Assistente de Impressão instalado no computador da loja.</p>
                    <button onClick={handleGerarToken} disabled={gerandoToken} className="mt-2 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50">
                      {gerandoToken ? 'Gerando…' : 'Gerar novo token (invalida o atual)'}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mb-2 text-[12px] text-text-subtle">Nenhum token gerado ainda. Gere um para parear o Assistente de Impressão com esta loja.</p>
                    <Button variant="outline" onClick={handleGerarToken} disabled={gerandoToken}>{gerandoToken ? 'Gerando…' : 'Gerar token de pareamento'}</Button>
                  </>
                )}
              </div>
            </div>
          </Card>

          {/* Impressoras cadastradas */}
          <Card>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-[13px] font-bold text-text-main">Impressoras</h3>
              <Button variant="outline" onClick={() => setModal({ id: null, input: IMPRESSORA_VAZIA })}>+ Nova impressora</Button>
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">Cadastre uma ou mais impressoras (ex.: cozinha e balcão).</p>
            <div className="overflow-hidden rounded-menuzia border border-border">
              {impressoras.length === 0 && (
                <div className="px-3.5 py-5 text-center text-[13px] text-text-subtle">Nenhuma impressora cadastrada ainda.</div>
              )}
              {impressoras.map((imp) => (
                <div key={imp.id} className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-3 last:border-none">
                  <div>
                    <div className="text-[13px] font-semibold text-text-main">{imp.nome}</div>
                    <div className="text-[11px] text-text-subtle">{imp.fabricante} · {imp.impressoraSistema || 'sem impressora do sistema vinculada'}</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setModal({ id: imp.id, input: { nome: imp.nome, fabricante: imp.fabricante, impressoraSistema: imp.impressoraSistema, tamanhoFonte: imp.tamanhoFonte, largura: imp.largura, copias: imp.copias } })}
                      className="text-[12px] font-semibold text-primary hover:underline"
                    >Editar</button>
                    <button onClick={() => excluirImpressora(imp.id)} className="text-[12px] text-text-subtle hover:text-danger">Remover</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Configurações gerais de impressão */}
          <Card>
            <h3 className="mb-1 text-[13px] font-bold text-text-main">Configurações gerais</h3>
            <div className="rounded-menuzia border border-border p-4">
              <ToggleRow label="Mostrar número do item na impressão" checked={config.mostrarNumeroItem} onChange={(v) => patch({ mostrarNumeroItem: v })} />
              <ToggleRow label="Mostrar preço dos complementos na impressão" checked={config.mostrarPrecoComplementos} onChange={(v) => patch({ mostrarPrecoComplementos: v })} />
              <ToggleRow label="Mostrar nome dos complementos na impressão" checked={config.mostrarNomeComplementos} onChange={(v) => patch({ mostrarNomeComplementos: v })} />
              <ToggleRow label="Usar fonte maior na via de produção" checked={config.fonteMaiorProducao} onChange={(v) => patch({ fonteMaiorProducao: v })} />
              <ToggleRow label="Multiplicar opções pela quantidade do produto" checked={config.multiplicarOpcoesQtd} onChange={(v) => patch({ multiplicarOpcoesQtd: v })} />
              <ToggleRow label="Imprimir logo da loja na nota" checked={config.imprimirLogo} onChange={(v) => patch({ imprimirLogo: v })} />
              <ToggleRow label="Imprimir comprovante de cancelamento" checked={config.imprimirComprovanteCancelamento} onChange={(v) => patch({ imprimirComprovanteCancelamento: v })} />
              <ToggleRow label="Imprimir QR Code de avaliação do pedido" hint="Entrega, retirada e no local. Nem toda impressora suporta essa função." checked={config.imprimirQrcodeAvaliacao} onChange={(v) => patch({ imprimirQrcodeAvaliacao: v })} />
            </div>
          </Card>

          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>

        <Card className="sticky top-0">
          <ReciboPreview config={config} nomeLoja={nomeLoja} logoUrl={logoUrl} />
        </Card>
        </div>
      </div>
      {modal && (
        <ImpressoraModal
          initial={modal.input}
          onClose={() => setModal(null)}
          onSave={salvarImpressora}
        />
      )}
    </div>
  )
}

// ─── Aba Integrações ──────────────────────────────────────────────────────────

interface WaStatus {
  configurado: boolean
  connected: boolean
  state: string | null
}

function TabIntegracoes({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [form, setForm] = useState({ facebookPixelId: '', googleTagId: '' })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [wa, setWa] = useState<WaStatus | null>(null)
  const [waQr, setWaQr] = useState<string | null>(null)
  const [waPairingCode, setWaPairingCode] = useState<string | null>(null)
  const [waBusy, setWaBusy] = useState(false)
  const [waError, setWaError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      setForm({ facebookPixelId: c.facebookPixelId ?? '', googleTagId: c.googleTagId ?? '' })
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  const atualizarStatusWhatsapp = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/whatsapp/status')
      const data: WaStatus = await res.json()
      setWa(data)
      if (data.connected) setWaQr(null)
      return data
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    atualizarStatusWhatsapp()
  }, [atualizarStatusWhatsapp])

  // Enquanto o QR está na tela, verifica a cada 3s se o WhatsApp já foi conectado.
  useEffect(() => {
    if (!waQr) return
    const interval = setInterval(async () => {
      const data = await atualizarStatusWhatsapp()
      if (data?.connected) clearInterval(interval)
    }, 3000)
    return () => clearInterval(interval)
  }, [waQr, atualizarStatusWhatsapp])

  async function conectarWhatsapp() {
    setWaBusy(true)
    setWaError(null)
    try {
      const res = await fetch('/api/admin/whatsapp/conectar', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Erro desconhecido')
      setWaQr(data.base64 ?? null)
      setWaPairingCode(data.pairingCode ?? null)
    } catch {
      setWaError('Não foi possível conectar. Verifique a configuração da Evolution API no servidor.')
    } finally {
      setWaBusy(false)
    }
  }

  async function desconectarWhatsapp() {
    setWaBusy(true)
    setWaError(null)
    try {
      await fetch('/api/admin/whatsapp/desconectar', { method: 'POST' })
      setWaQr(null)
      setWaPairingCode(null)
      await atualizarStatusWhatsapp()
    } finally {
      setWaBusy(false)
    }
  }

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
        <div className="max-w-xl space-y-6">
          <Card>
            <div className="mb-0.5 flex items-center gap-2">
              <WhatsAppIcon className="h-5 w-5 flex-shrink-0" />
              <h3 className="text-[13px] font-bold text-text-main">WhatsApp (Evolution API)</h3>
              {wa?.connected && (
                <span className="rounded-menuzia bg-price-bg px-2 py-0.5 text-[11px] font-semibold text-price-text">Conectado</span>
              )}
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Conecte o WhatsApp da loja para enviar automaticamente a confirmação do pedido (aceito), e os avisos de
              preparo, pronto e saiu para entrega ao cliente.
            </p>

            {wa === null ? (
              <p className="text-[12px] text-text-subtle">Verificando conexão…</p>
            ) : !wa.configurado ? (
              <p className="rounded-menuzia border border-warn bg-warn-bg px-3 py-2 text-[12px] text-warn">
                Evolution API não configurada no servidor (variáveis EVOLUTION_API_URL / EVOLUTION_API_KEY).
              </p>
            ) : wa.connected ? (
              <Button variant="outline" onClick={desconectarWhatsapp} disabled={waBusy}>
                {waBusy ? 'Desconectando…' : 'Desconectar WhatsApp'}
              </Button>
            ) : waQr ? (
              <div className="flex flex-col items-start gap-2">
                <img
                  src={waQr.startsWith('data:') ? waQr : `data:image/png;base64,${waQr}`}
                  alt="QR code para conectar o WhatsApp"
                  className="h-48 w-48 rounded-menuzia border border-border"
                />
                {waPairingCode && <p className="text-[12px] text-text-subtle">Código de pareamento: <span className="font-mono font-semibold">{waPairingCode}</span></p>}
                <p className="text-[12px] leading-relaxed text-text-subtle">
                  No celular da loja, abra o WhatsApp em <strong>Aparelhos conectados → Conectar um aparelho</strong> e escaneie o QR code acima.
                  A página atualiza automaticamente quando conectar.
                </p>
              </div>
            ) : (
              <Button onClick={conectarWhatsapp} disabled={waBusy}>
                {waBusy ? 'Gerando QR code…' : 'Conectar WhatsApp'}
              </Button>
            )}
            {waError && <p className="mt-2 rounded-menuzia border border-danger bg-danger-bg px-3 py-2 text-[12px] text-danger">{waError}</p>}
          </Card>
          <Card>
            <div className="mb-0.5 flex items-center gap-2">
              <FacebookIcon className="h-5 w-5 flex-shrink-0" />
              <h3 className="text-[13px] font-bold text-text-main">Facebook Pixel</h3>
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Rastreie visualizações, adições ao carrinho e pedidos concluídos no cardápio da sua loja.
              Cada loja tem seu próprio Pixel — o código é injetado apenas no cardápio público desta loja.
            </p>
            <Field label="Pixel ID">
              <Input value={form.facebookPixelId} onChange={(e) => set('facebookPixelId', e.target.value)} placeholder="Ex: 1234567890123456" />
            </Field>
          </Card>
          <Card>
            <div className="mb-0.5 flex items-center gap-2">
              <GoogleIcon className="h-5 w-5 flex-shrink-0" />
              <h3 className="text-[13px] font-bold text-text-main">Google Tag (GA4 / GTM)</h3>
            </div>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Insira o ID de medição do Google Analytics 4 (<code className="rounded bg-page px-1 text-[11px]">G-XXXXXXXXXX</code>) ou o ID do
              Google Tag Manager (<code className="rounded bg-page px-1 text-[11px]">GTM-XXXXXX</code>).
              O snippet é injetado no &lt;head&gt; do cardápio público desta loja.
            </p>
            <Field label="Tag ID">
              <Input value={form.googleTagId} onChange={(e) => set('googleTagId', e.target.value)} placeholder="Ex: G-ABC123XYZ ou GTM-XXXXXX" />
            </Field>
          </Card>
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </div>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={save} />
    </div>
  )
}

// ─── Aba Conta ────────────────────────────────────────────────────────────────

function TabConta({ active }: { active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [novaSenha, setNovaSenha] = useState('')
  const [confirmarSenha, setConfirmarSenha] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function salvar() {
    setError(null)
    if (novaSenha.length < 6) { setError('A senha deve ter no mínimo 6 caracteres.'); return }
    if (novaSenha !== confirmarSenha) { setError('As senhas não coincidem.'); return }
    setSaving(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha })
      if (error) throw error
      setNovaSenha('')
      setConfirmarSenha('')
      setSaved(true)
    } catch {
      setError('Não foi possível alterar a senha. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <Card className="max-w-xl space-y-5">
          <div>
            <h3 className="mb-0.5 text-[13px] font-bold text-text-main">Alterar senha</h3>
            <p className="mb-3 text-[12px] leading-relaxed text-text-subtle">
              Defina uma nova senha de acesso ao painel. Você continuará logado nesta sessão.
            </p>
          </div>
          <Field label="Nova senha">
            <Input
              type="password"
              value={novaSenha}
              onChange={(e) => { setNovaSenha(e.target.value); setSaved(false) }}
              placeholder="Mínimo 6 caracteres"
            />
          </Field>
          <Field label="Confirmar nova senha">
            <Input
              type="password"
              value={confirmarSenha}
              onChange={(e) => { setConfirmarSenha(e.target.value); setSaved(false) }}
              placeholder="Repita a nova senha"
            />
          </Field>
          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </Card>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={salvar} />
    </div>
  )
}

// ─── Aba Aparência ────────────────────────────────────────────────────────────

function TabAparencia({ restauranteId, active }: { restauranteId: string; active: boolean }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [loaded, setLoaded] = useState(false)
  const [corSelecionada, setCorSelecionada] = useState<string>('azul')
  const [corCustom, setCorCustom] = useState<string>('#008fba')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (loaded) return
    buscarConfigLoja(supabase, restauranteId).then((c) => {
      if (!c) return
      const cor = c.corTema ?? 'azul'
      if (cor.startsWith('#')) { setCorSelecionada('custom'); setCorCustom(cor) }
      else setCorSelecionada(cor)
      setLoaded(true)
    })
  }, [supabase, restauranteId, loaded])

  const paleta = corSelecionada === 'custom' ? temaCores(corCustom) : (PALETAS[corSelecionada] ?? PALETAS.azul)

  async function salvar() {
    setSaving(true)
    setError(null)
    try {
      await atualizarConfigLoja(supabase, restauranteId, { corTema: corSelecionada === 'custom' ? corCustom : corSelecionada })
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={['flex flex-1 flex-col overflow-hidden', !active ? 'hidden' : ''].join(' ')}>
      <div className="flex-1 overflow-y-auto px-5 py-6">
        <Card className="max-w-xl space-y-6">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Paleta de cores</p>
            <p className="mb-4 text-[13px] text-text-subtle">Define a cor primária do cardápio digital dos seus clientes — botões, chips de categoria, destaques e ícones.</p>
            <div className="grid grid-cols-5 gap-x-3 gap-y-4">
              {Object.entries(PALETAS).map(([key, p]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => { setCorSelecionada(key); setSaved(false) }}
                  className="flex flex-col items-center gap-1.5 group"
                >
                  <div
                    className="h-10 w-10 rounded-full border-2 transition-all duration-150 group-hover:scale-110"
                    style={{
                      background: `linear-gradient(135deg, ${p.from}, ${p.primaria})`,
                      borderColor: corSelecionada === key ? p.primaria : 'transparent',
                      boxShadow: corSelecionada === key ? `0 0 0 3px white, 0 0 0 5px ${p.primaria}` : undefined,
                      transform: corSelecionada === key ? 'scale(1.12)' : undefined,
                    }}
                  />
                  <span className="text-[10px] font-semibold text-text-subtle text-center leading-tight">{p.nome}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-menuzia border border-border p-4">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Cor personalizada</p>
            <div className="flex items-center gap-4">
              <label className="relative cursor-pointer flex-shrink-0">
                <div
                  className="h-12 w-12 rounded-full border-2 transition-all"
                  style={{
                    background: `linear-gradient(135deg, ${temaCores(corCustom).from}, ${corCustom})`,
                    borderColor: corSelecionada === 'custom' ? corCustom : 'transparent',
                    boxShadow: corSelecionada === 'custom' ? `0 0 0 3px white, 0 0 0 5px ${corCustom}` : undefined,
                    transform: corSelecionada === 'custom' ? 'scale(1.1)' : undefined,
                  }}
                />
                <input
                  type="color"
                  value={corCustom}
                  onChange={(e) => { setCorCustom(e.target.value); setCorSelecionada('custom'); setSaved(false) }}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
              <div className="flex-1">
                <p className="text-sm font-semibold">Hex personalizado</p>
                <p className="mt-0.5 font-mono text-[12px] text-text-subtle">{corCustom.toUpperCase()}</p>
                <p className="mt-1 text-[11px] text-text-subtle">Clique no círculo para escolher qualquer cor</p>
              </div>
              {corSelecionada === 'custom' && (
                <span className="flex-shrink-0 rounded px-2.5 py-1 text-[11px] font-bold text-white" style={{ backgroundColor: corCustom }}>Ativa</span>
              )}
            </div>
          </div>

          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pré-visualização</p>
            <div className="flex flex-wrap items-center gap-2 rounded-menuzia border border-border bg-page p-4">
              <button
                type="button"
                className="rounded-menuzia px-4 py-2 text-[12px] font-bold uppercase tracking-wide text-white transition-colors"
                style={{ backgroundColor: paleta.primaria }}
              >
                Adicionar
              </button>
              <button
                type="button"
                className="rounded-menuzia border px-4 py-2 text-[12px] font-bold uppercase tracking-wide transition-colors"
                style={{ borderColor: paleta.primaria, color: paleta.primaria, backgroundColor: paleta.light }}
              >
                Ver cardápio
              </button>
              <span
                className="rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ backgroundColor: paleta.light, color: paleta.primaria }}
              >
                Lanches
              </span>
              <span
                className="rounded-full px-3 py-1 text-[12px] font-semibold"
                style={{ backgroundColor: paleta.primaria, color: '#fff' }}
              >
                Combos
              </span>
            </div>
          </div>

          {error && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>}
        </Card>
      </div>
      <SaveBar saved={saved} saving={saving} onSave={salvar} />
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
              tab === t.id ? 'border-tab-active bg-tab-active text-white' : 'border-transparent text-text-subtle hover:text-text-main',
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
          <TabAparencia restauranteId={restauranteId} active={tab === 'aparencia'} />
          <TabImpressao restauranteId={restauranteId} active={tab === 'impressao'} />
          <TabIntegracoes restauranteId={restauranteId} active={tab === 'integracoes'} />
          <TabConta active={tab === 'conta'} />
        </>
      )}
    </div>
  )
}
