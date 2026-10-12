'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import { useEstadoSessao } from '@/lib/sessao-cliente'
import { buscarRestauranteIdDoUsuario } from '@/lib/queries/cardapio'
import { avancarStatusPedido, corteLiberacaoAgendados, listarPedidosKanban, type Pedido } from '@/lib/queries/pedidos'
import { notificarPedido } from '@/lib/notificar'
import { filtrarPorSetor, lerLimites, pedidosDaCozinha, pedidosDemo, setoresDosPedidos, SETORES_DEMO, type CenarioDemo } from '@/lib/kds'
import { QuadroKds, type PreferenciasKds } from '@/components/admin/kds/quadro-kds'

/**
 * KDS — tela da cozinha (PRÉVIA, 12/10/2026). Só nas lojas com "Novidades em teste" (hoje, a Menuzia). Mesmo canal de tempo
 * real do Kanban (pedidos da loja), com a mesma rede de segurança lenta; "Pronto" move para "Pronto p/ Despacho" do Kanban.
 * Não mexe na impressão. `?demo=novo|atrasado|varios` mostra pedidos fictícios (prints), sem ler nem gravar nada.
 */
const CHAVE_PREFS = 'menuzia:kds-prefs'
const CHAVE_RISCADOS = 'menuzia:kds-riscados'

function lerPrefs(): PreferenciasKds {
  try {
    const j = JSON.parse(localStorage.getItem(CHAVE_PREFS) ?? '{}') as { escuro?: boolean; grande?: boolean; limites?: unknown }
    return { escuro: j.escuro !== false, grande: j.grande === true, limites: lerLimites(JSON.stringify(j.limites ?? null)) }
  } catch {
    return { escuro: true, grande: false, limites: lerLimites(null) }
  }
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
  const liberaMin = useRef(30)
  const seq = useRef(0)
  const liberado = demo !== undefined || sessao?.novidades === true

  // Preferências e itens riscados ficam no aparelho (cada TV/tablet tem a sua).
  useEffect(() => {
    setPrefs(lerPrefs())
    try { setRiscados(JSON.parse(localStorage.getItem(CHAVE_RISCADOS) ?? '{}')) } catch { /* vazio */ }
  }, [])
  const mudarPrefs = useCallback((p: PreferenciasKds) => {
    setPrefs(p)
    try { localStorage.setItem(CHAVE_PREFS, JSON.stringify(p)) } catch { /* aparelho sem armazenamento */ }
  }, [])

  // Cronômetro: um relógio só para a tela toda, a cada segundo (só estado local; nenhuma chamada).
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t) }, [])

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

  // Mesmo canal do Kanban: evento do banco → relê. Poll só como rede de segurança (lento com o canal saudável).
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

  // Setor = categoria do cardápio do item. Busca só os itens que ainda não conhece (uma vez por item).
  const idsItens = useMemo(() => [...new Set(pedidos.flatMap((p) => p.itens.map((i) => i.itemId).filter(Boolean) as string[]))].sort().join(','), [pedidos])
  useEffect(() => {
    if (demo || !idsItens) return
    const faltam = idsItens.split(',').filter((id) => !setorDoItem.has(id))
    if (!faltam.length) return
    let vivo = true
    void supabase.from('itens_cardapio').select('id, grupos_cardapio(nome)').in('id', faltam).then(({ data }) => {
      if (!vivo || !data) return
      setSetorDoItem((antes) => {
        const novo = new Map(antes)
        for (const r of data as { id: string; grupos_cardapio: { nome: string } | { nome: string }[] | null }[]) {
          const g = Array.isArray(r.grupos_cardapio) ? r.grupos_cardapio[0] : r.grupos_cardapio
          novo.set(r.id, g?.nome ?? '')
        }
        return novo
      })
    })
    return () => { vivo = false }
  }, [idsItens, demo, supabase, setorDoItem])

  const base = useMemo(() => (demo ? pedidosDemo(demo, Date.now()) : pedidos), [demo, pedidos])
  const mapaSetor = demo ? SETORES_DEMO : setorDoItem
  const daCozinha = useMemo(() => pedidosDaCozinha(base, new Date(), liberaMin.current), [base])
  const setores = useMemo(() => setoresDosPedidos(daCozinha, mapaSetor), [daCozinha, mapaSetor])
  const visiveis = useMemo(() => filtrarPorSetor(daCozinha, mapaSetor, setor && setores.includes(setor) ? setor : null), [daCozinha, mapaSetor, setor, setores])

  // Riscados: guarda só os dos pedidos que ainda estão na tela.
  const riscar = useCallback((pedidoId: string, itemId: string) => {
    setRiscados((antes) => {
      const lista = antes[pedidoId] ?? []
      const proximo = { ...antes, [pedidoId]: lista.includes(itemId) ? lista.filter((x) => x !== itemId) : [...lista, itemId] }
      const ativos = new Set(daCozinha.map((p) => p.id))
      for (const k of Object.keys(proximo)) if (!ativos.has(k)) delete proximo[k]
      try { localStorage.setItem(CHAVE_RISCADOS, JSON.stringify(proximo)) } catch { /* sem armazenamento */ }
      return proximo
    })
  }, [daCozinha])

  const pronto = useCallback(async (p: Pedido) => {
    if (demo) return
    setPedidos((antes) => antes.map((o) => (o.id === p.id ? { ...o, status: 'pronto' } : o)))
    try {
      // Compare-and-set com o status que o card mostrava (igual ao Kanban): quem mexeu antes vence.
      await avancarStatusPedido(supabase, p.id, 'pronto', p.status)
      notificarPedido(p.id, 'pronto')
    } catch {
      if (restauranteId) void recarregar(restauranteId)
    }
  }, [demo, supabase, restauranteId, recarregar])

  if (!demo && sessao && !liberado) {
    return (
      <div className="grid min-h-[60vh] place-items-center p-6 text-center">
        <div>
          <p className="text-[18px] font-semibold text-text-main">Tela da cozinha (KDS) em teste</p>
          <p className="mt-1 text-[13px] text-text-subtle">Disponível só nas lojas com &quot;Novidades em teste&quot;.</p>
        </div>
      </div>
    )
  }

  return (
    <QuadroKds
      pedidos={visiveis} agora={agora} prefs={prefs} setores={setores} setor={setor} riscados={riscados}
      carregando={!demo && carregando} demo={!!demo}
      onSetor={setSetor} onRiscar={riscar} onPronto={(p) => void pronto(p)} onPrefs={mudarPrefs} onSair={() => router.push('/admin/pedidos')}
    />
  )
}
