'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import { sairDoPainel, useEstadoSessao } from '@/lib/sessao-cliente'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { corteLiberacaoAgendados, listarPedidosKanban, type Pedido } from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/notificar'
import { colunasKds, filtrarPorSetor, lerLimites, pedidosDemo, setoresDosPedidos, SETORES_DEMO, type CenarioDemo } from '@/lib/kds'
import { QuadroKds, type FichaKds, type PreferenciasKds } from '@/components/admin/kds/quadro-kds'

/**
 * KDS da loja (12/10/2026; só com "Novidades em teste" até o Felipe liberar). Na fila (aceitos no Painel) → Em preparo
 * (Começar preparo) → Prontos (Pronto = "Pronto p/ despacho" no Kanban; Voltar desfaz engano). Despacho só no Kanban.
 * Tempo real pelo MESMO canal do Kanban (eventos do banco) + rede de segurança lenta; nada de polling agressivo.
 * Ações pelo servidor (/api/admin/kds), compare-and-set no status. Setor, preferências e itens riscados ficam no aparelho.
 * `?demo=novo|atrasado|varios`: pedidos fictícios (prints), sem ler nem gravar nada.
 */
const CHAVE_PREFS = 'menuzia:kds-prefs'
const CHAVE_RISCADOS = 'menuzia:kds-riscados'
const CHAVE_SETOR = 'menuzia:kds-setor'

function lerPrefs(): PreferenciasKds {
  try {
    const j = JSON.parse(localStorage.getItem(CHAVE_PREFS) ?? '{}') as { escuro?: boolean; grande?: boolean; limites?: unknown }
    return { escuro: j.escuro !== false, grande: j.grande === true, limites: lerLimites(JSON.stringify(j.limites ?? null)) }
  } catch {
    return { escuro: true, grande: false, limites: lerLimites(null) }
  }
}
const guardar = (k: string, v: unknown) => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)) } catch { /* sem armazenamento */ } }

/** Demonstração: recebido vira "na fila", preparando vira "em preparo". */
function paraDemo(lista: Pedido[]): Pedido[] {
  return lista.map((p, i) => (p.status === 'recebido' ? { ...p, status: 'preparando', preparandoPor: null } : { ...p, preparandoPor: i % 2 ? 'Cozinha 1' : 'Cozinha 2' }))
}

export default function KdsPage() {
  return <Suspense fallback={null}><Kds /></Suspense>
}

function Kds() {
  const router = useRouter()
  const busca = useSearchParams()
  const demo = (['novo', 'atrasado', 'varios'] as const).find((c) => c === busca.get('demo')) as CenarioDemo | undefined
  const sessao = useEstadoSessao()
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [carregando, setCarregando] = useState(true)
  const [agora, setAgora] = useState(() => Date.now())
  const [prefs, setPrefs] = useState<PreferenciasKds>({ escuro: true, grande: false, limites: lerLimites(null) })
  const [riscados, setRiscados] = useState<Record<string, string[]>>({})
  const [setor, setSetor] = useState<string | null>(null)
  const [setorDoItem, setSetorDoItem] = useState<Map<string, string>>(() => new Map())
  const [fichas, setFichas] = useState<Record<string, FichaKds>>({})
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const fichasPedidas = useRef(new Set<string>())
  const [destaqueId, setDestaqueId] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const liberaMin = useRef(30)
  const seq = useRef(0)
  // KDS em todas as lojas desde 13/10 (a Cozinha antiga por QR saiu).
  const liberado = true

  useEffect(() => {
    setPrefs(lerPrefs())
    try { setRiscados(JSON.parse(localStorage.getItem(CHAVE_RISCADOS) ?? '{}')) } catch { /* vazio */ }
    try { setSetor(localStorage.getItem(CHAVE_SETOR) || null) } catch { /* vazio */ }
  }, [])
  const mudarPrefs = useCallback((p: PreferenciasKds) => { setPrefs(p); guardar(CHAVE_PREFS, p) }, [])
  const mudarSetor = useCallback((s: string | null) => { setSetor(s); guardar(CHAVE_SETOR, s ?? '') }, [])

  // Cronômetro: um relógio só para a tela toda (estado local; nenhuma chamada).
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 4000); return () => clearTimeout(t) }, [aviso])

  useEffect(() => {
    if (demo || !liberado) return
    let vivo = true
    void buscarRestauranteIdDoUsuario(supabase).then(async (id) => {
      if (!vivo || !id) return
      const corte = await corteLiberacaoAgendados(supabase, id).catch(() => null)
      if (corte) liberaMin.current = Math.max(0, Math.round((Date.parse(corte) - Date.now()) / 60_000))
      setRestauranteId(id)
    })
    return () => { vivo = false }
  }, [supabase, demo, liberado])

  const recarregar = useCallback(async (id: string) => {
    const n = ++seq.current
    try {
      const lista = await listarPedidosKanban(supabase, id)
      if (n === seq.current) setPedidos(lista)
    } catch { /* a rede de segurança tenta de novo */ } finally {
      if (n === seq.current) setCarregando(false)
    }
  }, [supabase])

  // Mesmo canal do Kanban: evento do banco → relê (Kanban e KDS se veem na hora). Poll só como rede de segurança.
  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: restauranteId ? `pedidos-kds-${restauranteId}` : null,
    tabelas: useMemo(() => [{ tabela: 'pedidos', filtro: restauranteId ? `restaurante_id=eq.${restauranteId}` : undefined }], [restauranteId]),
    aoEvento: useCallback(() => { if (restauranteId) void recarregar(restauranteId) }, [recarregar, restauranteId]),
    aoSincronizar: useCallback(() => { if (restauranteId) void recarregar(restauranteId) }, [recarregar, restauranteId]),
  })
  useEffect(() => {
    if (!restauranteId) return
    void recarregar(restauranteId)
    const t = setInterval(() => void recarregar(restauranteId), intervaloMs)
    return () => clearInterval(t)
  }, [restauranteId, recarregar, intervaloMs])

  const base = useMemo(() => (demo ? paraDemo(pedidosDemo(demo, Date.now())) : pedidos), [demo, pedidos])
  const mapaSetor = demo ? SETORES_DEMO : setorDoItem
  const todas = useMemo(() => colunasKds(base, new Date(), liberaMin.current), [base])
  const ativos = useMemo(() => [...todas.fila, ...todas.preparo], [todas])
  const setores = useMemo(() => setoresDosPedidos(ativos, mapaSetor), [ativos, mapaSetor])
  const filtro = setor && setores.includes(setor) ? setor : null
  const colunas = useMemo(() => ({
    fila: filtrarPorSetor(todas.fila, mapaSetor, filtro), preparo: filtrarPorSetor(todas.preparo, mapaSetor, filtro), prontos: todas.prontos, aguardandoAceite: todas.aguardandoAceite,
  }), [todas, mapaSetor, filtro])

  // Setor (categoria do cardápio) e ficha de preparo: busca só os itens que ainda não conhece (uma vez por item).
  const idsItens = useMemo(() => [...new Set(ativos.flatMap((p) => p.itens.map((i) => i.itemId).filter(Boolean) as string[]))].sort().join(','), [ativos])
  useEffect(() => {
    if (demo || !idsItens) return
    const faltam = idsItens.split(',').filter((id) => !fichasPedidas.current.has(id))
    if (!faltam.length) return
    for (const id of faltam) fichasPedidas.current.add(id)
    let vivo = true
    void supabase.from('itens_cardapio').select('id, imagem_thumb_url, imagem_url, grupos_cardapio(nome)').in('id', faltam).then(({ data }) => {
      if (!vivo || !data) return
      // Foto do item no cartão: a miniatura (400 px WebP); sem miniatura, a principal.
      setFotos((antes) => {
        const novo = { ...antes }
        for (const r of data as { id: string; imagem_thumb_url: string | null; imagem_url: string | null }[]) {
          const url = r.imagem_thumb_url || r.imagem_url
          if (url) novo[r.id] = url
        }
        return novo
      })
      setSetorDoItem((antes) => {
        const novo = new Map(antes)
        for (const r of data as { id: string; grupos_cardapio: { nome: string } | { nome: string }[] | null }[]) {
          const g = Array.isArray(r.grupos_cardapio) ? r.grupos_cardapio[0] : r.grupos_cardapio
          novo.set(r.id, g?.nome ?? '')
        }
        return novo
      })
    })
    void fetch(`/api/admin/kds?itens=${faltam.join(',')}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j: { fichas?: Record<string, FichaKds> } | null) => {
      if (vivo && j?.fichas) setFichas((antes) => ({ ...antes, ...j.fichas }))
    }).catch(() => {})
    return () => { vivo = false }
  }, [idsItens, demo, supabase])

  const riscar = useCallback((pedidoId: string, itemId: string) => {
    setRiscados((antes) => {
      const lista = antes[pedidoId] ?? []
      const proximo = { ...antes, [pedidoId]: lista.includes(itemId) ? lista.filter((x) => x !== itemId) : [...lista, itemId] }
      const vivos = new Set(base.map((p) => p.id))
      for (const k of Object.keys(proximo)) if (!vivos.has(k)) delete proximo[k]
      guardar(CHAVE_RISCADOS, proximo)
      return proximo
    })
  }, [base])

  const acao = useCallback(async (p: Pedido, qual: 'comecar' | 'pronto' | 'voltar'): Promise<boolean> => {
    if (demo) return true
    setOcupado(p.id)
    try {
      const r = await fetch('/api/admin/kds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedidoId: p.id, acao: qual }) })
      if (!r.ok) { setAviso(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? 'Não foi possível atualizar.'); return false }
      if (qual === 'pronto') notificarPedido(p.id, 'pronto')
      return true
    } catch {
      setAviso('Sem conexão. Tente de novo.')
      return false
    } finally {
      setOcupado(null)
      if (restauranteId) void recarregar(restauranteId)
    }
  }, [demo, restauranteId, recarregar])

  const destaque = useMemo(() => (destaqueId ? base.find((p) => p.id === destaqueId && p.status === 'preparando') ?? null : null), [base, destaqueId])

  if (!demo && sessao && !liberado) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div>
          <p className="text-[18px] font-semibold text-text-main">KDS em teste</p>
          <p className="mt-1 text-[13px] text-text-subtle">Disponível só nas lojas com &quot;Novidades em teste&quot;.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <QuadroKds
        colunas={colunas} agora={agora} prefs={prefs} setores={setores} setor={filtro} riscados={riscados} fichas={fichas} fotos={fotos}
        destaque={destaque} carregando={!demo && carregando} demo={!!demo} ocupado={ocupado}
        onSetor={mudarSetor} onRiscar={riscar}
        onComecar={(p) => { void acao(p, 'comecar').then((ok) => { if (ok) setDestaqueId(p.id) }) }}
        onAbrir={(p) => setDestaqueId(p.id)} onFecharDestaque={() => setDestaqueId(null)}
        onPronto={(p) => { void acao(p, 'pronto').then((ok) => { if (ok) setDestaqueId(null) }) }}
        onVoltar={(p) => { void acao(p, 'voltar') }}
        onPrefs={mudarPrefs} onSair={() => router.push('/admin/pedidos')}
        onLogout={() => { void sairDoPainel(supabase).then((ok) => { if (ok) router.replace('/login') }) }}
      />
      {aviso && <p role="status" className="fixed bottom-4 left-1/2 z-[95] -translate-x-1/2 rounded-[3px] bg-[#111827] px-4 py-2 text-[13px] font-semibold text-white shadow-lg">{aviso}</p>}
    </>
  )
}
