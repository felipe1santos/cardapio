'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { uploadMidiaCampanha, type Campanha, type FiltroCampanha, type FiltroTipo, type TipoMensagem } from '@/lib/queries/campanhas'
import { formatarReal } from '@/lib/moeda'
import { montarTextoCampanha, MARCADOR_LINK, paraCampoDataHora, problemasDasVariaveis, BOTOES_MAX, BOTAO_TEXTO_MAX, type BotaoCampanha } from '@/lib/mensageria/campanhas'
import { CampanhasMetricas } from '@/components/admin/campanhas-metricas'
import { SubmenuVertical, type ItemSubmenu } from '@/components/admin/submenu-vertical'
import { PilhaToasts, useToasts } from '@/components/admin/toasts'
import { VisaoGeral } from '@/components/admin/campanhas/visao-geral'
import { Agendamentos, ListaCampanhas, type AcoesCampanha } from '@/components/admin/campanhas/listas'
import { useModelos, type ModeloMensagem } from '@/components/admin/campanhas/modelos'
import { BoasPraticas } from '@/components/admin/campanhas/boas-praticas'
import { Ajuda, Confirmar } from '@/components/admin/campanhas/comum'
import { Lightbulb, Send } from 'lucide-react'

// Campanhas = só DISPARO (2026-10-06). Mensagens automáticas, notificações do app e modelos foram para
// Ajustes; os endereços antigos (?aba=automaticas|notificacoes|modelos) redirecionam para lá.
type Aba = 'visao' | 'campanhas' | 'agendamentos'
const MOVIDAS: Record<string, string> = { automaticas: 'mensagens', notificacoes: 'notificacoes', modelos: 'modelos' }
const ABAS: ItemSubmenu<Aba>[] = [
  { id: 'visao', label: 'Visão geral', icone: 'dashboard' },
  { id: 'campanhas', label: 'Campanhas', icone: 'campaign' },
  { id: 'agendamentos', label: 'Agendamentos', icone: 'schedule' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Milhar com ponto ("R$ 4.088,00"): função única do painel, ver lib/moeda.ts.
const brl = formatarReal

function formatarDataHora(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function horaAgora() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

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
  incluirLink: boolean
  incluirDescadastro: boolean
  /** Botões de link (Fase 4): saem como links no texto. */
  botoes: BotaoCampanha[]
}

function formDefault(): FormState {
  return { nome: '', tipoMensagem: 'texto', mensagem: '', imagemUrl: null, audioUrl: null, filtro: filtroDefault(), agendadoEm: '', incluirLink: true, incluirDescadastro: true, botoes: [] }
}

/** Prévia com um link de exemplo no lugar do link de cada cliente. */
function mensagemComLink(mensagem: string, incluirLink: boolean, incluirDescadastro = false, botoes: BotaoCampanha[] = []) {
  // {nome} com um nome de exemplo: a prévia mostra como chega para cada cliente.
  const validos = botoes.filter((b) => b.texto.trim() && b.url.trim())
  return montarTextoCampanha(mensagem, { incluirLink, token: '0'.repeat(24), nome: 'Maria', incluirDescadastro, botoes: validos }).replace(/\/c\/0{24}/, '/c/…')
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
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[13px] font-semibold text-white">L</div>
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
                <span className="text-[10px] text-[#667781]" suppressHydrationWarning>{horaAgora()}</span>
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
            <h3 className="text-[14px] font-semibold text-text-main">{campanha.nome}</h3>
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
  const router = useRouter()
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  // Link da vitrine para o atalho "Ver cardápio" dos botões.
  const [slugLoja, setSlugLoja] = useState<string | null>(null)
  useEffect(() => {
    if (!restauranteId) return
    supabase.from('restaurantes').select('slug').eq('id', restauranteId).maybeSingle().then(({ data }) => setSlugLoja((data?.slug as string | undefined) ?? null), () => setSlugLoja(null))
  }, [supabase, restauranteId])
  const urlCardapioLoja = slugLoja ? `https://app.menuzia.com.br/loja/${slugLoja}` : ''
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
  const [aba, setAba] = useState<Aba>('visao')
  // Atalho: /admin/campanhas?aba=notificacoes (Fidelidade) abre direto a seção; "metricas" virou a Visão geral.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('aba')
    if (q && MOVIDAS[q]) { router.replace(`/admin/ajustes?aba=${MOVIDAS[q]}`); return }
    if (q && ABAS.some((a) => a.id === q)) setAba(q as Aba)
  }, [])
  const toasts = useToasts()
  const [boasPraticas, setBoasPraticas] = useState(false)
  const [confirmacao, setConfirmacao] = useState<{ tipo: 'cancelar' | 'excluir'; c: Campanha } | null>(null)
  const modelos = useModelos(restauranteId)

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
      agendadoEm: paraCampoDataHora(c.agendadoEm),
      incluirLink: c.incluirLink,
      incluirDescadastro: c.incluirDescadastro,
      botoes: c.botoes ?? [],
    })
    setErro(null); setEstimativa(null); setDrawerOpen(true)
  }

  function fecharDrawer() { setDrawerOpen(false); setEditingId(null) }

  /** Duplicar: mesma mensagem e público, sem horário — a pessoa escolhe quando enviar. */
  function duplicar(c: Campanha) {
    setEditingId(null)
    setForm({
      nome: `${c.nome} (cópia)`.slice(0, 120), tipoMensagem: c.tipoMensagem, mensagem: c.mensagem,
      imagemUrl: c.imagemUrl, audioUrl: c.audioUrl, filtro: c.filtro, agendadoEm: '',
      incluirLink: c.incluirLink, incluirDescadastro: c.incluirDescadastro, botoes: c.botoes ?? [],
    })
    setErro(null); setEstimativa(null); setDrawerOpen(true)
  }

  // Ajustes › Modelos de mensagem › "Usar": chega aqui com ?modelo=<id> e abre o disparo com ele.
  const modeloDaUrl = useRef(false)
  useEffect(() => {
    if (modeloDaUrl.current || !modelos.modelos.length) return
    const id = new URLSearchParams(window.location.search).get('modelo')
    if (!id) return
    modeloDaUrl.current = true
    const m = modelos.modelos.find((x) => x.id === id)
    if (m) usarModelo(m)
    const u = new URL(window.location.href); u.searchParams.delete('modelo')
    window.history.replaceState(window.history.state, '', u.toString())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelos.modelos])

  function usarModelo(m: ModeloMensagem) {
    setEditingId(null)
    setForm({ ...formDefault(), nome: m.nome, mensagem: m.mensagem, imagemUrl: m.imagem_url, tipoMensagem: m.imagem_url ? 'imagem' : 'texto' })
    setErro(null); setEstimativa(null); setDrawerOpen(true)
  }

  async function salvarComoModelo() {
    if (form.tipoMensagem === 'audio') { setErro('Modelo é só para texto ou imagem.'); return }
    if (!form.mensagem.trim()) { setErro('Escreva a mensagem antes de salvar como modelo.'); return }
    const e = await modelos.salvar({ nome: form.nome.trim() || 'Modelo sem nome', mensagem: form.mensagem, imagem_url: form.tipoMensagem === 'imagem' ? form.imagemUrl : null })
    toasts.mostrar(e ? 'erro' : 'ok', e ?? 'Modelo salvo. Ele aparece em Ajustes › Modelos de mensagem.')
  }

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
    const variaveis = form.tipoMensagem === 'audio' ? null : problemasDasVariaveis(form.mensagem, { incluirLink: form.incluirLink })
    if (variaveis) { setErro(variaveis); return }

    setSaving(true); setErro(null)
    try {
      const body = {
        nome: form.nome.trim(), tipoMensagem: form.tipoMensagem, mensagem: form.mensagem.trim(),
        imagemUrl: form.imagemUrl, audioUrl: form.audioUrl, filtro: form.filtro,
        agendadoEm: dispararAgora ? new Date().toISOString() : (form.agendadoEm ? new Date(form.agendadoEm).toISOString() : null),
        incluirLink: form.tipoMensagem !== 'audio' && form.incluirLink,
        incluirDescadastro: form.tipoMensagem !== 'audio' && form.incluirDescadastro,
        botoes: form.tipoMensagem === 'audio' ? [] : form.botoes.filter((b) => b.texto.trim() || b.url.trim()),
        disparar: true,
      }
      const res = editingId
        ? await fetch(`/api/admin/campanhas/${editingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/admin/campanhas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setErro(j?.error ?? 'Erro ao salvar campanha.')
        carregar()
        return
      }
      fecharDrawer(); carregar()
    } catch { setErro('Erro ao salvar campanha.') }
    finally { setSaving(false) }
  }

  // ── Ações lista ───────────────────────────────────────────────────────────

  async function cancelarCampanha(id: string) {
    const res = await fetch(`/api/admin/campanhas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelada' }) })
    if (!res.ok) toasts.mostrar('erro', (await res.json().catch(() => null))?.error ?? 'Não foi possível cancelar.')
    else toasts.mostrar('ok', 'Campanha cancelada. Quem ainda não recebeu não recebe mais.')
    carregar()
  }

  async function excluirCampanha(id: string) {
    const res = await fetch(`/api/admin/campanhas/${id}`, { method: 'DELETE' })
    if (!res.ok) toasts.mostrar('erro', (await res.json().catch(() => null))?.error ?? 'Não foi possível excluir.')
    else toasts.mostrar('ok', 'Campanha excluída.')
    carregar()
  }

  const acoes: AcoesCampanha = {
    onVer: (c) => setPreviewCampanha(c),
    onEditar: abrirEditar,
    onDuplicar: duplicar,
    onCancelar: (c) => setConfirmacao({ tipo: 'cancelar', c }),
    onExcluir: (c) => setConfirmacao({ tipo: 'excluir', c }),
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar
        title="Campanhas via WhatsApp"
        breadcrumb="Disparos e agendamentos"
        right={<span className="hidden sm:inline-flex"><Ajuda texto="Campanhas para os clientes da loja pelo WhatsApp, na hora ou agendadas. Mensagens automáticas, modelos e notificações do app ficam em Ajustes." /></span>}
      />

      {/* Barra de ações: boas práticas e o disparo. (O "Envio automático" saiu: os avisos de status
          do pedido saem sempre que o WhatsApp da loja está conectado — noite 5.) */}
      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 border-b border-[var(--adm-borda)] bg-white px-4 py-2.5 sm:px-5">
        <div className="flex gap-2">
          <button type="button" onClick={() => setBoasPraticas(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] border border-[#d6dae1] bg-white px-3 text-[12.5px] font-semibold text-[#374151] hover:border-[#0688d4] hover:text-[#0688d4]" data-testid="abrir-boas-praticas">
            <Lightbulb className="h-4 w-4" /> Boas práticas
          </button>
          <button type="button" onClick={abrirNovo} className="inline-flex h-9 items-center gap-1.5 rounded-[5px] bg-[#0688d4] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[#0570ae]" data-testid="disparar-mensagem">
            <Send className="h-4 w-4" /> Disparar mensagem
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <SubmenuVertical itens={ABAS} ativo={aba} onSelecionar={setAba} titulo="Seções de campanhas" />
        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5" data-testid={`secao-${aba}`}>
          {aba === 'visao' && (
            <VisaoGeral onDisparar={abrirNovo} detalhado={<CampanhasMetricas opcoesCampanhas={campanhas.map((c) => ({ id: c.id, nome: c.nome }))} />} />
          )}
          {aba === 'campanhas' && <ListaCampanhas campanhas={campanhas} carregando={loading} acoes={acoes} onNovo={abrirNovo} />}
          {aba === 'agendamentos' && <Agendamentos campanhas={campanhas} carregando={loading} acoes={acoes} onNovo={abrirNovo} />}
        </div>
      </div>

      {boasPraticas && <BoasPraticas onFechar={() => setBoasPraticas(false)} />}
      {confirmacao && (
        <Confirmar
          titulo={confirmacao.tipo === 'cancelar' ? 'Cancelar campanha' : 'Excluir campanha'}
          texto={confirmacao.tipo === 'cancelar' ? `"${confirmacao.c.nome}" para de enviar. Quem ainda não recebeu não recebe mais.` : `"${confirmacao.c.nome}" será apagada de vez, com o histórico de envios.`}
          botao={confirmacao.tipo === 'cancelar' ? 'Cancelar envio' : 'Excluir'}
          perigo
          onCancelar={() => setConfirmacao(null)}
          onConfirmar={() => { const c = confirmacao; setConfirmacao(null); void (c.tipo === 'cancelar' ? cancelarCampanha(c.c.id) : excluirCampanha(c.c.id)) }}
        />
      )}
      <PilhaToasts itens={toasts.itens} />

      {/* ── Modal preview campanha existente ─────────────────────────────── */}
      {previewCampanha && <CampanhaPreviewModal campanha={previewCampanha} onClose={() => setPreviewCampanha(null)} />}

      {/* ── Drawer ─────────────────────────────────────────────────────── */}
      {drawerOpen && <div className="fixed inset-0 z-40 bg-[#111827]/40" onClick={fecharDrawer} />}
      <div className={['fixed right-0 top-0 z-50 flex h-full w-full max-w-[900px] flex-col bg-white shadow-2xl transition-transform duration-300', drawerOpen ? 'translate-x-0' : 'translate-x-full'].join(' ')} data-testid="drawer-campanha" aria-hidden={!drawerOpen}>
        {/* Header */}
        <div className="flex flex-shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-[15px] font-semibold text-text-main">{editingId ? 'Editar campanha' : 'Nova campanha'}</h2>
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

            {/* Link rastreável */}
            {form.tipoMensagem !== 'audio' && (
              <label className="flex cursor-pointer items-start gap-3 rounded-menuzia border border-border px-3 py-3">
                <input type="checkbox" checked={form.incluirLink} onChange={(e) => setForm((f) => ({ ...f, incluirLink: e.target.checked }))}
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-primary" data-testid="incluir-link" />
                <span>
                  <span className="block text-[13px] font-semibold text-text-main">Incluir link do cardápio (com medição de cliques)</span>
                  <span className="block text-[12px] text-text-subtle">
                    Cada cliente recebe um link próprio, sem dados dele. Escreva <code className="rounded-menuzia bg-page px-1">{MARCADOR_LINK}</code> onde quer o link; sem isso ele vai no fim da mensagem.
                  </span>
                </span>
              </label>
            )}

            {/* Descadastro (0112) */}
            {form.tipoMensagem !== 'audio' && (
              <label className="flex cursor-pointer items-start gap-3 rounded-menuzia border border-border px-3 py-3">
                <input type="checkbox" checked={form.incluirDescadastro} onChange={(e) => setForm((f) => ({ ...f, incluirDescadastro: e.target.checked }))}
                  className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-primary" data-testid="incluir-descadastro" />
                <span>
                  <span className="block text-[13px] font-semibold text-text-main">Terminar com &quot;Para não receber mais, responda SAIR.&quot;</span>
                  <span className="block text-[12px] text-text-subtle">
                    Quem responder SAIR não recebe mais campanhas desta loja (os avisos de pedido continuam). Vale mesmo sem esta linha.
                  </span>
                </span>
              </label>
            )}

            {/* Botões (Fase 4) */}
            {form.tipoMensagem !== 'audio' && (
              <div className="rounded-menuzia border border-border px-3 py-3" data-testid="campanha-botoes">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-text-main">Botões (opcional)</span>
                  {form.botoes.length < BOTOES_MAX && (
                    <span className="flex gap-2">
                      {slugLoja && !form.botoes.some((b) => b.url === urlCardapioLoja) && (
                        <button type="button" data-testid="botao-ver-cardapio" onClick={() => setForm((f) => ({ ...f, botoes: [...f.botoes, { texto: 'Ver cardápio', url: urlCardapioLoja }] }))}
                          className="rounded-menuzia border border-primary/40 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/5">+ Ver cardápio</button>
                      )}
                      <button type="button" data-testid="botao-adicionar" onClick={() => setForm((f) => ({ ...f, botoes: [...f.botoes, { texto: '', url: 'https://' }] }))}
                        className="rounded-menuzia border border-border px-2 py-1 text-[11px] font-semibold text-text-subtle hover:bg-page">+ Botão</button>
                    </span>
                  )}
                </div>
                {form.botoes.map((b, i) => (
                  <div key={i} className="mt-2 flex gap-2">
                    <input value={b.texto} maxLength={BOTAO_TEXTO_MAX} placeholder="Texto (ex.: Pegar cupom)"
                      onChange={(e) => setForm((f) => ({ ...f, botoes: f.botoes.map((x, j) => (j === i ? { ...x, texto: e.target.value } : x)) }))}
                      className="w-[38%] rounded-menuzia border border-border px-2 py-1.5 text-[13px]" data-testid={`botao-texto-${i}`} />
                    <input value={b.url} placeholder="https://"
                      onChange={(e) => setForm((f) => ({ ...f, botoes: f.botoes.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) }))}
                      className="min-w-0 flex-1 rounded-menuzia border border-border px-2 py-1.5 text-[13px]" data-testid={`botao-url-${i}`} />
                    <button type="button" aria-label="Remover botão" onClick={() => setForm((f) => ({ ...f, botoes: f.botoes.filter((_, j) => j !== i) }))}
                      className="rounded-menuzia border border-border px-2 text-text-subtle hover:text-danger">×</button>
                  </div>
                ))}
                <p className="mt-2 text-[11px] text-text-subtle">
                  Até {BOTOES_MAX} botões com link https. Pela conexão do WhatsApp por QR Code, botões não aparecem em todos os celulares — por isso eles saem como links no texto, um por linha (o primeiro mostra a prévia com a imagem da loja).
                </p>
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
              <p className="mt-1 text-[11px] text-text-subtle">Sem horário? Use o botão &quot;Disparar agora&quot;.</p>
            </div>

            {erro && <p className="rounded-menuzia border border-danger bg-danger/10 px-3 py-2 text-[13px] text-danger">{erro}</p>}
          </div>

          {/* Preview WhatsApp — coluna direita */}
          <div className="hidden w-[300px] flex-shrink-0 border-l border-border bg-page p-4 lg:flex lg:flex-col">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Pré-visualização</p>
            <div className="flex-1">
              <WhatsappPreview
                tipo={form.tipoMensagem}
                mensagem={form.tipoMensagem === 'audio' ? form.mensagem : mensagemComLink(form.mensagem, form.incluirLink, form.incluirDescadastro, form.botoes)}
                imagemUrl={form.imagemUrl}
                audioUrl={form.audioUrl}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-border bg-white px-5 py-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={fecharDrawer}>Cancelar</Button>
            {form.tipoMensagem !== 'audio' && <Button variant="ghost" onClick={() => void salvarComoModelo()} data-testid="salvar-como-modelo">Salvar como modelo</Button>}
          </div>
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
