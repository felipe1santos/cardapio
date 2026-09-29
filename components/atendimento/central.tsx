'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Bell, BellOff, Bot, Check, CheckCheck, Clock, Hand, ImagePlus, Loader2, Maximize2, Minimize2, Minus, Pause, Play, Plus, Search, Send, Smile,
  Tag as TagIcon, User, UserRound, X,
} from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { iniciais } from '@/lib/mensageria/iniciais'
import type { ConversaCentral, EstadoAtendimento, MensagemCentral } from '@/lib/mensageria/atendimento'
import { rotuloSaidaNaoConfirmada } from '@/lib/mensageria/atendente-envio'

/**
 * Central de atendimento do WhatsApp (0107) — carregada SOB DEMANDA pelo lancador.tsx.
 * Estilo WhatsApp Web, interface própria (nunca iframe do web.whatsapp.com).
 *
 * Tempo real só com o painel aberto: a lista (whatsapp_conversas da loja) e a conversa
 * aberta (whatsapp_mensagens daquela conversa). Lista e mensagens paginadas por cursor;
 * a lista desenha só as linhas visíveis; fotos do cliente só quando aparecem.
 */
export interface PropsCentral {
  restauranteId: string
  som: boolean
  onSom: (v: boolean) => void
  onFechar: () => void
  onMinimizar: () => void
  oculto: boolean
  onMudou: () => void
  /** Abre em "Aguardando" quando há alguém esperando; senão, em "Todas". */
  filtroInicial?: Filtro
}

export type Filtro = 'aguardando' | 'humano' | 'todas'
interface Tag { id: string; nome: string; cor: string }
interface Detalhe {
  conversa: ConversaCentral
  pedidos: { id: string; numero: number; status: string; total: number; criadoEm: string; tipo: string }[]
  fidelidade: { nome: string; faltaTexto: string; percentual: number }[]
  roboAtivo: boolean
}

const ROTULO_ESTADO: Record<EstadoAtendimento, { texto: string; cor: string }> = {
  robo: { texto: 'Robô', cor: 'bg-[#F3F4F6] text-[#4B5563]' },
  aguardando: { texto: 'Aguardando atendente', cor: 'bg-[#FEF3C7] text-[#92400E]' },
  humano: { texto: 'Em atendimento', cor: 'bg-[#DBEAFE] text-[#1D4ED8]' },
  encerrada: { texto: 'Encerrada', cor: 'bg-[#F3F4F6] text-[#6B7280]' },
}
const ROTULO_ORIGEM: Record<string, string> = { robo: 'Robô', automatico: 'Automático', disparo: 'Disparo', loja: 'Pelo celular da loja' }
const STATUS_PEDIDO: Record<string, string> = {
  recebido: 'Recebido', preparando: 'Preparando', pronto: 'Pronto', em_rota: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado',
}
const CORES_TAG = ['#0688D4', '#10B981', '#F59E0B', '#EF4444', '#A855F7', '#EC4899', '#14B8A6', '#6B7280']
const EMOJIS = ['😀', '😊', '😉', '😍', '🙏', '👍', '👏', '🙌', '👋', '🤝', '😅', '😂', '🥰', '😎', '🤔', '😢', '❤️', '🔥', '✅', '⏰', '🛵', '🍔', '🍕', '🥤', '🍟', '🎉', '📍', '💳', '💵', '📦', '⭐', '✨']
const ALTURA_LINHA = 72

function horaCurta(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const hoje = new Date()
  const mesmoDia = d.toDateString() === hoje.toDateString()
  return mesmoDia
    ? d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })
}
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

async function chamar<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; dados: T | null; erro: string | null }> {
  try {
    const r = await fetch(url, { cache: 'no-store', ...init, headers: init?.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
    const j = await r.json().catch(() => null)
    return { ok: r.ok, dados: r.ok ? (j as T) : null, erro: r.ok ? null : (j as { error?: string } | null)?.error ?? 'Não foi possível.' }
  } catch {
    return { ok: false, dados: null, erro: 'Sem conexão. Tente de novo.' }
  }
}

export function CentralAtendimento({ restauranteId, som, onSom, onFechar, onMinimizar, oculto, onMudou, filtroInicial = 'aguardando' }: PropsCentral) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [maximizado, setMaximizado] = useState(false)
  const [filtro, setFiltro] = useState<Filtro>(filtroInicial)
  const [tagFiltro, setTagFiltro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [buscaAtiva, setBuscaAtiva] = useState('')
  const [conversas, setConversas] = useState<ConversaCentral[]>([])
  const [proximo, setProximo] = useState<string | null>(null)
  const [carregandoLista, setCarregandoLista] = useState(true)
  const [tags, setTags] = useState<Tag[]>([])
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const seqLista = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setBuscaAtiva(busca.trim()), 300)
    return () => clearTimeout(t)
  }, [busca])

  const carregarTags = useCallback(async () => {
    const r = await chamar<{ tags: Tag[] }>('/api/admin/whatsapp/atendimento/tags')
    if (r.dados) setTags(r.dados.tags)
  }, [])
  useEffect(() => { void carregarTags() }, [carregarTags])

  const carregarLista = useCallback(async (cursor: string | null = null) => {
    const minha = ++seqLista.current
    if (!cursor) setCarregandoLista(true)
    const p = new URLSearchParams({ filtro })
    if (tagFiltro) p.set('tag', tagFiltro)
    if (buscaAtiva) p.set('q', buscaAtiva)
    if (cursor) p.set('cursor', cursor)
    const r = await chamar<{ conversas: ConversaCentral[]; proximo: string | null }>(`/api/admin/whatsapp/atendimento/conversas?${p}`)
    if (minha !== seqLista.current) return
    setCarregandoLista(false)
    if (!r.dados) return setAviso(r.erro)
    setConversas((atual) => (cursor ? [...atual, ...r.dados!.conversas.filter((c) => !atual.some((a) => a.id === c.id))] : r.dados!.conversas))
    setProximo(r.dados.proximo)
  }, [filtro, tagFiltro, buscaAtiva])
  useEffect(() => { void carregarLista() }, [carregarLista])

  // Tempo real da LISTA (só com o painel aberto): qualquer mudança nas conversas da loja
  // recarrega a primeira página, com folga para juntar rajadas.
  const recarregar = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const canal = supabase
      .channel(`atendimento-lista-${restauranteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_conversas', filter: `restaurante_id=eq.${restauranteId}` }, () => {
        if (recarregar.current) clearTimeout(recarregar.current)
        recarregar.current = setTimeout(() => void carregarLista(), 700)
      })
      .subscribe()
    return () => {
      if (recarregar.current) clearTimeout(recarregar.current)
      void supabase.removeChannel(canal)
    }
  }, [supabase, restauranteId, carregarLista])

  const mudou = useCallback(() => {
    onMudou()
    void carregarLista()
  }, [onMudou, carregarLista])

  // Fotos de perfil (0108): só das linhas que aparecem, depois que a rolagem para, até 10
  // por pedido. Cada telefone é pedido uma vez por sessão (e uma vez mais se o link quebrar).
  const [fotos, setFotos] = useState<Record<string, string | null>>({})
  const pedidas = useRef(new Set<string>())
  const fila = useRef<{ telefones: Set<string>; quebradas: Set<string> }>({ telefones: new Set(), quebradas: new Set() })
  const esperaFotos = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pedirFotos = useCallback(() => {
    if (esperaFotos.current) clearTimeout(esperaFotos.current)
    esperaFotos.current = setTimeout(async () => {
      const telefones = [...fila.current.telefones].slice(0, 10)
      const quebradas = [...fila.current.quebradas].slice(0, 10 - telefones.length)
      telefones.forEach((t) => fila.current.telefones.delete(t))
      quebradas.forEach((t) => fila.current.quebradas.delete(t))
      if (!telefones.length && !quebradas.length) return
      const r = await chamar<{ fotos: Record<string, string | null> }>('/api/admin/whatsapp/atendimento/fotos', { method: 'POST', body: JSON.stringify({ telefones, quebradas }) })
      if (r.dados) setFotos((f) => ({ ...f, ...r.dados!.fotos }))
      if (fila.current.telefones.size || fila.current.quebradas.size) pedirFotos()
    }, 700)
  }, [])
  const aoVerLinhas = useCallback((visiveis: ConversaCentral[]) => {
    let novas = false
    for (const c of visiveis) {
      if (pedidas.current.has(c.telefone)) continue
      const venceu = !c.fotoEm || Date.now() - new Date(c.fotoEm).getTime() > 3 * 24 * 60 * 60_000
      if (!venceu) continue
      pedidas.current.add(c.telefone)
      fila.current.telefones.add(c.telefone)
      novas = true
    }
    if (novas) pedirFotos()
  }, [pedirFotos])
  const quebradasPedidas = useRef(new Set<string>())
  const aoQuebrarFoto = useCallback((telefone: string) => {
    setFotos((f) => ({ ...f, [telefone]: null }))
    if (quebradasPedidas.current.has(telefone)) return
    quebradasPedidas.current.add(telefone)
    fila.current.quebradas.add(telefone)
    pedirFotos()
  }, [pedirFotos])
  useEffect(() => () => { if (esperaFotos.current) clearTimeout(esperaFotos.current) }, [])
  const fotoDe = useCallback((c: Pick<ConversaCentral, 'telefone' | 'foto'>) => (c.telefone in fotos ? fotos[c.telefone] : c.foto), [fotos])

  // Esc minimiza (sem perder a conversa aberta).
  useEffect(() => {
    if (oculto) return
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as HTMLElement)?.closest?.('[data-sem-esc]')) onMinimizar() }
    window.addEventListener('keydown', tecla)
    return () => window.removeEventListener('keydown', tecla)
  }, [oculto, onMinimizar])

  const janela = maximizado
    ? 'inset-3 sm:inset-6'
    : 'inset-0 sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[640px] sm:w-[960px] sm:max-h-[calc(100vh-2rem)] sm:max-w-[calc(100vw-2rem)] sm:resize sm:min-h-[420px] sm:min-w-[640px]'

  // Situação do robô (ligado e respostas em 24h), conferida ao abrir a central.
  const [robo, setRobo] = useState<{ ativo: boolean; respostas24h: number } | null>(null)
  useEffect(() => {
    if (oculto) return
    fetch('/api/admin/whatsapp/robo', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) setRobo({ ativo: Boolean(j.roboAtivo), respostas24h: Number(j.envios24h?.enviados ?? 0) }) })
      .catch(() => {})
  }, [oculto])

  return (
    <section
      role="dialog"
      aria-label="Atendimento WhatsApp"
      data-testid="atendimento-central"
      hidden={oculto}
      className={`fixed z-40 ${oculto ? 'hidden' : 'flex'} flex-col overflow-hidden bg-white shadow-[0_18px_50px_rgba(15,23,42,0.28)] sm:rounded-[12px] sm:border sm:border-[#E5E7EB] ${janela}`}
    >
      <header className="flex h-[46px] flex-shrink-0 items-center gap-2 border-b border-[#E5E7EB] bg-[#F9FAFB] px-3">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#25D366] text-white"><Bot className="h-3.5 w-3.5" /></span>
        <h2 className="text-[14px] font-semibold text-[#111827]">Atendimento WhatsApp</h2>
        {/* Informações do robô ficam SÓ aqui (2026-10-06): Integrações é só conectar; a configuração, em Ajustes. */}
        {robo && (
          <span className={['hidden items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold sm:inline-flex', robo.ativo ? 'bg-[#ECFDF5] text-[#047857]' : 'bg-[#F3F4F6] text-[#4B5563]'].join(' ')} data-testid="atendimento-robo" title="Configurar em Ajustes › Robô de atendimento">
            <Bot className="h-3 w-3" /> {robo.ativo ? `Robô ativo · ${robo.respostas24h} respostas em 24h` : 'Robô desligado'}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => onSom(!som)} title={som ? 'Desligar som de aviso' : 'Ligar som de aviso'} aria-label={som ? 'Desligar som de aviso' : 'Ligar som de aviso'} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#EEF0F3]" data-testid="atendimento-som">
            {som ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onMinimizar} title="Minimizar" aria-label="Minimizar" className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#EEF0F3]" data-testid="atendimento-minimizar"><Minus className="h-4 w-4" /></button>
          <button type="button" onClick={() => setMaximizado((v) => !v)} title={maximizado ? 'Restaurar' : 'Maximizar'} aria-label={maximizado ? 'Restaurar' : 'Maximizar'} className="hidden h-8 w-8 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#EEF0F3] sm:flex" data-testid="atendimento-maximizar">
            {maximizado ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button type="button" onClick={onFechar} title="Fechar" aria-label="Fechar" className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#EEF0F3]" data-testid="atendimento-fechar"><X className="h-4 w-4" /></button>
        </div>
      </header>

      {aviso && (
        <p className="flex items-center gap-2 border-b border-[#FECACA] bg-[#FEF2F2] px-3 py-1.5 text-[12.5px] text-[#B91C1C]" role="alert">
          {aviso}
          <button type="button" onClick={() => setAviso(null)} className="ml-auto" aria-label="Fechar aviso"><X className="h-3.5 w-3.5" /></button>
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ESQUERDA: lista */}
        <aside className={['flex min-h-0 w-full flex-col border-r border-[#E5E7EB] sm:w-[300px] sm:flex-shrink-0 lg:w-[320px]', selecionada ? 'max-sm:hidden' : ''].join(' ')}>
          <div className="space-y-2 border-b border-[#F3F4F6] p-2.5">
            <label className="flex items-center gap-2 rounded-[8px] bg-[#F3F4F6] px-2.5">
              <Search className="h-4 w-4 flex-shrink-0 text-[#9CA3AF]" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome ou telefone" aria-label="Buscar conversa" data-testid="atendimento-busca" className="h-[34px] min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[#9CA3AF]" />
            </label>
            <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtro">
              {([['aguardando', 'Aguardando'], ['humano', 'Em atendimento'], ['todas', 'Todas']] as [Filtro, string][]).map(([f, r]) => (
                <button key={f} type="button" role="tab" aria-selected={filtro === f && !tagFiltro} onClick={() => { setFiltro(f); setTagFiltro(null) }} data-testid={`atendimento-filtro-${f}`}
                  className={['rounded-full px-2.5 py-1 text-[12px] font-semibold', filtro === f && !tagFiltro ? 'bg-[#0688D4] text-white' : 'bg-[#F3F4F6] text-[#4B5563] hover:bg-[#E5E7EB]'].join(' ')}>{r}</button>
              ))}
              {tags.length > 0 && (
                <select value={tagFiltro ?? ''} onChange={(e) => { setTagFiltro(e.target.value || null); if (e.target.value) setFiltro('todas') }} aria-label="Filtrar por tag" data-testid="atendimento-filtro-tag"
                  className={['rounded-full border-0 px-2 py-1 text-[12px] font-semibold outline-none', tagFiltro ? 'bg-[#0688D4] text-white' : 'bg-[#F3F4F6] text-[#4B5563]'].join(' ')}>
                  <option value="">Por tag</option>
                  {tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              )}
            </div>
          </div>
          <ListaConversas
            conversas={conversas}
            tags={tags}
            carregando={carregandoLista}
            temMais={!!proximo}
            onMais={() => proximo && void carregarLista(proximo)}
            selecionada={selecionada}
            onSelecionar={setSelecionada}
            filtro={filtro}
            fotoDe={fotoDe}
            onVerLinhas={aoVerLinhas}
            onFotoQuebrou={aoQuebrarFoto}
          />
        </aside>

        {/* DIREITA: conversa */}
        <div className={['flex min-h-0 min-w-0 flex-1', selecionada ? '' : 'max-sm:hidden'].join(' ')}>
          {selecionada ? (
            <Conversa key={selecionada} id={selecionada} tags={tags} onTagsMudaram={carregarTags} onVoltar={() => setSelecionada(null)} onMudou={mudou} onAviso={setAviso} fotoDe={fotoDe} onFotoQuebrou={aoQuebrarFoto} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-[#F9FAFB] p-6 text-center">
              <UserRound className="h-10 w-10 text-[#D1D5DB]" />
              <p className="text-[14px] font-semibold text-[#374151]">Escolha uma conversa</p>
              <p className="max-w-xs text-[13px] text-[#6B7280]">As conversas em “Aguardando” pediram para falar com alguém da loja.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

// ─── lista (desenha só as linhas visíveis) ────────────────────────────────────

function ListaConversas({ conversas, tags, carregando, temMais, onMais, selecionada, onSelecionar, filtro, fotoDe, onVerLinhas, onFotoQuebrou }: {
  conversas: ConversaCentral[]
  tags: Tag[]
  carregando: boolean
  temMais: boolean
  onMais: () => void
  selecionada: string | null
  onSelecionar: (id: string) => void
  filtro: Filtro
  fotoDe: (c: ConversaCentral) => string | null
  onVerLinhas: (visiveis: ConversaCentral[]) => void
  onFotoQuebrou: (telefone: string) => void
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const [janela, setJanela] = useState({ topo: 0, altura: 600 })
  const porId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])

  useLayoutEffect(() => {
    const el = caixa.current
    if (!el) return
    const medir = () => setJanela({ topo: el.scrollTop, altura: el.clientHeight })
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function rolar() {
    const el = caixa.current
    if (!el) return
    setJanela({ topo: el.scrollTop, altura: el.clientHeight })
    if (temMais && el.scrollTop + el.clientHeight > el.scrollHeight - ALTURA_LINHA * 3) onMais()
  }

  // Linhas de fato na tela (sem a folga do desenho): são só elas que pedem foto.
  const vistaDe = Math.floor(janela.topo / ALTURA_LINHA)
  const vistaAte = Math.min(conversas.length, Math.ceil((janela.topo + janela.altura) / ALTURA_LINHA))
  useEffect(() => {
    if (vistaAte > vistaDe) onVerLinhas(conversas.slice(vistaDe, vistaAte))
  }, [conversas, vistaDe, vistaAte, onVerLinhas])
  if (carregando && !conversas.length) {
    return <div className="space-y-1 p-2" aria-busy="true">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-[60px] animate-pulse rounded-[8px] bg-[#F3F4F6]" />)}</div>
  }
  if (!conversas.length) {
    return (
      <p className="p-6 text-center text-[13px] text-[#6B7280]" data-testid="atendimento-vazio">
        {filtro === 'aguardando' ? 'Ninguém aguardando atendente agora.' : filtro === 'humano' ? 'Nenhuma conversa em atendimento.' : 'Nenhuma conversa ainda.'}
      </p>
    )
  }
  const primeiro = Math.max(0, Math.floor(janela.topo / ALTURA_LINHA) - 4)
  const ultimo = Math.min(conversas.length, Math.ceil((janela.topo + janela.altura) / ALTURA_LINHA) + 4)
  return (
    <div ref={caixa} onScroll={rolar} className="min-h-0 flex-1 overflow-y-auto" data-testid="atendimento-lista">
      <ul style={{ height: conversas.length * ALTURA_LINHA + (temMais ? 40 : 0), position: 'relative' }}>
        {conversas.slice(primeiro, ultimo).map((c, i) => {
          const pos = primeiro + i
          return (
            <li key={c.id} style={{ position: 'absolute', top: pos * ALTURA_LINHA, left: 0, right: 0, height: ALTURA_LINHA }}>
              <button
                type="button"
                onClick={() => onSelecionar(c.id)}
                data-testid={`atendimento-conversa-${c.telefone}`}
                className={['flex h-full w-full items-center gap-2.5 border-b border-[#F3F4F6] px-3 text-left hover:bg-[#F9FAFB]', selecionada === c.id ? 'bg-[#EFF6FF]' : ''].join(' ')}
              >
                <Avatar nome={c.nome} telefone={c.telefone} foto={fotoDe(c)} tamanho={40} onQuebrou={onFotoQuebrou} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[#111827]">{c.nome ?? c.telefoneExibido}</span>
                    <span className={['flex-shrink-0 text-[11.5px]', c.naoLidas ? 'font-semibold text-[#059669]' : 'text-[#9CA3AF]'].join(' ')}>{horaCurta(c.ultimaAtividadeEm)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {c.atendimento === 'aguardando' && <Clock className="h-3.5 w-3.5 flex-shrink-0 text-[#D97706]" aria-label="Aguardando" />}
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[#6B7280]">
                      {c.ultimaOrigem && c.ultimaOrigem !== 'cliente' ? `${c.ultimaOrigem === 'atendente' ? 'Você' : ROTULO_ORIGEM[c.ultimaOrigem] ?? ''}: ` : ''}{c.previa ?? ''}
                    </span>
                    {c.naoLidas > 0 && <span className="flex h-[18px] min-w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-[#25D366] px-1 text-[11px] font-semibold text-white">{c.naoLidas}</span>}
                  </span>
                  {c.tags.length > 0 && (
                    <span className="mt-0.5 flex gap-1 overflow-hidden">
                      {c.tags.slice(0, 3).map((id) => { const t = porId.get(id); return t ? <span key={id} className="truncate rounded-full px-1.5 text-[10.5px] font-semibold text-white" style={{ backgroundColor: t.cor }}>{t.nome}</span> : null })}
                    </span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
        {temMais && <li style={{ position: 'absolute', top: conversas.length * ALTURA_LINHA, left: 0, right: 0, height: 40 }} className="flex items-center justify-center text-[12px] text-[#9CA3AF]"><Loader2 className="h-4 w-4 animate-spin" /></li>}
      </ul>
    </div>
  )
}

// ─── avatar: foto do WhatsApp (carregada só quando aparece) ou iniciais ────────

function Avatar({ nome, telefone, foto, tamanho, onQuebrou }: { nome: string | null; telefone: string; foto: string | null; tamanho: number; onQuebrou: (telefone: string) => void }) {
  const [quebrou, setQuebrou] = useState(false)
  useEffect(() => setQuebrou(false), [foto])
  const estilo = { width: tamanho, height: tamanho }
  if (foto && !quebrou) {
    return (
      // A imagem vem direto do WhatsApp (não passa pelo servidor); sem referrer.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={foto} alt="" width={tamanho} height={tamanho} loading="lazy" decoding="async" referrerPolicy="no-referrer" style={estilo}
        className="flex-shrink-0 rounded-full bg-[#E5E7EB] object-cover" data-testid="atendimento-foto"
        onError={() => { setQuebrou(true); onQuebrou(telefone) }} />
    )
  }
  return (
    <span style={estilo} className={['flex flex-shrink-0 items-center justify-center rounded-full bg-[#E5E7EB] font-semibold text-[#4B5563]', tamanho >= 40 ? 'text-[13px]' : 'text-[12.5px]'].join(' ')}>
      {iniciais(nome, telefone)}
    </span>
  )
}

// ─── uma conversa ─────────────────────────────────────────────────────────────

function Conversa({ id, tags, onTagsMudaram, onVoltar, onMudou, onAviso, fotoDe, onFotoQuebrou }: {
  id: string
  tags: Tag[]
  onTagsMudaram: () => Promise<void>
  onVoltar: () => void
  onMudou: () => void
  onAviso: (t: string | null) => void
  fotoDe: (c: ConversaCentral) => string | null
  onFotoQuebrou: (telefone: string) => void
}) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null)
  const [mensagens, setMensagens] = useState<MensagemCentral[]>([])
  const [anteriores, setAnteriores] = useState<string | null>(null)
  const [carregandoAntigas, setCarregandoAntigas] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [painelCliente, setPainelCliente] = useState(false)
  const rolagem = useRef<HTMLDivElement>(null)
  const noFim = useRef(true)

  const carregarDetalhe = useCallback(async () => {
    const r = await chamar<Detalhe>(`/api/admin/whatsapp/atendimento/conversas/${id}`)
    if (r.dados) setDetalhe(r.dados)
    else onAviso(r.erro)
  }, [id, onAviso])

  const marcarLida = useCallback(async () => {
    await chamar(`/api/admin/whatsapp/atendimento/conversas/${id}`, { method: 'POST', body: JSON.stringify({ acao: 'lida' }) })
    onMudou()
  }, [id, onMudou])

  // Página mais recente (e junta com o que já está na tela).
  const carregarRecentes = useCallback(async () => {
    const r = await chamar<{ mensagens: MensagemCentral[]; anteriores: string | null }>(`/api/admin/whatsapp/atendimento/conversas/${id}/mensagens`)
    if (!r.dados) return
    setMensagens((atual) => {
      const mapa = new Map(atual.map((m) => [m.id, m]))
      for (const m of r.dados!.mensagens) mapa.set(m.id, m)
      return [...mapa.values()].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm) || a.id.localeCompare(b.id))
    })
    setAnteriores((a) => a ?? r.dados!.anteriores)
  }, [id])

  useEffect(() => {
    void carregarDetalhe()
    void carregarRecentes().then(() => void marcarLida())
  }, [carregarDetalhe, carregarRecentes, marcarLida])

  // Tempo real da CONVERSA aberta.
  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | null = null
    const canal = supabase
      .channel(`atendimento-conversa-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_mensagens', filter: `conversa_id=eq.${id}` }, () => {
        if (espera) clearTimeout(espera)
        espera = setTimeout(() => { void carregarRecentes(); void carregarDetalhe(); void marcarLida() }, 400)
      })
      .subscribe()
    return () => {
      if (espera) clearTimeout(espera)
      void supabase.removeChannel(canal)
    }
  }, [supabase, id, carregarRecentes, carregarDetalhe, marcarLida])

  // Fica no fim quando chega mensagem (se a pessoa já estava lá).
  useLayoutEffect(() => {
    const el = rolagem.current
    if (el && noFim.current) el.scrollTop = el.scrollHeight
  }, [mensagens])

  async function carregarAntigas() {
    const el = rolagem.current
    if (!anteriores || carregandoAntigas || !el) return
    setCarregandoAntigas(true)
    const antes = el.scrollHeight
    const r = await chamar<{ mensagens: MensagemCentral[]; anteriores: string | null }>(`/api/admin/whatsapp/atendimento/conversas/${id}/mensagens?antes=${encodeURIComponent(anteriores)}`)
    setCarregandoAntigas(false)
    if (!r.dados) return
    noFim.current = false
    setMensagens((atual) => [...r.dados!.mensagens.filter((m) => !atual.some((a) => a.id === m.id)), ...atual])
    setAnteriores(r.dados.anteriores)
    requestAnimationFrame(() => { if (rolagem.current) rolagem.current.scrollTop = rolagem.current.scrollHeight - antes })
  }

  async function acao(a: 'assumir' | 'encerrar' | 'pausar' | 'retomar', ok: string) {
    setOcupado(true)
    const r = await chamar(`/api/admin/whatsapp/atendimento/conversas/${id}`, { method: 'POST', body: JSON.stringify({ acao: a }) })
    setOcupado(false)
    onAviso(r.ok ? null : r.erro)
    if (r.ok) {
      await carregarDetalhe()
      onMudou()
      void ok
    }
  }

  async function enviar(texto: string, imagem: File | null): Promise<boolean> {
    noFim.current = true
    const corpo: RequestInit = imagem
      ? { method: 'POST', body: (() => { const f = new FormData(); f.set('imagem', imagem); f.set('legenda', texto); return f })() }
      : { method: 'POST', body: JSON.stringify({ texto }) }
    const r = await chamar(`/api/admin/whatsapp/atendimento/conversas/${id}/mensagens`, corpo)
    onAviso(r.ok ? null : r.erro)
    // Recarrega em segundo plano: o campo já está livre para a próxima mensagem.
    void Promise.all([carregarRecentes(), carregarDetalhe()]).then(() => onMudou())
    return r.ok
  }

  const c = detalhe?.conversa
  const robo = detalhe?.roboAtivo === true
  const est = c ? ROTULO_ESTADO[c.atendimento] : null
  // Robô pausado pelo painel sem ninguém ter assumido: a ação é retomar.
  const pausada = !!c && c.atendimento === 'humano' && !c.atendenteNome

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Cabeçalho do cliente */}
        <div className="flex min-h-[58px] flex-shrink-0 flex-wrap items-center gap-2 border-b border-[#E5E7EB] px-3 py-2">
          <button type="button" onClick={onVoltar} className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[#4B5563] hover:bg-[#F3F4F6] sm:hidden" aria-label="Voltar para a lista"><ArrowLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setPainelCliente((v) => !v)} className="flex min-w-[150px] flex-1 items-center gap-2.5 text-left" title="Dados do cliente" data-testid="atendimento-cliente-abrir">
            {c ? <Avatar nome={c.nome} telefone={c.telefone} foto={fotoDe(c)} tamanho={36} onQuebrou={onFotoQuebrou} /> : <span className="h-9 w-9 flex-shrink-0 rounded-full bg-[#E5E7EB]" />}
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold text-[#111827]" data-testid="atendimento-nome">{c ? c.nome ?? c.telefoneExibido : 'Carregando…'}</span>
              <span className="block truncate text-[12px] text-[#6B7280]">{c?.nome ? c.telefoneExibido : ''}{c?.atendenteNome && c.atendimento === 'humano' ? `${c?.nome ? ' · ' : ''}com ${c.atendenteNome}` : ''}</span>
            </span>
          </button>
          {est && <span className={`flex-shrink-0 rounded-full px-2 py-[2px] text-[11.5px] font-semibold ${est.cor}`} data-testid="atendimento-estado">{est.texto}</span>}
          {c && (
            <div className="flex flex-shrink-0 flex-wrap gap-1.5">
              {c.atendimento !== 'humano' && (
                <button type="button" disabled={ocupado} onClick={() => void acao('assumir', 'Atendimento assumido.')} data-testid="atendimento-assumir" className="inline-flex items-center gap-1 rounded-[8px] bg-[#0688D4] px-2.5 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#0570AE] disabled:opacity-50">
                  <Hand className="h-3.5 w-3.5" /> Assumir atendimento
                </button>
              )}
              {(c.atendimento === 'aguardando' || (c.atendimento === 'humano' && !pausada)) && (
                <button type="button" disabled={ocupado} onClick={() => void acao('encerrar', 'Conversa encerrada.')} data-testid="atendimento-encerrar" className="inline-flex items-center gap-1 rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[#1F2937] hover:border-[#0688D4] hover:text-[#0688D4] disabled:opacity-50">
                  <Check className="h-3.5 w-3.5" /> {robo ? 'Encerrar e devolver ao robô' : 'Encerrar atendimento'}
                </button>
              )}
              {robo && c.atendimento === 'robo' && (
                <button type="button" disabled={ocupado} onClick={() => void acao('pausar', 'Robô pausado nesta conversa.')} data-testid="atendimento-pausar" className="inline-flex items-center gap-1 rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[#1F2937] hover:border-[#0688D4] disabled:opacity-50">
                  <Pause className="h-3.5 w-3.5" /> Pausar robô
                </button>
              )}
              {robo && (c.atendimento === 'encerrada' || pausada) && (
                <button type="button" disabled={ocupado} onClick={() => void acao('retomar', 'Robô retomado.')} data-testid="atendimento-retomar" className="inline-flex items-center gap-1 rounded-[8px] border border-[#D1D5DB] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[#1F2937] hover:border-[#0688D4] disabled:opacity-50">
                  <Play className="h-3.5 w-3.5" /> Retomar robô
                </button>
              )}
            </div>
          )}
        </div>

        {/* Histórico */}
        <div
          ref={rolagem}
          onScroll={(e) => {
            const el = e.currentTarget
            noFim.current = el.scrollTop + el.clientHeight > el.scrollHeight - 40
            if (el.scrollTop < 60) void carregarAntigas()
          }}
          className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#EFEAE2] px-3 py-3 sm:px-6"
          data-testid="atendimento-mensagens"
        >
          {anteriores && <p className="py-1 text-center text-[11.5px] text-[#6B7280]">{carregandoAntigas ? 'Carregando…' : 'Role para cima para ver mais'}</p>}
          {mensagens.map((m) => <Balao key={m.id} m={m} />)}
          {!mensagens.length && <p className="py-6 text-center text-[12.5px] text-[#6B7280]">Sem mensagens.</p>}
        </div>

        <Compositor onEnviar={enviar} desabilitado={!c} />
      </div>

      {/* Aba do cliente */}
      {painelCliente && detalhe && (
        <PainelCliente detalhe={detalhe} tags={tags} onFechar={() => setPainelCliente(false)} onTagsMudaram={async () => { await onTagsMudaram(); await carregarDetalhe(); onMudou() }} onAviso={onAviso} />
      )}
    </div>
  )
}

function Balao({ m }: { m: MensagemCentral }) {
  const minha = m.direcao === 'loja'
  const rotulo = m.origem === 'atendente' ? m.autorNome ?? 'Atendente' : ROTULO_ORIGEM[m.origem]
  const hora = new Date(m.criadoEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
  const auto = m.origem === 'robo' || m.origem === 'automatico' || m.origem === 'disparo'
  return (
    <div className={['flex', minha ? 'justify-end' : 'justify-start'].join(' ')} data-testid="atendimento-balao" data-origem={m.origem}>
      <div className={['max-w-[78%] rounded-[10px] px-2.5 py-1.5 text-[13.5px] leading-[19px] shadow-[0_1px_1px_rgba(0,0,0,0.08)]', minha ? (auto ? 'bg-[#F0FBEA] text-[#111827]' : 'bg-[#D9FDD3] text-[#111827]') : 'bg-white text-[#111827]'].join(' ')}>
        {minha && rotulo && (
          <p className={['mb-0.5 flex items-center gap-1 text-[11px] font-semibold', auto ? 'text-[#6B7280]' : 'text-[#047857]'].join(' ')}>
            {m.origem === 'robo' ? <Bot className="h-3 w-3" /> : m.origem === 'atendente' ? <User className="h-3 w-3" /> : null}{rotulo}
          </p>
        )}
        {m.tipo === 'imagem' && (m.midiaUrl || m.temMidia) && <Imagem mensagemId={m.id} url={m.midiaUrl} />}
        {m.texto ? <p className="whitespace-pre-wrap break-words">{m.texto}</p> : m.tipo !== 'texto' && !(m.tipo === 'imagem' && (m.midiaUrl || m.temMidia)) ? <p className="italic text-[#6B7280]">{TIPO_TEXTO[m.tipo] ?? 'Mensagem'}</p> : m.texto === null && m.tipo === 'texto' ? <p className="italic text-[#9CA3AF]">Conteúdo removido após 90 dias</p> : null}
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-[#6B7280]">
          {hora}
          {minha && m.statusEnvio === 'enviando' && <Clock className="h-3 w-3" aria-label="Enviando" />}
          {minha && m.statusEnvio === 'enviado' && <CheckCheck className="h-3 w-3 text-[#53BDEB]" aria-label="Enviada" />}
          {minha && m.statusEnvio === 'falhou' && <span className="font-semibold text-[#DC2626]" title={m.erro ?? ''}>{rotuloSaidaNaoConfirmada(m.erro)}</span>}
        </p>
      </div>
    </div>
  )
}
const TIPO_TEXTO: Record<string, string> = { imagem: '📷 Foto', audio: '🎤 Áudio', video: '🎬 Vídeo', figurinha: 'Figurinha', localizacao: '📍 Localização', documento: '📄 Documento', contato: '👤 Contato', outro: 'Mensagem' }

/** Foto sob demanda: só busca quando o balão aparece na tela. */
function Imagem({ mensagemId, url }: { mensagemId: string; url: string | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(url)
  const [falhou, setFalhou] = useState(false)
  useEffect(() => {
    if (url || !ref.current) return
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) {
        io.disconnect()
        setSrc(`/api/admin/whatsapp/atendimento/midia?mensagem=${mensagemId}`)
      }
    })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [url, mensagemId])
  return (
    <div ref={ref} className="mb-1 min-h-[40px]">
      {src && !falhou ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Foto" loading="lazy" onError={() => setFalhou(true)} className="max-h-[260px] max-w-full rounded-[6px]" />
      ) : (
        <p className="italic text-[#6B7280]">📷 Foto</p>
      )}
    </div>
  )
}

function Compositor({ onEnviar, desabilitado }: { onEnviar: (t: string, img: File | null) => Promise<boolean>; desabilitado: boolean }) {
  const [texto, setTexto] = useState('')
  const [imagem, setImagem] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [emojis, setEmojis] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const arquivo = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`
  }, [texto])

  async function enviar() {
    const t = texto.trim()
    if ((!t && !imagem) || enviando || desabilitado) return
    // Otimista: o campo limpa na hora; se falhar, o texto volta (sem apagar o que já foi digitado).
    const img = imagem
    setEnviando(true)
    setTexto('')
    setImagem(null)
    const ok = await onEnviar(t, img)
    setEnviando(false)
    if (!ok) {
      setTexto((atual) => (atual ? atual : t))
      setImagem((atual) => atual ?? img)
    }
    area.current?.focus()
  }

  return (
    <div className="relative flex-shrink-0 border-t border-[#E5E7EB] bg-[#F9FAFB] p-2">
      {imagem && (
        <div className="mb-2 flex items-center gap-2 rounded-[8px] bg-white px-2 py-1.5 text-[12.5px] text-[#374151]">
          <ImagePlus className="h-4 w-4 text-[#6B7280]" /> <span className="min-w-0 flex-1 truncate">{imagem.name}</span>
          <button type="button" onClick={() => setImagem(null)} aria-label="Tirar imagem"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {emojis && (
        <div className="absolute bottom-full left-2 mb-1 grid w-[256px] grid-cols-8 gap-0.5 rounded-[10px] border border-[#E5E7EB] bg-white p-1.5 shadow-lg" data-sem-esc>
          {EMOJIS.map((e) => (
            <button key={e} type="button" onClick={() => { setTexto((t) => t + e); setEmojis(false); area.current?.focus() }} className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[18px] hover:bg-[#F3F4F6]">{e}</button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button type="button" onClick={() => setEmojis((v) => !v)} aria-label="Emoji" title="Emoji" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#EEF0F3]"><Smile className="h-5 w-5" /></button>
        <button type="button" onClick={() => arquivo.current?.click()} aria-label="Enviar foto" title="Enviar foto" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[8px] text-[#6B7280] hover:bg-[#EEF0F3]"><ImagePlus className="h-5 w-5" /></button>
        <input ref={arquivo} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { setImagem(e.target.files?.[0] ?? null); e.target.value = '' }} />
        <textarea
          ref={area}
          rows={1}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void enviar() }
          }}
          disabled={desabilitado}
          placeholder={imagem ? 'Legenda (opcional)' : 'Digite uma mensagem'}
          aria-label="Mensagem"
          data-testid="atendimento-texto"
          maxLength={4000}
          className="min-h-[36px] min-w-0 flex-1 resize-none rounded-[18px] border border-[#E5E7EB] bg-white px-3.5 py-[7px] text-[13.5px] leading-[20px] outline-none focus:border-[#0688D4]"
        />
        <button type="button" onClick={() => void enviar()} disabled={enviando || desabilitado || (!texto.trim() && !imagem)} aria-label="Enviar" title="Enviar (Enter)" data-testid="atendimento-enviar"
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#0688D4] text-white hover:bg-[#0570AE] disabled:opacity-40">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1 px-1 text-[11px] text-[#9CA3AF] max-sm:hidden">Enter envia · Shift+Enter quebra a linha</p>
    </div>
  )
}

function PainelCliente({ detalhe, tags, onFechar, onTagsMudaram, onAviso }: {
  detalhe: Detalhe
  tags: Tag[]
  onFechar: () => void
  onTagsMudaram: () => Promise<void>
  onAviso: (t: string | null) => void
}) {
  const c = detalhe.conversa
  const [nova, setNova] = useState('')
  const [cor, setCor] = useState(CORES_TAG[0])
  const [ocupado, setOcupado] = useState(false)

  async function alternar(tagId: string, aplicar: boolean) {
    setOcupado(true)
    const r = await chamar(`/api/admin/whatsapp/atendimento/conversas/${c.id}/tags`, { method: 'POST', body: JSON.stringify({ tagId, aplicar }) })
    setOcupado(false)
    onAviso(r.ok ? null : r.erro)
    if (r.ok) await onTagsMudaram()
  }
  async function criar() {
    if (!nova.trim()) return
    setOcupado(true)
    const r = await chamar<{ tag: Tag }>('/api/admin/whatsapp/atendimento/tags', { method: 'POST', body: JSON.stringify({ nome: nova, cor }) })
    setOcupado(false)
    onAviso(r.ok ? null : r.erro)
    if (r.dados) {
      setNova('')
      await chamar(`/api/admin/whatsapp/atendimento/conversas/${c.id}/tags`, { method: 'POST', body: JSON.stringify({ tagId: r.dados.tag.id, aplicar: true }) })
      await onTagsMudaram()
    }
  }

  return (
    <aside className="flex w-full flex-shrink-0 flex-col border-l border-[#E5E7EB] bg-white max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:max-w-[300px] max-md:shadow-xl md:w-[260px]" data-testid="atendimento-cliente">
      <div className="flex items-center justify-between border-b border-[#F3F4F6] px-3 py-2.5">
        <p className="text-[13px] font-semibold text-[#111827]">Cliente</p>
        <button type="button" onClick={onFechar} aria-label="Fechar dados do cliente" className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#6B7280] hover:bg-[#F3F4F6]"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 text-[13px]">
        <div>
          <p className="font-semibold text-[#111827]">{c.nome ?? 'Sem nome'}</p>
          <p className="text-[#6B7280]">{c.telefoneExibido}</p>
        </div>

        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6B7280]"><TagIcon className="h-3.5 w-3.5" /> Tags</p>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => {
              const tem = c.tags.includes(t.id)
              return (
                <button key={t.id} type="button" disabled={ocupado} onClick={() => void alternar(t.id, !tem)} data-testid={`atendimento-tag-${t.nome}`} aria-pressed={tem}
                  className={['rounded-full border px-2 py-[2px] text-[12px] font-semibold', tem ? 'border-transparent text-white' : 'border-[#E5E7EB] bg-white text-[#4B5563]'].join(' ')}
                  style={tem ? { backgroundColor: t.cor } : undefined}>
                  {tem ? '✓ ' : ''}{t.nome}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <input value={nova} onChange={(e) => setNova(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void criar() } }} maxLength={30} placeholder="Nova tag" aria-label="Nome da nova tag" data-testid="atendimento-nova-tag"
              className="h-[30px] min-w-0 flex-1 rounded-[6px] border border-[#D1D5DB] px-2 text-[12.5px] outline-none focus:border-[#0688D4]" />
            <button type="button" disabled={ocupado || !nova.trim()} onClick={() => void criar()} aria-label="Criar tag" data-testid="atendimento-criar-tag" className="flex h-[30px] w-[30px] items-center justify-center rounded-[6px] bg-[#0688D4] text-white disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
          <div className="mt-1.5 flex gap-1" role="radiogroup" aria-label="Cor da nova tag">
            {CORES_TAG.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={cor === k} aria-label={`Cor ${k}`} onClick={() => setCor(k)} className={['h-5 w-5 rounded-full', cor === k ? 'ring-2 ring-[#111827] ring-offset-1' : ''].join(' ')} style={{ backgroundColor: k }} />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6B7280]">Últimos pedidos</p>
          {detalhe.pedidos.length ? (
            <ul className="space-y-1.5">
              {detalhe.pedidos.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 rounded-[8px] border border-[#F3F4F6] px-2 py-1.5">
                  <span className="min-w-0"><strong className="font-semibold">#{p.numero}</strong> <span className="text-[#6B7280]">· {STATUS_PEDIDO[p.status] ?? p.status}</span><span className="block text-[11.5px] text-[#9CA3AF]">{horaCurta(p.criadoEm)}</span></span>
                  <span className="flex-shrink-0 tabular-nums">{brl(p.total)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[#9CA3AF]">Nenhum pedido com este número.</p>}
        </div>

        {detalhe.fidelidade.length > 0 && (
          <div>
            <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#6B7280]">Fidelidade</p>
            <ul className="space-y-2">
              {detalhe.fidelidade.map((f) => (
                <li key={f.nome}>
                  <p className="font-medium text-[#111827]">{f.nome}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#F3F4F6]"><div className="h-full rounded-full bg-[#10B981]" style={{ width: `${Math.max(0, Math.min(100, f.percentual))}%` }} /></div>
                  <p className="mt-0.5 text-[12px] text-[#6B7280]">{f.faltaTexto}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  )
}
