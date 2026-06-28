'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import {
  buscarRestauranteIdDoUsuario,
  listarGrupos,
  listarItens,
  type GrupoCardapio,
  type GrupoItemComplementos,
  type ItemCardapio,
} from '@/lib/queries/cardapio'
import type { MesaComEstado } from '@/lib/queries/comandas'
import {
  listarBordasPizza,
  listarMassasPizza,
  listarTamanhosPadraoPizza,
  type BordaPizza,
  type MassaPizza,
  type TamanhoPadraoPizza,
} from '@/lib/queries/pizza'
import { type NovoPedidoItemInput, type Pedido } from '@/lib/queries/pedidos'
import { Button } from '@/components/ui/button'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ComandaLinha {
  uid: string
  item: ItemCardapio
  quantidade: number
  tamanhoNome: string
  saborNome: string
  bordaNome: string
  massaNome: string
  complementos: string[]
  observacao: string
}

interface SeletorState {
  item: ItemCardapio
  /** For pizza: tamanho padrão nome. For simples: tamanhos_item nome. */
  tamanhoNome: string
  saborNome: string
  bordaId: string
  massaId: string
  /** grupoId → selected complement names */
  complementosSelecionados: Record<string, string[]>
  observacao: string
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function makeUid() {
  return Math.random().toString(36).slice(2)
}

function needsSelector(item: ItemCardapio): boolean {
  if (item.tipoItem === 'pizza') return true
  if (item.tamanhos.length > 0) return true
  if (item.grupos.length > 0) return true
  return false
}

function linhaDescricao(linha: ComandaLinha): string {
  const parts: string[] = []
  if (linha.tamanhoNome) parts.push(linha.tamanhoNome)
  if (linha.saborNome) parts.push(linha.saborNome)
  if (linha.bordaNome) parts.push(`Borda: ${linha.bordaNome}`)
  if (linha.massaNome) parts.push(`Massa: ${linha.massaNome}`)
  if (linha.complementos.length) parts.push(linha.complementos.join(', '))
  if (linha.observacao) parts.push(`Obs: ${linha.observacao}`)
  return parts.join(' · ')
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

/** Tempo desde que a comanda foi aberta (curto, p/ o card da mesa). */
function tempoDecorrido(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  return `${h}h${String(min % 60).padStart(2, '0')}`
}

type MesaEstadoVisual = 'livre' | 'aguardando' | 'ocupada'
/** Estado visual da mesa: livre (sem comanda), aguardando (comanda aberta sem pedido),
 * ocupada (comanda aberta com pedidos). */
function mesaEstadoVisual(mesa: MesaComEstado): MesaEstadoVisual {
  if (!mesa.comandaAberta) return 'livre'
  if (mesa.qtdPedidos === 0) return 'aguardando'
  return 'ocupada'
}

// ─── Product Selector Modal ───────────────────────────────────────────────────

function SeletorModal({
  state,
  tamanhosPizza,
  bordasPizza,
  massasPizza,
  onChange,
  onCancel,
  onConfirm,
}: {
  state: SeletorState
  tamanhosPizza: TamanhoPadraoPizza[]
  bordasPizza: BordaPizza[]
  massasPizza: MassaPizza[]
  onChange: (patch: Partial<SeletorState>) => void
  onCancel: () => void
  onConfirm: (result: Omit<ComandaLinha, 'uid' | 'item' | 'quantidade'>) => void
}) {
  const { item } = state
  const isPizza = item.tipoItem === 'pizza'
  const hasSimplesTamanhos = !isPizza && item.tamanhos.length > 0

  // Validate: can confirm?
  const pizzaReady = isPizza ? state.tamanhoNome !== '' && state.saborNome !== '' : true
  const tamanhosReady = hasSimplesTamanhos ? state.tamanhoNome !== '' : true
  const gruposReady = item.grupos
    .filter((g) => g.obrigatorio)
    .every((g) => {
      const sel = state.complementosSelecionados[g.id] ?? []
      return sel.length >= g.minEscolhas
    })
  const canConfirm = pizzaReady && tamanhosReady && gruposReady

  function handleGroupToggle(grupo: GrupoItemComplementos, compNome: string) {
    const current = state.complementosSelecionados[grupo.id] ?? []
    let next: string[]
    if (current.includes(compNome)) {
      next = current.filter((n) => n !== compNome)
    } else if (grupo.maxEscolhas === 1) {
      next = [compNome]
    } else if (grupo.maxEscolhas === 0 || current.length < grupo.maxEscolhas) {
      // maxEscolhas 0 = sem limite ("quantos quiser"), igual à vitrine do cliente.
      next = [...current, compNome]
    } else {
      next = current // atingiu o máximo — ignora
    }
    onChange({ complementosSelecionados: { ...state.complementosSelecionados, [grupo.id]: next } })
  }

  function confirm() {
    const bordaPizza = bordasPizza.find((b) => b.id === state.bordaId)
    const massaPizza = massasPizza.find((m) => m.id === state.massaId)
    const complementos: string[] = Object.values(state.complementosSelecionados).flat()
    onConfirm({
      tamanhoNome: state.tamanhoNome,
      saborNome: state.saborNome,
      bordaNome: bordaPizza?.nome ?? '',
      massaNome: massaPizza?.nome ?? '',
      complementos,
      observacao: state.observacao,
    })
  }

  const chipBase = 'rounded-menuzia border px-3 py-1.5 text-[12px] font-semibold transition-colors'
  const chipActive = 'border-primary bg-primary text-white'
  const chipIdle = 'border-border bg-white text-text-main hover:border-primary hover:text-primary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-menuzia bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-subtle">Configurar item</p>
            <h2 className="text-[15px] font-bold text-text-main">{item.nome}</h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-text-subtle transition-colors hover:bg-page hover:text-text-main"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {/* Pizza — tamanho padrão */}
          {isPizza && tamanhosPizza.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Tamanho <span className="text-danger">*</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {tamanhosPizza.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange({ tamanhoNome: t.nome })}
                    className={[chipBase, state.tamanhoNome === t.nome ? chipActive : chipIdle].join(' ')}
                  >
                    {t.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pizza — sabor */}
          {isPizza && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Sabor <span className="text-danger">*</span>
              </p>
              <div className="flex flex-col gap-1.5">
                {item.sabores
                  .filter((s) => s.status === 'disponivel')
                  .map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onChange({ saborNome: s.nome })}
                      className={[
                        'rounded-menuzia border px-3 py-2 text-left text-[13px] font-medium transition-colors',
                        state.saborNome === s.nome
                          ? 'border-primary bg-primary/5 text-primary'
                          : 'border-border bg-white text-text-main hover:border-primary/50',
                      ].join(' ')}
                    >
                      <span className="font-semibold">{s.nome}</span>
                      {s.descricao && (
                        <span className="block text-[11px] font-normal text-text-subtle">{s.descricao}</span>
                      )}
                    </button>
                  ))}
                {item.sabores.filter((s) => s.status === 'disponivel').length === 0 && (
                  <p className="text-[12px] text-text-subtle">Nenhum sabor disponível.</p>
                )}
              </div>
            </div>
          )}

          {/* Pizza — borda (opcional) */}
          {isPizza && bordasPizza.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Borda <span className="font-normal text-text-subtle/60">(opcional)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ bordaId: '' })}
                  className={[chipBase, state.bordaId === '' ? chipActive : chipIdle].join(' ')}
                >
                  Sem borda
                </button>
                {bordasPizza.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onChange({ bordaId: b.id })}
                    className={[chipBase, state.bordaId === b.id ? chipActive : chipIdle].join(' ')}
                  >
                    {b.nome}
                    {b.preco > 0 && <span className="ml-1 text-[11px] font-normal">(+{formatBRL(b.preco)})</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pizza — massa (opcional) */}
          {isPizza && massasPizza.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Massa <span className="font-normal text-text-subtle/60">(opcional)</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onChange({ massaId: '' })}
                  className={[chipBase, state.massaId === '' ? chipActive : chipIdle].join(' ')}
                >
                  Padrão
                </button>
                {massasPizza.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onChange({ massaId: m.id })}
                    className={[chipBase, state.massaId === m.id ? chipActive : chipIdle].join(' ')}
                  >
                    {m.nome}
                    {m.preco > 0 && <span className="ml-1 text-[11px] font-normal">(+{formatBRL(m.preco)})</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Simples/marmita — tamanhos_item */}
          {hasSimplesTamanhos && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                Tamanho <span className="text-danger">*</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {item.tamanhos.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChange({ tamanhoNome: t.nome })}
                    className={[chipBase, state.tamanhoNome === t.nome ? chipActive : chipIdle].join(' ')}
                  >
                    {t.nome}
                    <span className="ml-1.5 font-normal">{formatBRL(t.preco)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Complement groups */}
          {item.grupos.map((grupo) => {
            const sel = state.complementosSelecionados[grupo.id] ?? []
            return (
              <div key={grupo.id}>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
                  {grupo.nome}
                  {grupo.obrigatorio && <span className="ml-1 text-danger">*</span>}
                  <span className="ml-1 font-normal text-text-subtle/60">
                    {grupo.maxEscolhas === 1
                      ? '(escolha 1)'
                      : grupo.maxEscolhas === 0
                        ? '(quantos quiser)'
                        : `(até ${grupo.maxEscolhas})`}
                  </span>
                </p>
                <div className="flex flex-col gap-1.5">
                  {grupo.complementos.map((comp) => {
                    const isSelected = sel.includes(comp.nome)
                    return (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => handleGroupToggle(grupo, comp.nome)}
                        className={[
                          'flex items-center justify-between rounded-menuzia border px-3 py-2 text-[13px] transition-colors',
                          isSelected
                            ? 'border-primary bg-primary/5 font-semibold text-primary'
                            : 'border-border bg-white text-text-main hover:border-primary/40',
                        ].join(' ')}
                      >
                        <span>{comp.nome}</span>
                        {comp.preco > 0 && (
                          <span className="text-[12px] font-semibold text-price-text">+{formatBRL(comp.preco)}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Observação */}
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-text-subtle">
              Observação <span className="font-normal text-text-subtle/60">(opcional)</span>
            </p>
            <textarea
              value={state.observacao}
              onChange={(e) => onChange({ observacao: e.target.value })}
              rows={2}
              placeholder="Ex: sem cebola, ponto da carne…"
              className="w-full resize-none rounded-menuzia border border-border bg-white px-3 py-2 text-[13px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!canConfirm} onClick={confirm}>
            Adicionar à comanda
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── PDV Page ─────────────────────────────────────────────────────────────────

export default function PdvPage() {
  const supabase = useMemo(() => getBrowserSupabase(), [])

  // ── Data ──────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [itens, setItens] = useState<ItemCardapio[]>([])
  const [grupos, setGrupos] = useState<GrupoCardapio[]>([])
  const [mesasEstado, setMesasEstado] = useState<MesaComEstado[]>([])
  const [tamanhosPizza, setTamanhosPizza] = useState<TamanhoPadraoPizza[]>([])
  const [bordasPizza, setBordasPizza] = useState<BordaPizza[]>([])
  const [massasPizza, setMassasPizza] = useState<MassaPizza[]>([])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)

  // ── Mesa / cliente ─────────────────────────────────────────────────────────
  const [mesaSelecionada, setMesaSelecionada] = useState<MesaComEstado | null>(null)
  // Ref kept in sync so the realtime callback can read the current mesa
  // without being listed in the channel effect's deps (avoids re-subscribing on every mesa click).
  const mesaSelecionadaRef = useRef<MesaComEstado | null>(null)
  useEffect(() => { mesaSelecionadaRef.current = mesaSelecionada }, [mesaSelecionada])
  const [mesaEscolhida, setMesaEscolhida] = useState(false)
  const [nomeCliente, setNomeCliente] = useState('')

  // ── Cardápio filters ───────────────────────────────────────────────────────
  const [busca, setBusca] = useState('')
  const [grupoFiltro, setGrupoFiltro] = useState<string | null>(null)

  // ── Comanda da mesa (pedidos já lançados) ─────────────────────────────────
  const [pedidosComanda, setPedidosComanda] = useState<Pedido[]>([])
  const [carregandoComanda, setCarregandoComanda] = useState(false)
  const [fechando, setFechando] = useState(false)

  // ── Comanda em montagem ────────────────────────────────────────────────────
  const [comanda, setComanda] = useState<ComandaLinha[]>([])

  // ── Selector modal ────────────────────────────────────────────────────────
  const [seletor, setSeletor] = useState<SeletorState | null>(null)

  // ── Launch ────────────────────────────────────────────────────────────────
  const [launching, setLaunching] = useState(false)
  const [launchMsg, setLaunchMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  // ── Mobile tab ────────────────────────────────────────────────────────────
  const [mobileTab, setMobileTab] = useState<'mesas' | 'cardapio' | 'comanda'>('cardapio')

  // ── Fetch mesas com estado de ocupação ────────────────────────────────────
  const recarregarMesas = useCallback(async () => {
    const res = await fetch('/api/admin/pdv/comanda')
    if (!res.ok) return
    const data = (await res.json()) as { mesas: MesaComEstado[] }
    setMesasEstado(data.mesas)
  }, [])

  // ── Focus mode: hide sidebar while PDV is open ────────────────────────────
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: true }))
    return () => {
      window.dispatchEvent(new CustomEvent('menuzia:focus-mode', { detail: false }))
    }
  }, [])

  // ── Load data ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setLoadError(null)
      try {
        const rid = await buscarRestauranteIdDoUsuario(supabase)
        if (!rid || cancelled) return

        const [itensData, gruposData, tamanhosData, bordasData, massasData] = await Promise.all([
          listarItens(supabase, rid),
          listarGrupos(supabase, rid),
          listarTamanhosPadraoPizza(supabase, rid),
          listarBordasPizza(supabase, rid),
          listarMassasPizza(supabase, rid),
        ])
        if (cancelled) return

        setItens(itensData.filter((i) => i.status === 'disponivel'))
        setGrupos(gruposData)
        setTamanhosPizza(tamanhosData)
        setBordasPizza(bordasData)
        setMassasPizza(massasData)
        setRestauranteId(rid)
        await recarregarMesas()
      } catch {
        if (!cancelled) setLoadError('Não foi possível carregar os dados. Recarregue a página.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, recarregarMesas])

  // ── Fetch pedidos da comanda aberta ───────────────────────────────────────
  const recarregarComanda = useCallback(async (comandaId: string) => {
    setCarregandoComanda(true)
    try {
      const res = await fetch(`/api/admin/pdv/comanda?comandaId=${comandaId}`)
      if (!res.ok) return
      const data = (await res.json()) as { pedidos: Pedido[] }
      setPedidosComanda(data.pedidos)
    } finally {
      setCarregandoComanda(false)
    }
  }, [])

  // Carrega pedidos ao selecionar mesa ocupada
  useEffect(() => {
    const comandaId = mesaSelecionada?.comandaAberta?.id
    if (comandaId) {
      void recarregarComanda(comandaId)
    } else {
      setPedidosComanda([])
    }
  }, [mesaSelecionada, recarregarComanda])

  // ── Realtime: atualizar estado ao mudar pedidos ────────────────────────────
  useEffect(() => {
    if (!restauranteId) return
    const channel = supabase
      .channel(`pdv-comandas-${restauranteId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pedidos', filter: `restaurante_id=eq.${restauranteId}` },
        () => {
          void recarregarMesas()
          const comandaId = mesaSelecionadaRef.current?.comandaAberta?.id
          if (comandaId) void recarregarComanda(comandaId)
        }
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [supabase, recarregarMesas, recarregarComanda, restauranteId])

  // ── Filtered items ─────────────────────────────────────────────────────────
  const itensFiltrados = useMemo(() => {
    let list = itens
    if (grupoFiltro) list = list.filter((i) => i.grupoId === grupoFiltro)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      list = list.filter((i) => i.nome.toLowerCase().includes(q) || i.descricao.toLowerCase().includes(q))
    }
    return list
  }, [itens, grupoFiltro, busca])

  // ── Mesa selection ─────────────────────────────────────────────────────────
  function selecionarMesa(mesa: MesaComEstado | null) {
    setMesaSelecionada(mesa)
    setMesaEscolhida(true)
    if (window.innerWidth < 1024) setMobileTab('cardapio')
  }

  // ── Add item to comanda ────────────────────────────────────────────────────
  function addItem(item: ItemCardapio) {
    if (needsSelector(item)) {
      setSeletor({
        item,
        tamanhoNome: '',
        saborNome: '',
        bordaId: '',
        massaId: '',
        complementosSelecionados: {},
        observacao: '',
      })
      return
    }
    // No selector needed — add or increment
    setComanda((prev) => {
      const existing = prev.find(
        (l) => l.item.id === item.id && !l.tamanhoNome && !l.saborNome && l.complementos.length === 0
      )
      if (existing) {
        return prev.map((l) => (l.uid === existing.uid ? { ...l, quantidade: l.quantidade + 1 } : l))
      }
      return [
        ...prev,
        {
          uid: makeUid(),
          item,
          quantidade: 1,
          tamanhoNome: '',
          saborNome: '',
          bordaNome: '',
          massaNome: '',
          complementos: [],
          observacao: '',
        },
      ]
    })
  }

  function confirmarSeletor(result: Omit<ComandaLinha, 'uid' | 'item' | 'quantidade'>) {
    if (!seletor) return
    setComanda((prev) => [...prev, { uid: makeUid(), item: seletor.item, quantidade: 1, ...result }])
    setSeletor(null)
  }

  function alterarQtd(uidTarget: string, delta: number) {
    setComanda((prev) =>
      prev
        .map((l) => (l.uid === uidTarget ? { ...l, quantidade: l.quantidade + delta } : l))
        .filter((l) => l.quantidade > 0)
    )
  }

  function removerLinha(uidTarget: string) {
    setComanda((prev) => prev.filter((l) => l.uid !== uidTarget))
  }

  // ── Cancelar pedido da comanda ─────────────────────────────────────────────
  async function cancelarPedido(pedidoId: string) {
    if (!confirm('Cancelar este pedido? Ele some da cozinha e sai da conta.')) return
    const res = await fetch(`/api/admin/pdv/pedido/${pedidoId}/cancelar`, { method: 'POST' })
    if (res.ok) {
      const comandaId = mesaSelecionada?.comandaAberta?.id
      if (comandaId) await recarregarComanda(comandaId)
      await recarregarMesas()
    }
  }

  // ── Fechar conta da mesa ───────────────────────────────────────────────────
  async function fecharConta() {
    const comandaId = mesaSelecionada?.comandaAberta?.id
    if (!comandaId || fechando) return
    const emPreparo = pedidosComanda.some((p) => p.status === 'preparando' || p.status === 'recebido')
    const aviso = emPreparo
      ? 'Há pedido ainda em preparo. Fechar a conta mesmo assim?'
      : `Fechar a conta de ${mesaSelecionada?.nome ?? 'mesa'}?`
    if (!confirm(aviso)) return
    setFechando(true)
    try {
      const res = await fetch(`/api/admin/pdv/comanda/${comandaId}/fechar`, { method: 'POST' })
      if (res.ok) {
        setPedidosComanda([])
        setMesaSelecionada(null)
        setMesaEscolhida(false)
        await recarregarMesas()
      }
    } finally {
      setFechando(false)
    }
  }

  // ── Launch ─────────────────────────────────────────────────────────────────
  async function lancarNaCozinha() {
    if (!mesaEscolhida || comanda.length === 0 || launching) return
    setLaunching(true)
    setLaunchMsg(null)

    const itensBody: NovoPedidoItemInput[] = comanda.map((linha) => ({
      itemId: linha.item.id,
      quantidade: linha.quantidade,
      observacao: linha.observacao,
      complementos: linha.complementos,
      tamanhoNome: linha.tamanhoNome || undefined,
      saborNome: linha.saborNome || undefined,
      bordaNome: linha.bordaNome || undefined,
      massaNome: linha.massaNome || undefined,
    }))

    const body = {
      tipo: 'retirada' as const,
      origem: 'pdv' as const,
      mesa: mesaSelecionada?.nome,
      mesaId: mesaSelecionada?.id,
      cliente: { nome: nomeCliente.trim() || 'Cliente Balcão', telefone: '' },
      endereco: { rua: '', numero: '', complemento: '', bairro: '', cep: '' },
      pagamento: 'dinheiro' as const,
      trocoPara: null,
      itens: itensBody,
    }

    try {
      const res = await fetch('/api/admin/pdv/pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = (await res.json()) as { id?: string; numero?: number; error?: string }
      if (res.status === 201 && data.numero) {
        const local = mesaSelecionada?.nome ?? 'Balcão'
        const mesaIdAntes = mesaSelecionada?.id
        setComanda([])
        setNomeCliente('')
        setLaunchMsg({ type: 'ok', text: `Pedido #${data.numero} lançado em ${local}!` })
        // Recarregar mesas + re-selecionar a mesa atualizada (agora ocupada)
        const atualizadas = await fetch('/api/admin/pdv/comanda')
          .then((r) => r.json() as Promise<{ mesas: MesaComEstado[] }>)
          .catch(() => null)
        setMesasEstado(atualizadas?.mesas ?? [])
        if (mesaIdAntes && atualizadas?.mesas) {
          const nova = atualizadas.mesas.find((m) => m.id === mesaIdAntes)
          if (nova) {
            setMesaSelecionada(nova)
            if (nova.comandaAberta) await recarregarComanda(nova.comandaAberta.id)
          }
        }
      } else {
        setLaunchMsg({ type: 'err', text: data.error ?? 'Erro ao lançar pedido.' })
      }
    } catch {
      setLaunchMsg({ type: 'err', text: 'Erro de conexão. Tente novamente.' })
    } finally {
      setLaunching(false)
    }
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  const totalConta = pedidosComanda
    .filter((p) => p.status !== 'cancelado')
    .reduce((s, p) => s + p.total, 0)

  const subtotal = comanda.reduce((s, l) => {
    // Use base price as reference; server recalculates the real total
    return s + (l.item.promocaoPreco ?? l.item.preco) * l.quantidade
  }, 0)

  // ── Loading / error states ─────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <div className="text-center">
          <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-[3px] border-border border-t-primary" />
          <p className="text-[13px] text-text-subtle">Carregando PDV…</p>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-full items-center justify-center bg-page p-6">
        <div className="w-full max-w-xs rounded-menuzia border border-danger-bg bg-white p-6 text-center">
          <p className="text-[14px] text-danger">{loadError}</p>
          <Button className="mt-4 w-full" onClick={() => window.location.reload()}>
            Recarregar
          </Button>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Product selector modal */}
      {seletor && (
        <SeletorModal
          state={seletor}
          tamanhosPizza={tamanhosPizza}
          bordasPizza={bordasPizza}
          massasPizza={massasPizza}
          onChange={(patch) => setSeletor((prev) => (prev ? { ...prev, ...patch } : prev))}
          onCancel={() => setSeletor(null)}
          onConfirm={confirmarSeletor}
        />
      )}

      <div className="flex h-full flex-col overflow-hidden bg-page">
        {/* Mobile tab bar */}
        <div className="flex border-b border-border bg-white lg:hidden">
          {(['mesas', 'cardapio', 'comanda'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setMobileTab(tab)}
              className={[
                'flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
                mobileTab === tab
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-text-subtle hover:text-text-main',
              ].join(' ')}
            >
              {tab === 'mesas'
                ? 'Mesas'
                : tab === 'cardapio'
                  ? 'Cardápio'
                  : `Comanda${comanda.length > 0 ? ` (${comanda.length})` : ''}`}
            </button>
          ))}
        </div>

        {/* 3-column layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Column 1: Mesa / local ───────────────────────────────────────── */}
          <aside
            className={[
              'flex flex-col border-r border-border bg-white lg:w-[220px] lg:flex-shrink-0',
              mobileTab === 'mesas' ? 'flex flex-1' : 'hidden lg:flex',
            ].join(' ')}
          >
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Mesa / Local</p>
            </div>

            {/* Legenda de status */}
            {mesasEstado.length > 0 && (
              <div className="flex items-center gap-3 border-b border-border bg-page/50 px-3 py-1.5">
                {([
                  ['bg-status-ready', 'Livre'],
                  ['bg-primary', 'Ocupada'],
                  ['bg-warn', 'Aguard.'],
                ] as const).map(([dot, lbl]) => (
                  <span key={lbl} className="flex items-center gap-1">
                    <span className={['h-2 w-2 rounded-full', dot].join(' ')} />
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-text-subtle">{lbl}</span>
                  </span>
                ))}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3">
              {/* Balcão */}
              <button
                type="button"
                onClick={() => selecionarMesa(null)}
                className={[
                  'mb-3 w-full rounded-menuzia border-2 py-2.5 text-[13px] font-semibold transition-all active:scale-[0.98]',
                  mesaEscolhida && mesaSelecionada === null
                    ? 'border-primary bg-primary text-white'
                    : 'border-border bg-page text-text-main hover:border-primary hover:text-primary',
                ].join(' ')}
              >
                Balcão
              </button>

              {mesasEstado.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {mesasEstado.map((mesa) => {
                    const estado = mesaEstadoVisual(mesa)
                    const ativa = mesaEscolhida && mesaSelecionada?.id === mesa.id
                    const estiloEstado = {
                      livre: 'border-status-ready/45 bg-status-ready/5',
                      aguardando: 'border-warn/55 bg-warn/10',
                      ocupada: 'border-primary/45 bg-primary/5',
                    }[estado]
                    const dotEstado = {
                      livre: 'bg-status-ready',
                      aguardando: 'bg-warn',
                      ocupada: 'bg-primary',
                    }[estado]
                    const labelEstado = { livre: 'Livre', aguardando: 'Aguardando', ocupada: 'Ocupada' }[estado]
                    return (
                      <button
                        key={mesa.id}
                        type="button"
                        onClick={() => selecionarMesa(mesa)}
                        className={[
                          'flex aspect-square flex-col rounded-menuzia border-2 p-2 text-left transition-all active:scale-[0.97]',
                          ativa ? 'ring-2 ring-primary ring-offset-1' : '',
                          estiloEstado,
                        ].join(' ')}
                      >
                        <div className="flex items-center gap-1">
                          <span className={['h-2 w-2 flex-shrink-0 rounded-full', dotEstado].join(' ')} />
                          <span className="truncate text-[9px] font-bold uppercase tracking-wide text-text-subtle">
                            {labelEstado}
                          </span>
                        </div>
                        <span className="mt-1 text-[16px] font-bold leading-none text-text-main">{mesa.nome}</span>
                        <div className="mt-auto">
                          {mesa.comandaAberta ? (
                            <>
                              <span className="block text-[13px] font-bold text-text-main">{formatBRL(mesa.total)}</span>
                              <span className="block truncate text-[10px] text-text-subtle">
                                {mesa.qtdPedidos} ped · {tempoDecorrido(mesa.comandaAberta.abertaEm)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] text-text-subtle/60">Toque p/ abrir</span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {mesasEstado.length === 0 && (
                <p className="mt-2 text-center text-[12px] text-text-subtle/70">Sem mesas cadastradas.</p>
              )}
            </div>

            {/* Customer name */}
            <div className="border-t border-border p-3">
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-text-subtle">
                Cliente <span className="font-normal">(opcional)</span>
              </p>
              <input
                type="text"
                value={nomeCliente}
                onChange={(e) => setNomeCliente(e.target.value)}
                placeholder="Nome do cliente"
                className="w-full rounded-menuzia border border-border bg-white px-2.5 py-1.5 text-[13px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </aside>

          {/* ── Column 2: Cardápio ──────────────────────────────────────────── */}
          <section
            className={[
              'flex flex-col overflow-hidden lg:flex-1',
              mobileTab === 'cardapio' ? 'flex flex-1' : 'hidden lg:flex',
            ].join(' ')}
          >
            {/* Search + category chips */}
            <div className="border-b border-border bg-white px-3 py-2.5 space-y-2">
              <input
                type="text"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value)
                  setGrupoFiltro(null)
                }}
                placeholder="Buscar item…"
                className="w-full rounded-menuzia border border-border bg-white px-3 py-1.5 text-[13px] text-text-main placeholder:text-text-subtle/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  onClick={() => { setGrupoFiltro(null); setBusca('') }}
                  className={[
                    'flex-shrink-0 rounded-menuzia border px-4 py-2.5 text-[13px] font-semibold transition-colors',
                    grupoFiltro === null && !busca
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-white text-text-subtle hover:border-primary hover:text-primary',
                  ].join(' ')}
                >
                  Todos
                </button>
                {grupos.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setGrupoFiltro(g.id); setBusca('') }}
                    className={[
                      'flex-shrink-0 rounded-menuzia border px-4 py-2.5 text-[13px] font-semibold transition-colors',
                      grupoFiltro === g.id
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-white text-text-subtle hover:border-primary hover:text-primary',
                    ].join(' ')}
                  >
                    {g.nome}
                  </button>
                ))}
              </div>
            </div>

            {/* Items grid */}
            <div className="flex-1 overflow-y-auto p-3">
              {itensFiltrados.length === 0 ? (
                <div className="py-16 text-center text-[13px] text-text-subtle">
                  {busca || grupoFiltro ? 'Nenhum item encontrado.' : 'Cardápio vazio.'}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {itensFiltrados.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => addItem(item)}
                      className="group flex flex-col overflow-hidden rounded-menuzia border border-border bg-white text-left transition-all hover:border-primary hover:shadow-md active:scale-[0.98]"
                    >
                      {item.imagemUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imagemUrl}
                          alt={item.nome}
                          className="h-32 w-full bg-page object-contain"
                        />
                      ) : (
                        <div className="flex h-32 w-full items-center justify-center bg-page text-text-subtle/25">
                          <svg viewBox="0 0 24 24" className="h-10 w-10 fill-current">
                            <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                          </svg>
                        </div>
                      )}
                      <div className="flex flex-1 flex-col p-3">
                        <p className="line-clamp-2 text-[14px] font-semibold leading-tight text-text-main group-hover:text-primary">
                          {item.nome}
                        </p>
                        {item.descricao && (
                          <p className="mt-1 line-clamp-1 text-[12px] leading-tight text-text-subtle">
                            {item.descricao}
                          </p>
                        )}
                        <div className="mt-auto flex items-center justify-between pt-2">
                          <span
                            className={
                              item.promocaoPreco !== null
                                ? 'text-[15px] font-bold text-price-text'
                                : 'text-[15px] font-bold text-text-main'
                            }
                          >
                            {item.tamanhos.length > 0 && !item.promocaoPreco ? 'a partir de ' : ''}
                            {formatBRL(item.promocaoPreco ?? item.preco)}
                          </span>
                          {(item.tipoItem === 'pizza' || item.tamanhos.length > 0 || item.grupos.some((g) => g.obrigatorio)) && (
                            <span className="rounded-menuzia bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              config
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* ── Column 3: Comanda ───────────────────────────────────────────── */}
          <aside
            className={[
              'flex flex-col border-l border-border bg-white lg:w-[300px] lg:flex-shrink-0',
              mobileTab === 'comanda' ? 'flex flex-1' : 'hidden lg:flex',
            ].join(' ')}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Comanda</p>
              {mesaEscolhida && (
                <span className="text-[11px] font-semibold text-primary">
                  {mesaSelecionada?.nome ?? 'Balcão'}
                </span>
              )}
            </div>

            {/* Launch feedback */}
            {launchMsg && (
              <div
                className={[
                  'mx-3 mt-3 rounded-menuzia px-3 py-2 text-[12px] font-semibold',
                  launchMsg.type === 'ok' ? 'bg-price-bg text-price-text' : 'bg-danger-bg text-danger',
                ].join(' ')}
              >
                {launchMsg.text}
              </div>
            )}

            {/* Conta da mesa — pedidos já lançados */}
            {mesaSelecionada?.comandaAberta && (
              <div className="border-b border-border">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-text-subtle">Conta da mesa</p>
                  <span className="text-[12px] font-bold text-text-main">{formatBRL(totalConta)}</span>
                </div>
                {carregandoComanda ? (
                  <p className="px-3 pb-2.5 text-[11px] text-text-subtle/60">Carregando…</p>
                ) : (
                  <ul className="max-h-52 divide-y divide-border overflow-y-auto">
                    {pedidosComanda.map((p) => {
                      const cancelado = p.status === 'cancelado'
                      return (
                        <li
                          key={p.id}
                          className={['px-3 py-2', cancelado ? 'opacity-50' : ''].join(' ')}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={[
                                'text-[12px] font-semibold text-text-main',
                                cancelado ? 'line-through' : '',
                              ].join(' ')}
                            >
                              Pedido #{p.numero}
                            </span>
                            <span
                              className={[
                                'text-[12px] font-semibold text-text-main',
                                cancelado ? 'line-through' : '',
                              ].join(' ')}
                            >
                              {formatBRL(p.total)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-[11px] text-text-subtle">
                            {p.itens.map((i) => `${i.quantidade}× ${i.nome}`).join(', ')}
                          </p>
                          {!cancelado && (
                            <button
                              type="button"
                              onClick={() => void cancelarPedido(p.id)}
                              className="mt-1 text-[11px] font-semibold text-danger hover:underline"
                            >
                              Cancelar pedido
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
                <div className="p-3">
                  <Button
                    variant="outline"
                    className="w-full"
                    disabled={!mesaSelecionada?.comandaAberta || fechando}
                    onClick={() => void fecharConta()}
                  >
                    {fechando ? 'Fechando…' : 'Fechar conta'}
                  </Button>
                </div>
              </div>
            )}

            {/* Order lines */}
            <div className="flex-1 overflow-y-auto">
              {comanda.length === 0 ? (
                <div className="flex h-full items-center justify-center p-6 text-center">
                  <div>
                    <svg viewBox="0 0 24 24" className="mx-auto mb-3 h-8 w-8 fill-text-subtle/30">
                      <path d="M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94A5.01 5.01 0 0 0 11 14.9V17H9v2h6v-2h-2v-2.1a5.01 5.01 0 0 0 3.61-2.96C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zm-15 3V7h2v3.82C4.84 10.4 4 9.3 4 8zm7 5c-1.65 0-3-1.35-3-3V5h6v5c0 1.65-1.35 3-3 3zm8-5c0 1.3-.84 2.4-2 2.82V7h2v1z" />
                    </svg>
                    <p className="text-[13px] font-medium text-text-subtle">Comanda vazia</p>
                    <p className="mt-0.5 text-[11px] text-text-subtle/60">Toque nos itens do cardápio.</p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {comanda.map((linha) => {
                    const descricao = linhaDescricao(linha)
                    const precoRef = (linha.item.promocaoPreco ?? linha.item.preco) * linha.quantidade
                    return (
                      <li key={linha.uid} className="flex gap-2.5 px-3 py-3">
                        {linha.item.imagemUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={linha.item.imagemUrl}
                            alt={linha.item.nome}
                            className="h-14 w-14 flex-shrink-0 rounded-menuzia bg-page object-contain"
                          />
                        ) : (
                          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-menuzia bg-page text-text-subtle/25">
                            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current">
                              <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z" />
                            </svg>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-[13px] font-semibold leading-tight text-text-main">
                              {linha.item.nome}
                            </p>
                            <span className="flex-shrink-0 text-[13px] font-bold text-text-main">
                              {formatBRL(precoRef)}
                            </span>
                          </div>
                          {descricao && (
                            <p className="mt-0.5 line-clamp-2 text-[11px] leading-tight text-text-subtle">
                              {descricao}
                            </p>
                          )}
                          <div className="mt-2 flex items-center gap-1.5">
                            <button
                              type="button"
                              aria-label="Diminuir quantidade"
                              onClick={() => alterarQtd(linha.uid, -1)}
                              className="flex h-8 w-8 items-center justify-center rounded-menuzia border border-border text-text-subtle transition-colors hover:border-danger hover:text-danger"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                <path d="M19 13H5v-2h14v2z" />
                              </svg>
                            </button>
                            <span className="w-7 text-center text-[14px] font-bold text-text-main">
                              {linha.quantidade}
                            </span>
                            <button
                              type="button"
                              aria-label="Aumentar quantidade"
                              onClick={() => alterarQtd(linha.uid, 1)}
                              className="flex h-8 w-8 items-center justify-center rounded-menuzia border border-border text-text-subtle transition-colors hover:border-primary hover:text-primary"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              aria-label="Remover item"
                              onClick={() => removerLinha(linha.uid)}
                              className="ml-auto flex h-8 w-8 items-center justify-center rounded-menuzia border border-transparent text-text-subtle/40 transition-colors hover:border-danger hover:text-danger"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current">
                                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Footer: subtotal + launch */}
            <div className="space-y-2.5 border-t border-border p-3">
              {comanda.length > 0 && (
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-text-subtle">Subtotal (ref.)</span>
                  <span className="font-semibold text-text-main">{formatBRL(subtotal)}</span>
                </div>
              )}
              {!mesaEscolhida && (
                <p className="text-center text-[11px] text-status-pending">
                  Selecione uma mesa ou Balcão.
                </p>
              )}
              <Button
                className="w-full py-2.5"
                variant="success"
                disabled={!mesaEscolhida || comanda.length === 0 || launching}
                onClick={lancarNaCozinha}
              >
                {launching ? 'Lançando…' : 'Lançar na cozinha'}
              </Button>
            </div>
          </aside>
        </div>
      </div>
    </>
  )
}
