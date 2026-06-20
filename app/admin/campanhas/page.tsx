'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { uploadMidiaCampanha, type Campanha, type FiltroCampanha, type FiltroTipo, type TipoMensagem } from '@/lib/queries/campanhas'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const brl = (v: number) => `R$ ${v.toFixed(2).replace('.', ',')}`

function formatarDataHora(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  rascunho:  { label: 'Rascunho',  cls: 'bg-page text-text-subtle border border-border' },
  agendada:  { label: 'Agendada',  cls: 'bg-alert text-alert' },
  enviando:  { label: 'Enviando',  cls: 'bg-warn/20 text-warn' },
  concluida: { label: 'Concluída', cls: 'bg-price-bg text-price-text' },
  cancelada: { label: 'Cancelada', cls: 'bg-danger/10 text-danger' },
}

const TIPO_LABEL: Record<TipoMensagem, string> = {
  texto:  'Texto',
  imagem: 'Imagem + texto',
  audio:  'Áudio PTT',
}

const FILTRO_LABEL: Record<FiltroTipo, string> = {
  todos:        'Todos os clientes',
  inativos:     'Inativos',
  frequentes:   'Compradores frequentes',
  recentes:     'Compraram recentemente',
  dias_semana:  'Por dia da semana',
  valor_minimo: 'Ticket médio mínimo',
}

// ─── Formulário default ───────────────────────────────────────────────────────

function filtroDefault(): FiltroCampanha { return { tipo: 'todos' } }

interface FormState {
  nome: string
  tipoMensagem: TipoMensagem
  mensagem: string
  imagemUrl: string | null
  audioUrl: string | null
  filtro: FiltroCampanha
  agendadoEm: string
}

function formDefault(): FormState {
  return { nome: '', tipoMensagem: 'texto', mensagem: '', imagemUrl: null, audioUrl: null, filtro: filtroDefault(), agendadoEm: '' }
}

// ─── WhatsApp Bubble (preview) ────────────────────────────────────────────────

function WhatsappPreview({ tipo, mensagem, imagemUrl, audioUrl }: {
  tipo: TipoMensagem
  mensagem: string
  imagemUrl: string | null
  audioUrl: string | null
}) {
  const vazio = tipo === 'audio' ? !audioUrl : !mensagem.trim() && !imagemUrl
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-menuzia border border-border">
      {/* Header simulado */}
      <div className="flex flex-shrink-0 items-center gap-2.5 bg-[#075E54] px-3 py-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[13px] font-bold text-white">L</div>
        <div>
          <p className="text-[12px] font-semibold text-white leading-tight">Sua loja</p>
          <p className="text-[10px] text-white/70">online</p>
        </div>
      </div>

      {/* Chat area */}
      <div
        className="flex flex-1 flex-col justify-end p-3"
        style={{ background: '#ECE5DD url("data:image/svg+xml,%3Csvg width=\'20\' height=\'20\' viewBox=\'0 0 20 20\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Ccircle cx=\'1\' cy=\'1\' r=\'0.5\' fill=\'%23ccc\' fill-opacity=\'0.4\'/%3E%3C/svg%3E")' }}
      >
        {vazio ? (
          <p className="text-center text-[11px] text-[#667781]">A mensagem aparecerá aqui</p>
        ) : (
          <div className="ml-auto max-w-[85%]">
            <div className="relative rounded-[8px] rounded-tr-[2px] bg-[#D9FDD3] px-3 py-2 shadow-sm">
              {/* Tail */}
              <div className="absolute -right-[6px] top-0 h-0 w-0 border-b-[8px] border-l-[7px] border-b-transparent border-l-[#D9FDD3]" />

              {tipo === 'imagem' && imagemUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagemUrl} alt="preview" className="mb-1.5 max-h-48 w-full rounded object-cover" />
              )}

              {tipo === 'audio' && audioUrl && (
                <div className="flex items-center gap-2 py-1">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#075E54]">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M8 5v14l11-7z"/></svg>
                  </div>
                  <div className="flex flex-1 items-center gap-0.5">
                    {Array.from({ length: 20 }).map((_, i) => (
                      <div key={i} className="w-[2px] rounded-full bg-[#075E54]/40" style={{ height: `${6 + Math.sin(i * 0.8) * 5 + Math.random() * 4}px` }} />
                    ))}
                  </div>
                  <span className="text-[10px] text-[#667781]">0:00</span>
                </div>
              )}

              {(tipo === 'texto' || tipo === 'imagem') && mensagem.trim() && (
                <p className="whitespace-pre-wrap text-[13px] leading-[1.4] text-[#111B21]">{mensagem}</p>
              )}

              <div className="mt-1 flex items-center justify-end gap-1">
                <span className="text-[10px] text-[#667781]">{horaAgora()}</span>
                <svg viewBox="0 0 16 11" className="h-[11px] w-[16px]" fill="#53bdeb"><path d="M11.071.653l-5.268 7.17-2.377-2.376-.707.708 3.084 3.083L11.778 1.36l-.707-.707zm3.15 0l-5.268 7.17-.682-.952-.707.707 1.388 1.976 5.977-8.194-.707-.707z"/></svg>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Modal de preview de campanha enviada ────────────────────────────────────

function CampanhaPreviewModal({ campanha, onClose }: { campanha: Campanha; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-[#111827]/50" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-[61] w-full max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-[14px] font-bold text-text-main">{campanha.nome}</h3>
            <p className="text-[11px] text-text-subtle">{TIPO_LABEL[campanha.tipoMensagem]} · {formatarDataHora(campanha.agendadoEm)}</p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-page text-xl font-light text-text-subtle hover:text-text-main">×</button>
        </div>
        <div className="p-5">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Como foi enviado</p>
          <div style={{ height: 320 }}>
            <WhatsappPreview
              tipo={campanha.tipoMensagem}
              mensagem={campanha.mensagem}
              imagemUrl={campanha.imagemUrl}
              audioUrl={campanha.audioUrl}
            />
          </div>
          {campanha.tipoMensagem === 'audio' && campanha.audioUrl && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Arquivo de áudio</p>
              <audio controls src={campanha.audioUrl} className="w-full" />
            </div>
          )}
        </div>
        <div className="border-t border-border px-5 py-3 text-right">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </>
  )
}

// ─── Badge e Progress ─────────────────────────────────────────────────────────

function Badge({ status }: { status: string }) {
  const s = STATUS_LABEL[status] ?? { label: status, cls: 'bg-page text-text-subtle' }
  return <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>
}

function Progress({ enviados, total }: { enviados: number; total: number }) {
  if (!total) return <span className="text-[12px] text-text-subtle">—</span>
  const pct = Math.round((enviados / total) * 100)
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-border">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] text-text-subtle">{enviados}/{total}</span>
    </div>
  )
}

// ─── Filtro Editor ────────────────────────────────────────────────────────────

function FiltroEditor({ filtro, onChange }: { filtro: FiltroCampanha; onChange: (f: FiltroCampanha) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Público-alvo</label>
        <select
          value={filtro.tipo}
          onChange={(e) => onChange({ tipo: e.target.value as FiltroTipo })}
          className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary"
        >
          {(Object.keys(FILTRO_LABEL) as FiltroTipo[]).map((k) => (
            <option key={k} value={k}>{FILTRO_LABEL[k]}</option>
          ))}
        </select>
      </div>

      {filtro.tipo === 'inativos' && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Sem compra há quantos dias?</label>
          <input type="number" min={1} value={filtro.dias_inativo ?? 7}
            onChange={(e) => onChange({ ...filtro, dias_inativo: Number(e.target.value) })}
            className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary" />
          <p className="mt-1 text-[11px] text-text-subtle">Clientes sem compra há {filtro.dias_inativo ?? 7}+ dias.</p>
        </div>
      )}

      {filtro.tipo === 'frequentes' && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Mínimo de compras por semana</label>
          <input type="number" min={1} value={filtro.compras_por_semana ?? 2}
            onChange={(e) => onChange({ ...filtro, compras_por_semana: Number(e.target.value) })}
            className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary" />
          <p className="mt-1 text-[11px] text-text-subtle">Média de {filtro.compras_por_semana ?? 2}+ pedidos/semana.</p>
        </div>
      )}

      {filtro.tipo === 'recentes' && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Compraram nos últimos X dias</label>
          <input type="number" min={1} value={filtro.ultimos_dias ?? 1}
            onChange={(e) => onChange({ ...filtro, ultimos_dias: Number(e.target.value) })}
            className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary" />
          <p className="mt-1 text-[11px] text-text-subtle">
            {filtro.ultimos_dias === 1 ? 'Compraram ontem ou hoje.' : `Últimos ${filtro.ultimos_dias ?? 1} dias.`}
          </p>
        </div>
      )}

      {filtro.tipo === 'dias_semana' && (
        <div>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Dias em que costumam comprar</label>
          <div className="flex flex-wrap gap-2">
            {DIAS_SEMANA.map((dia, i) => {
              const sel = (filtro.dias_semana ?? []).includes(i)
              return (
                <button key={i} type="button"
                  onClick={() => {
                    const atual = filtro.dias_semana ?? []
                    onChange({ ...filtro, dias_semana: sel ? atual.filter((d) => d !== i) : [...atual, i] })
                  }}
                  className={['rounded px-3 py-1.5 text-[12px] font-semibold border transition-colors', sel ? 'bg-primary text-white border-primary' : 'border-border text-text-subtle hover:border-primary'].join(' ')}
                >{dia}</button>
              )
            })}
          </div>
        </div>
      )}

      {filtro.tipo === 'valor_minimo' && (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Ticket médio mínimo (R$)</label>
          <input type="number" min={0} step={5} value={filtro.valor_minimo ?? 50}
            onChange={(e) => onChange({ ...filtro, valor_minimo: Number(e.target.value) })}
            className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm outline-none focus:border-primary" />
          <p className="mt-1 text-[11px] text-text-subtle">Ticket médio ≥ {brl(filtro.valor_minimo ?? 50)}.</p>
        </div>
      )}
    </div>
  )
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function CampanhasPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [campanhas, setCampanhas] = useState<Campanha[]>([])
  const [loading, setLoading] = useState(true)

  // Drawer
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(formDefault())
  const [saving, setSaving] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [estimativa, setEstimativa] = useState<number | null>(null)
  const [estimandoLoading, setEstimandoLoading] = useState(false)

  // Modal preview de campanha existente
  const [previewCampanha, setPreviewCampanha] = useState<Campanha | null>(null)

  // Uploads
  const [uploadingImagem, setUploadingImagem] = useState(false)
  const [uploadingAudio, setUploadingAudio] = useState(false)
  const imagemRef = useRef<HTMLInputElement>(null)
  const audioRef = useRef<HTMLInputElement>(null)

  // ── Carregar ──────────────────────────────────────────────────────────────

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/campanhas')
      if (res.ok) setCampanhas(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    buscarRestauranteIdDoUsuario(supabase).then((id) => {
      if (!id) return
      setRestauranteId(id)
      carregar()
    })
  }, [supabase, carregar])

  // ── Estimativa ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!restauranteId || !drawerOpen) return
    let cancelled = false
    setEstimandoLoading(true)
    fetch('/api/admin/campanhas/estimativa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filtro: form.filtro }),
    })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) setEstimativa(d?.total ?? null) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setEstimandoLoading(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.filtro, drawerOpen, restauranteId])

  // ── Drawer ────────────────────────────────────────────────────────────────

  function abrirNovo() {
    setEditingId(null); setForm(formDefault()); setErro(null); setEstimativa(null); setDrawerOpen(true)
  }

  function abrirEditar(c: Campanha) {
    setEditingId(c.id)
    setForm({
      nome: c.nome, tipoMensagem: c.tipoMensagem, mensagem: c.mensagem,
      imagemUrl: c.imagemUrl, audioUrl: c.audioUrl, filtro: c.filtro,
      agendadoEm: c.agendadoEm ? new Date(c.agendadoEm).toISOString().slice(0, 16) : '',
    })
    setErro(null); setEstimativa(null); setDrawerOpen(true)
  }

  function fecharDrawer() { setDrawerOpen(false); setEditingId(null) }

  // ── Upload ────────────────────────────────────────────────────────────────

  async function handleImagemPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file || !restauranteId) return
    setUploadingImagem(true)
    try { const url = await uploadMidiaCampanha(supabase, restauranteId, file, 'imagem'); setForm((f) => ({ ...f, imagemUrl: url })) }
    catch { setErro('Erro ao enviar imagem.') }
    finally { setUploadingImagem(false) }
  }

  async function handleAudioPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file || !restauranteId) return
    setUploadingAudio(true)
    try { const url = await uploadMidiaCampanha(supabase, restauranteId, file, 'audio'); setForm((f) => ({ ...f, audioUrl: url })) }
    catch { setErro('Erro ao enviar áudio.') }
    finally { setUploadingAudio(false) }
  }

  // ── Salvar ────────────────────────────────────────────────────────────────

  async function salvar(dispararAgora = false) {
    if (!form.nome.trim()) { setErro('Informe o nome da campanha.'); return }
    if (form.tipoMensagem !== 'audio' && !form.mensagem.trim()) { setErro('Informe a mensagem.'); return }
    if (form.tipoMensagem === 'imagem' && !form.imagemUrl) { setErro('Faça upload da imagem.'); return }
    if (form.tipoMensagem === 'audio' && !form.audioUrl) { setErro('Faça upload do áudio.'); return }
    if (!dispararAgora && !form.agendadoEm) { setErro('Defina o horário ou clique em "Disparar agora".'); return }

    setSaving(true); setErro(null)
    try {
      const body = {
        nome: form.nome.trim(), tipoMensagem: form.tipoMensagem, mensagem: form.mensagem.trim(),
        imagemUrl: form.imagemUrl, audioUrl: form.audioUrl, filtro: form.filtro,
        agendadoEm: dispararAgora ? new Date().toISOString() : (form.agendadoEm ? new Date(form.agendadoEm).toISOString() : null),
        disparar: true,
      }
      if (editingId) {
        await fetch(`/api/admin/campanhas/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } else {
        await fetch('/api/admin/campanhas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      }
      fecharDrawer(); carregar()
    } catch { setErro('Erro ao salvar campanha.') }
    finally { setSaving(false) }
  }

  // ── Ações lista ───────────────────────────────────────────────────────────

  async function cancelarCampanha(id: string) {
    if (!confirm('Cancelar esta campanha?')) return
    await fetch(`/api/admin/campanhas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelada' }) })
    carregar()
  }

  async function excluirCampanha(id: string) {
    if (!confirm('Excluir esta campanha permanentemente?')) return
    await fetch(`/api/admin/campanhas/${id}`, { method: 'DELETE' })
    carregar()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar title="Campanhas" breadcrumb="Disparo de mensagens WhatsApp" />

      <div className="flex flex-1 flex-col overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-[13px] text-text-subtle">Dispare mensagens, imagens ou áudios para clientes segmentados.</p>
          <Button onClick={abrirNovo}>+ Nova campanha</Button>
        </div>

        {loading ? (
          <p className="text-[13px] text-text-subtle">Carregando…</p>
        ) : campanhas.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 py-12 text-center">
            <svg viewBox="0 0 24 24" className="h-10 w-10 fill-text-subtle/30">
              <path d="M18 11v2h4v-2h-4zm-2 6.61c.96.71 2.21 1.65 3.2 2.39.4-.53.8-1.07 1.2-1.61-.99-.74-2.24-1.68-3.2-2.4-.4.54-.8 1.08-1.2 1.62zM20.4 5.6c-.4-.53-.8-1.07-1.2-1.6-.99.74-2.24 1.68-3.2 2.4.4.54.8 1.07 1.2 1.61.96-.72 2.21-1.65 3.2-2.41zM4 9c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2h1v4h2v-4h1l5 3V6L8 9H4zm11.5 3c0-1.33-.58-2.53-1.5-3.35v6.69c.92-.81 1.5-2.01 1.5-3.34z" />
            </svg>
            <p className="text-[13px] font-medium text-text-subtle">Nenhuma campanha criada ainda.</p>
            <Button onClick={abrirNovo}>Criar primeira campanha</Button>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-page">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Status</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Tipo</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Agendado</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Progresso</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campanhas.map((c) => (
                  <tr key={c.id} className="hover:bg-page/60">
                    <td className="px-4 py-3 font-medium text-text-main">{c.nome}</td>
                    <td className="px-4 py-3"><Badge status={c.status} /></td>
                    <td className="px-4 py-3 text-text-subtle">{TIPO_LABEL[c.tipoMensagem]}</td>
                    <td className="px-4 py-3 text-text-subtle">{formatarDataHora(c.agendadoEm)}</td>
                    <td className="px-4 py-3">
                      <Progress enviados={c.totalEnviados + c.totalErros} total={c.totalDestinatarios} />
                      {c.totalErros > 0 && <span className="mt-0.5 block text-[11px] text-danger">{c.totalErros} erro(s)</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Olhinho — ver mensagem enviada */}
                        <button
                          onClick={() => setPreviewCampanha(c)}
                          title="Ver mensagem"
                          className="flex h-7 w-7 items-center justify-center rounded text-text-subtle hover:bg-page hover:text-primary transition-colors"
                        >
                          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zm0 12.5c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                          </svg>
                        </button>
                        {(c.status === 'rascunho' || c.status === 'agendada') && (
                          <button onClick={() => abrirEditar(c)} className="rounded px-2 py-1 text-[11px] font-semibold text-primary hover:bg-alert/20">Editar</button>
                        )}
                        {c.status === 'agendada' && (
                          <button onClick={() => cancelarCampanha(c.id)} className="rounded px-2 py-1 text-[11px] font-semibold text-danger hover:bg-danger/10">Cancelar</button>
                        )}
                        {(c.status === 'rascunho' || c.status === 'concluida' || c.status === 'cancelada') && (
                          <button onClick={() => excluirCampanha(c.id)} className="rounded px-2 py-1 text-[11px] font-semibold text-text-subtle hover:text-danger hover:bg-danger/10">Excluir</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {/* ── Modal preview campanha existente ─────────────────────────────── */}
      {previewCampanha && <CampanhaPreviewModal campanha={previewCampanha} onClose={() => setPreviewCampanha(null)} />}

      {/* ── Drawer ─────────────────────────────────────────────────────── */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-[#111827]/40" onClick={fecharDrawer} />}
      <div className={['fixed right-0 top-0 z-50 flex h-full w-full max-w-[900px] flex-col bg-white shadow-2xl transition-transform duration-300', drawerOpen ? 'translate-x-0' : 'translate-x-full'].join(' ')}>
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-bold text-text-main">{editingId ? 'Editar campanha' : 'Nova campanha'}</h2>
          <button onClick={fecharDrawer} className="flex h-8 w-8 items-center justify-center rounded-full bg-page text-xl font-light text-text-subtle hover:text-text-main">×</button>
        </div>

        {/* Body: form (esquerda) + preview WhatsApp (direita) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Formulário */}
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {/* Nome */}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Nome da campanha</label>
              <input
                value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Promoção de quinta-feira"
                className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary placeholder:text-text-subtle/60"
              />
            </div>

            {/* Tipo */}
            <div>
              <label className="mb-2 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Tipo de mensagem</label>
              <div className="flex gap-2">
                {(['texto', 'imagem', 'audio'] as TipoMensagem[]).map((t) => (
                  <button key={t} type="button"
                    onClick={() => setForm((f) => ({ ...f, tipoMensagem: t }))}
                    className={['flex-1 rounded-menuzia border py-2 text-[12px] font-semibold transition-colors', form.tipoMensagem === t ? 'border-primary bg-alert/20 text-primary' : 'border-border text-text-subtle hover:border-primary'].join(' ')}
                  >{TIPO_LABEL[t]}</button>
                ))}
              </div>
            </div>

            {/* Upload imagem */}
            {form.tipoMensagem === 'imagem' && (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Imagem</label>
                <input ref={imagemRef} type="file" accept="image/*" className="hidden" onChange={handleImagemPick} />
                {form.imagemUrl ? (
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.imagemUrl} alt="preview" className="h-20 w-20 rounded-menuzia border border-border object-cover" />
                    <div className="space-y-1.5">
                      <p className="text-[12px] font-medium text-price-text">Imagem enviada ✓</p>
                      <button type="button" onClick={() => imagemRef.current?.click()} className="rounded px-3 py-1.5 text-[11px] font-semibold border border-border text-text-subtle hover:border-primary">Trocar</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => imagemRef.current?.click()} disabled={uploadingImagem}
                    className="flex w-full items-center justify-center gap-2 rounded-menuzia border-2 border-dashed border-border py-6 text-[13px] font-medium text-text-subtle hover:border-primary hover:text-primary transition-colors">
                    {uploadingImagem ? 'Enviando…' : '+ Selecionar imagem (JPG, PNG)'}
                  </button>
                )}
              </div>
            )}

            {/* Upload áudio */}
            {form.tipoMensagem === 'audio' && (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Áudio (mensagem de voz)</label>
                <input ref={audioRef} type="file" accept="audio/*,.ogg,.mp3,.m4a,.opus" className="hidden" onChange={handleAudioPick} />
                {form.audioUrl ? (
                  <div className="space-y-2">
                    <audio controls src={form.audioUrl} className="w-full" />
                    <button type="button" onClick={() => audioRef.current?.click()} className="rounded px-3 py-1.5 text-[11px] font-semibold border border-border text-text-subtle hover:border-primary">Trocar áudio</button>
                  </div>
                ) : (
                  <button type="button" onClick={() => audioRef.current?.click()} disabled={uploadingAudio}
                    className="flex w-full items-center justify-center gap-2 rounded-menuzia border-2 border-dashed border-border py-6 text-[13px] font-medium text-text-subtle hover:border-primary hover:text-primary transition-colors">
                    {uploadingAudio ? 'Enviando…' : '+ Selecionar áudio (MP3, OGG, M4A)'}
                  </button>
                )}
                <p className="mt-1.5 text-[11px] text-text-subtle">Dica: grave no WhatsApp, salve e faça upload aqui.</p>
              </div>
            )}

            {/* Mensagem */}
            {form.tipoMensagem !== 'audio' && (
              <div>
                <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">
                  {form.tipoMensagem === 'imagem' ? 'Legenda da imagem' : 'Mensagem'}
                </label>
                <textarea rows={4} value={form.mensagem}
                  onChange={(e) => setForm((f) => ({ ...f, mensagem: e.target.value }))}
                  placeholder={form.tipoMensagem === 'imagem' ? 'Ex: 🍔 Combo especial essa semana! Peça já.' : 'Ex: Sentimos sua falta 😊 Que tal pedir algo hoje?'}
                  className="w-full resize-none rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary placeholder:text-text-subtle/60"
                />
                <p className="mt-1 text-right text-[11px] text-text-subtle">{form.mensagem.length} chars</p>
              </div>
            )}

            {/* Filtro */}
            <FiltroEditor filtro={form.filtro} onChange={(f) => setForm((prev) => ({ ...prev, filtro: f }))} />

            {/* Estimativa */}
            <div className="rounded-menuzia border border-border bg-page px-4 py-3">
              <p className="text-[12px] text-text-subtle">
                Estimativa:{' '}
                {estimandoLoading ? 'calculando…' : estimativa === null ? '—' : (
                  <strong className="text-text-main">{estimativa} cliente{estimativa !== 1 ? 's' : ''}</strong>
                )}
              </p>
            </div>

            {/* Agendamento */}
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Agendar para (data e hora)</label>
              <input type="datetime-local" value={form.agendadoEm}
                onChange={(e) => setForm((f) => ({ ...f, agendadoEm: e.target.value }))}
                className="w-full rounded-menuzia border border-border bg-white px-3 py-2.5 text-sm text-text-main outline-none focus:border-primary"
              />
              <p className="mt-1 text-[11px] text-text-subtle">Deixe em branco para disparar imediatamente.</p>
            </div>

            {erro && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>}
          </div>

          {/* Preview WhatsApp — coluna direita */}
          <div className="hidden w-[300px] flex-shrink-0 border-l border-border bg-page p-4 lg:flex lg:flex-col">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pré-visualização</p>
            <div className="flex-1">
              <WhatsappPreview
                tipo={form.tipoMensagem}
                mensagem={form.mensagem}
                imagemUrl={form.imagemUrl}
                audioUrl={form.audioUrl}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-border bg-white px-5 py-4">
          <Button variant="outline" onClick={fecharDrawer}>Cancelar</Button>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => salvar(true)}>
              {saving ? 'Salvando…' : 'Disparar agora'}
            </Button>
            <Button disabled={saving} onClick={() => salvar(false)}>
              {saving ? 'Salvando…' : 'Agendar'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
