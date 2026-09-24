'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Minus, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { grupoEstaAtivoAgora, itemDisponivelHoje } from '@/lib/timezone'
import { precoDeVitrine } from '@/lib/garcom-catalogo'
import { mensagemErroCardapio } from '@/lib/nomes-catalogo'
import {
  adicionarOrderBump,
  atualizarOrderBumpMax,
  buscarOrderBumpConfig,
  listarOrderBumps,
  removerOrderBump,
  reordenarOrderBumps,
  toggleOrderBumpAtivo,
  type GrupoCardapio,
  type ItemCardapio,
  type OrderBumpEntry,
} from '@/lib/queries/cardapio'
import { Aviso, BotaoIcone, CabecalhoSecao, CartaoPainel, Chave, CLASSE_CAMPO, FaixaErro, ItemThumb, Vazio, brl } from './ui'

const MAX_SUGESTOES = 8

/** Por que o produto sugerido não aparece para o cliente agora — null = aparece. */
export function motivoIndisponivelAgora(item: ItemCardapio, grupos: Map<string, GrupoCardapio>): string | null {
  if (item.status === 'pausado') return 'Item pausado'
  if (item.status === 'esgotado') return 'Item esgotado'
  if (!item.disponivelDelivery) return 'Fora do delivery'
  if (!itemDisponivelHoje(item.diasDisponiveis)) return 'Não vende hoje'
  const grupo = item.grupoId ? grupos.get(item.grupoId) : undefined
  if (grupo && !grupoEstaAtivoAgora(grupo)) return 'Categoria fora do horário'
  return null
}

function PrecoItem({ item }: { item: ItemCardapio }) {
  const p = precoDeVitrine(item)
  return (
    <span className="text-[11.5px] text-[var(--adm-texto-suave)]">
      {p.aPartirDe ? 'a partir de ' : ''}
      {brl(p.valor)}
    </span>
  )
}

/**
 * Aba "Peça também" (antes "Order Bump"): produtos sugeridos no carrinho da
 * vitrine. O nome mudou só na tela — tabela, rota e comportamento são os mesmos.
 */
export function PecaTambem({ restauranteId, itens, grupos }: { restauranteId: string; itens: ItemCardapio[]; grupos: GrupoCardapio[] }) {
  const supabase = useMemo(() => getBrowserSupabase(), [])
  const [sugestoes, setSugestoes] = useState<OrderBumpEntry[]>([])
  const [limite, setLimite] = useState(4)
  const [carregando, setCarregando] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [ocupado, setOcupado] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    Promise.all([listarOrderBumps(supabase, restauranteId), buscarOrderBumpConfig(supabase, restauranteId)])
      .then(([lista, cfg]) => {
        if (cancelado) return
        setSugestoes(lista)
        setLimite(cfg.max)
      })
      .catch(() => !cancelado && setErro('Não foi possível carregar as sugestões. Recarregue a página.'))
      .finally(() => !cancelado && setCarregando(false))
    return () => {
      cancelado = true
    }
  }, [supabase, restauranteId])

  const mapaGrupos = useMemo(() => new Map(grupos.map((g) => [g.id, g])), [grupos])
  const porId = useMemo(() => new Map(itens.map((i) => [i.id, i])), [itens])
  const jaSugeridos = useMemo(() => new Set(sugestoes.map((b) => b.itemId)), [sugestoes])
  const disponiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return itens
      .filter((i) => !jaSugeridos.has(i.id))
      .filter((i) => !termo || i.nome.toLowerCase().includes(termo) || (mapaGrupos.get(i.grupoId ?? '')?.nome ?? '').toLowerCase().includes(termo))
  }, [itens, jaSugeridos, busca, mapaGrupos])

  async function tentar(chave: string, acao: () => Promise<void>, padrao: string) {
    setOcupado(chave)
    setErro(null)
    try {
      await acao()
    } catch (e) {
      setErro(mensagemErroCardapio(e, padrao))
    } finally {
      setOcupado(null)
    }
  }

  const adicionar = (item: ItemCardapio) =>
    tentar(item.id, async () => {
      const nova = await adicionarOrderBump(supabase, restauranteId, item.id, sugestoes.length)
      setSugestoes((prev) => [...prev, nova])
    }, 'Não foi possível adicionar o produto.')

  const remover = (b: OrderBumpEntry) =>
    tentar(b.id, async () => {
      await removerOrderBump(supabase, b.id)
      setSugestoes((prev) => prev.filter((x) => x.id !== b.id).map((x, i) => ({ ...x, posicao: i })))
    }, 'Não foi possível remover o produto.')

  const alternar = (b: OrderBumpEntry) =>
    tentar(b.id, async () => {
      await toggleOrderBumpAtivo(supabase, b.id, !b.ativo)
      setSugestoes((prev) => prev.map((x) => (x.id === b.id ? { ...x, ativo: !b.ativo } : x)))
    }, 'Não foi possível mudar a sugestão.')

  async function mover(indice: number, dir: -1 | 1) {
    const alvo = indice + dir
    if (alvo < 0 || alvo >= sugestoes.length) return
    const anterior = sugestoes
    const nova = [...sugestoes]
    ;[nova[indice], nova[alvo]] = [nova[alvo], nova[indice]]
    const reordenada = nova.map((b, i) => ({ ...b, posicao: i }))
    setSugestoes(reordenada)
    try {
      await reordenarOrderBumps(supabase, reordenada.map((b) => ({ id: b.id, posicao: b.posicao })))
    } catch (e) {
      setSugestoes(anterior)
      setErro(mensagemErroCardapio(e, 'Não foi possível reordenar.'))
    }
  }

  async function mudarLimite(novo: number) {
    const v = Math.max(1, Math.min(MAX_SUGESTOES, novo))
    if (v === limite) return
    const anterior = limite
    setLimite(v)
    try {
      await atualizarOrderBumpMax(supabase, restauranteId, v)
    } catch (e) {
      setLimite(anterior)
      setErro(mensagemErroCardapio(e, 'Não foi possível salvar o limite.'))
    }
  }

  if (carregando) return <div className="flex flex-1 items-center justify-center text-sm text-text-subtle">Carregando…</div>

  const ativasVisiveis = sugestoes.filter((b) => b.ativo).length

  return (
    <div className="flex-1 overflow-y-auto p-5 max-lg:p-3">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-4">
        <CartaoPainel>
          <CabecalhoSecao
            icone={<ShoppingBag className="h-4 w-4" />}
            tom="verde"
            titulo="Peça também"
            contador={sugestoes.length}
            descricao="Sugestões que aparecem no carrinho do cliente, antes de finalizar o pedido. Um toque adiciona o produto — ótimo para bebidas, sobremesas e porções."
          />
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="text-[12.5px] font-semibold text-[var(--adm-texto-forte)]">Mostrar até</span>
            <div className="inline-flex items-center overflow-hidden rounded-[4px] border border-[var(--adm-borda)] bg-white">
              <button type="button" aria-label="Mostrar menos" disabled={limite <= 1} onClick={() => mudarLimite(limite - 1)} className="toque-icone flex h-8 w-8 items-center justify-center text-[var(--adm-texto-medio)] hover:bg-[var(--adm-hover)] disabled:opacity-40">
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="w-8 text-center text-[14px] font-bold tabular-nums text-[var(--adm-texto)]" data-testid="peca-tambem-limite">
                {limite}
              </span>
              <button type="button" aria-label="Mostrar mais" disabled={limite >= MAX_SUGESTOES} onClick={() => mudarLimite(limite + 1)} className="toque-icone flex h-8 w-8 items-center justify-center text-[var(--adm-texto-medio)] hover:bg-[var(--adm-hover)] disabled:opacity-40">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="text-[12.5px] text-[var(--adm-texto-medio)]">produtos no carrinho (máximo {MAX_SUGESTOES})</span>
          </div>
        </CartaoPainel>

        <FaixaErro mensagem={erro} onFechar={() => setErro(null)} />

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <CartaoPainel>
            <CabecalhoSecao
              icone={<ShoppingBag className="h-4 w-4" />}
              tom="azul"
              titulo="Sugestões, na ordem em que aparecem"
              contador={ativasVisiveis}
            />
            {sugestoes.length === 0 ? (
              <Vazio icone={<ShoppingBag className="h-5 w-5" />} titulo="Nenhuma sugestão ainda" texto="Escolha produtos na lista ao lado para sugerir no carrinho." />
            ) : (
              <ol className="divide-y divide-[var(--adm-borda)]">
                {sugestoes.map((b, i) => {
                  const item = porId.get(b.itemId)
                  if (!item) return null
                  const motivo = motivoIndisponivelAgora(item, mapaGrupos)
                  const foraDoLimite = i >= limite
                  return (
                    <li key={b.id} className={`flex items-center gap-3 px-4 py-2.5 ${!b.ativo ? 'bg-[var(--adm-superficie-2)]' : ''}`}>
                      <span className={`w-5 flex-shrink-0 text-center text-[12px] font-bold ${foraDoLimite ? 'text-[var(--adm-texto-suave)]' : 'text-[var(--adm-azul)]'}`}>{i + 1}</span>
                      <div className={!b.ativo ? 'opacity-50' : ''}>
                        <ItemThumb item={item} size={40} />
                      </div>
                      <div className={`min-w-0 flex-1 ${!b.ativo ? 'opacity-60' : ''}`}>
                        <p className="truncate text-[13px] font-semibold text-[var(--adm-texto)]">{item.nome}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <PrecoItem item={item} />
                          {motivo && <span className="rounded-full bg-danger-bg px-2 py-[1px] text-[10.5px] font-bold text-danger">{motivo}</span>}
                          {foraDoLimite && b.ativo && (
                            <span className="rounded-full bg-warn-bg px-2 py-[1px] text-[10.5px] font-bold text-[#92400E]" title={`Só as ${limite} primeiras aparecem. Suba este produto ou aumente o limite.`}>
                              Fora do limite
                            </span>
                          )}
                        </div>
                      </div>
                      <Chave ligada={b.ativo} rotulo={b.ativo ? `Pausar sugestão de ${item.nome}` : `Ativar sugestão de ${item.nome}`} disabled={ocupado === b.id} onMudar={() => alternar(b)} />
                      <div className="flex items-center gap-1">
                        <BotaoIcone rotulo="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                          <ArrowUp className="h-3.5 w-3.5" />
                        </BotaoIcone>
                        <BotaoIcone rotulo="Descer" disabled={i === sugestoes.length - 1} onClick={() => mover(i, 1)}>
                          <ArrowDown className="h-3.5 w-3.5" />
                        </BotaoIcone>
                        <BotaoIcone rotulo={`Tirar ${item.nome} das sugestões`} perigo disabled={ocupado === b.id} onClick={() => remover(b)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </BotaoIcone>
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
            {sugestoes.some((b, i) => i >= limite && b.ativo) && (
              <Aviso className="m-4">
                Só as {limite} primeiras sugestões aparecem no carrinho. Suba os produtos mais importantes ou aumente o limite acima.
              </Aviso>
            )}
          </CartaoPainel>

          <CartaoPainel className="lg:sticky lg:top-0">
            <div className="border-b border-[var(--adm-borda)] px-4 py-3">
              <h3 className="text-[14px] font-bold text-[var(--adm-texto-forte)]">Adicionar produto</h3>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--adm-texto-suave)]" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto ou categoria…" aria-label="Buscar produto" className={`${CLASSE_CAMPO} pl-8`} />
              </div>
            </div>
            <ul className="max-h-[520px] divide-y divide-[var(--adm-borda)] overflow-y-auto">
              {disponiveis.length === 0 && (
                <li className="px-4 py-8 text-center text-[12px] text-[var(--adm-texto-suave)]">
                  {busca ? 'Nenhum produto encontrado.' : 'Todos os produtos já estão nas sugestões.'}
                </li>
              )}
              {disponiveis.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={ocupado === item.id}
                    onClick={() => adicionar(item)}
                    className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors hover:bg-[var(--adm-azul-claro)] disabled:opacity-50"
                  >
                    <ItemThumb item={item} size={34} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[var(--adm-texto)]">{item.nome}</span>
                      <span className="block truncate text-[11px] text-[var(--adm-texto-suave)]">
                        {mapaGrupos.get(item.grupoId ?? '')?.nome ?? 'Sem categoria'} · <PrecoItem item={item} />
                      </span>
                    </span>
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[var(--adm-azul-claro)] text-[var(--adm-azul)]">
                      <Plus className="h-4 w-4" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CartaoPainel>
        </div>
      </div>
    </div>
  )
}
