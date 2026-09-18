'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRightLeft, Check, Plus, Send, Trash2, X } from 'lucide-react'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, listarGrupos, listarItens, type ItemCardapio, type GrupoCardapio } from '@/lib/queries/cardapio'
import { listarMesas, type Mesa } from '@/lib/queries/mesas'
import { buscarComandaAberta, listarPedidosDaComanda, calcularTotalComanda } from '@/lib/queries/comandas'
import type { Pedido } from '@/lib/queries/pedidos'
import { listarSelecoesAbertas, type SelecaoVista } from '@/lib/queries/mesa-sessao'
import { validarOpcoes, minimoDoGrupo, maximoDoGrupo, type GrupoOpcoesRegra } from '@/lib/opcoes-item'
import { itemDisponivelNoCanal } from '@/lib/canais-item'
import { itemDisponivelHoje } from '@/lib/timezone'
import { listarChamadosAbertos, type Chamado } from '@/lib/queries/chamados'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import { PainelChamados, useRelogio } from '../chamados'
import { Confirmacao, Historico, ModalDestino, PainelConta, useConta, type MesaOpcao } from './conta'

/**
 * Painel do garçom para uma mesa.
 *
 * Três blocos que não se misturam, de propósito:
 *
 * 1. **Seleção do cliente** — o que ele marcou no celular pelo QR. Fica em bloco
 *    separado, marcado como NÃO lançado, e é só referência: nada aqui importa itens
 *    automaticamente para a comanda.
 * 2. **Lançamento** — o que o garçom monta à mão, escolhendo do catálogo.
 * 3. **Já lançado** — os pedidos oficiais que a cozinha recebeu.
 *
 * O garçom lança e envia. Ele não avança o preparo (isso é da cozinha) e não confirma
 * entrega — ele serve a mesa e pronto.
 */

interface LinhaSelecaoCliente {
  nome: string
  quantidade: number
  precoUnitario: number
  observacao: string
  opcoes: { grupo: string; escolha: string; preco: number }[]
}

interface LinhaLancamento {
  chave: string
  itemId: string
  nome: string
  /** Preço unitário JÁ somado com as opções — só para exibir; o servidor reprecifica. */
  preco: number
  quantidade: number
  observacao: string
  complementos: { nome: string; preco: number }[]
  /** Motivo pelo qual o servidor recusou esta linha no último envio. Null = tudo certo. */
  indisponivel?: string | null
}

/** Grupos do item com pelo menos uma opção disponível — são os que viram etapa. */
function gruposComOpcao(item: ItemCardapio) {
  return item.grupos
    .map((g) => ({ ...g, complementos: g.complementos.filter((c) => !c.pausado) }))
    .filter((g) => g.complementos.length > 0)
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function MesaDetalhePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useMemo(() => getBrowserSupabase(), [])

  const [mesa, setMesa] = useState<Mesa | null>(null)
  const [mesasDaLoja, setMesasDaLoja] = useState<MesaOpcao[]>([])
  const [aba, setAba] = useState<'lancar' | 'conta' | 'historico'>('lancar')
  const [avisoPagina, setAvisoPagina] = useState<string | null>(null)
  const [transferindoMesa, setTransferindoMesa] = useState(false)
  // Destino ocupado: a troca só vira junção de contas com confirmação explícita.
  const [confirmarJuntar, setConfirmarJuntar] = useState<MesaOpcao | null>(null)
  const estadoConta = useConta(params.id)
  const permissoesConta = estadoConta.dados?.permissoes ?? {}
  // O caixa vê e cobra a conta, mas não lança nem atende chamado. Enquanto as permissões
  // não chegam, a aba de lançar fica (é a do garçom, o caso mais comum).
  const permissoesCarregadas = !!estadoConta.dados
  const podeLancar = !permissoesCarregadas || permissoesConta.lancar === true
  // Motivo digitado na troca de mesa, guardado para a confirmação de "juntar contas".
  const [motivoTroca, setMotivoTroca] = useState('')
  const [grupos, setGrupos] = useState<GrupoCardapio[]>([])
  const [itens, setItens] = useState<ItemCardapio[]>([])
  const [selecaoCliente, setSelecaoCliente] = useState<LinhaSelecaoCliente[]>([])
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [lancamento, setLancamento] = useState<LinhaLancamento[]>([])
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviado, setEnviado] = useState<{ numero: number } | null>(null)
  const [configurando, setConfigurando] = useState<ItemCardapio | null>(null)
  // Versões das seleções do cliente que ESTA tela está mostrando. O envio manda isso, e
  // o servidor só encerra o que ainda estiver nessa versão — lista que o cliente mudou
  // depois continua aberta.
  const [selecoesVistas, setSelecoesVistas] = useState<SelecaoVista[]>([])
  const [chamados, setChamados] = useState<Chamado[]>([])
  const [restauranteId, setRestauranteId] = useState<string | null>(null)
  const agora = useRelogio()
  // Chave do lançamento em montagem. Gerada uma vez e trocada só depois de um envio que
  // deu certo: clique duplo e reenvio carregam a MESMA chave e não duplicam o pedido.
  const [chaveLancamento, setChaveLancamento] = useState<string>(() => crypto.randomUUID())

  const carregar = useCallback(async () => {
    const restauranteId = await buscarRestauranteIdDoUsuario(supabase)
    setRestauranteId(restauranteId)
    if (!restauranteId) {
      setErro('Não foi possível identificar a loja.')
      setCarregando(false)
      return
    }

    const [mesas, gruposDb, itensDb] = await Promise.all([
      listarMesas(supabase, restauranteId),
      listarGrupos(supabase, restauranteId),
      listarItens(supabase, restauranteId),
    ])

    // Só os chamados DESTA mesa: o painel do salão mostra os outros.
    setChamados((await listarChamadosAbertos(supabase, restauranteId).catch(() => [])).filter((c) => c.mesaId === params.id))

    const alvo = mesas.find((m) => m.id === params.id) ?? null
    setMesa(alvo)
    setMesasDaLoja(mesas.map((m) => ({ id: m.id, nome: m.nome, ativa: m.ativa, bloqueada: m.bloqueada })))
    setGrupos(gruposDb)
    // Mesmo catálogo do delivery, filtrado pelo canal do salão e pelo dia (0069). O
     // servidor confere de novo no envio: aba aberta antes da mudança não fura a regra.
    setItens(
      itensDb.filter(
        (i) => i.status === 'disponivel' && itemDisponivelNoCanal(i, 'mesa') && itemDisponivelHoje(i.diasDisponiveis),
      ),
    )
    setCategoriaAtiva((atual) => atual ?? gruposDb[0]?.id ?? null)

    // Pedidos já lançados nesta mesa.
    const comanda = await buscarComandaAberta(supabase, restauranteId, params.id).catch(() => null)
    setPedidos(comanda ? await listarPedidosDaComanda(supabase, restauranteId, comanda.id).catch(() => []) : [])

    await recarregarSelecao()
    setCarregando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, params.id])

  /** Seleção do cliente: referência, nunca importada. Só os ciclos ainda abertos. */
  const recarregarSelecao = useCallback(async () => {
    const abertas = await listarSelecoesAbertas(supabase, params.id).catch(() => [])
    setSelecoesVistas(abertas.map((a) => ({ id: a.id, versao: a.versao })))
    setSelecaoCliente(
      abertas.flatMap((a) =>
        a.itens.map((i) => ({
          nome: i.nome,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
          observacao: i.observacao,
          opcoes: i.opcoes,
        })),
      ),
    )
  }, [supabase, params.id])

  // Chamado da mesa em tempo real, com o polling como rede de segurança. O cliente pode
  // chamar enquanto o garçom já está na tela dela.
  const { intervaloMs } = useRealtimeComFallback({
    supabase,
    canal: restauranteId ? `mesa-${params.id}` : null,
    tabelas: [{ tabela: 'chamados_mesa', filtro: restauranteId ? `mesa_id=eq.${params.id}` : undefined }],
    aoEvento: () => void carregar(),
    aoSincronizar: () => void carregar(),
  })

  useEffect(() => {
    if (!restauranteId) return
    const t = setInterval(() => void carregar(), intervaloMs)
    return () => clearInterval(t)
  }, [restauranteId, intervaloMs, carregar])

  // O cliente continua marcando itens no celular enquanto o garçom está na mesa: a lista
  // se atualiza sozinha, sem ele precisar recarregar a página.
  useEffect(() => {
    const t = setInterval(() => void recarregarSelecao(), 5000)
    return () => clearInterval(t)
  }, [recarregarSelecao])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (termo) return itens.filter((i) => i.nome.toLowerCase().includes(termo))
    return itens.filter((i) => i.grupoId === categoriaAtiva)
  }, [itens, categoriaAtiva, busca])

  const totalLancamento = lancamento.reduce((s, l) => s + l.preco * l.quantidade, 0)
  const totalComanda = calcularTotalComanda(pedidos)

  /** Toque no item: se tem opções, abre o configurador; senão entra direto. */
  function tocarItem(item: ItemCardapio) {
    if (gruposComOpcao(item).length > 0) {
      setConfigurando(item)
      return
    }
    adicionar(item, [])
  }

  function adicionar(item: ItemCardapio, complementos: { nome: string; preco: number }[]) {
    const assinatura = complementos.map((c) => c.nome).sort().join('|')
    const precoBase = item.promocaoPreco ?? item.preco
    setLancamento((atual) => {
      // Mesmo item, mesmas opções e sem observação junta na linha existente: o garçom
      // toca três vezes no mesmo prato e não quer ver três linhas iguais. Opções
      // diferentes (um ao ponto, outro bem passado) ficam separadas — a cozinha precisa
      // ver a diferença.
      const existente = atual.find(
        (l) =>
          l.itemId === item.id &&
          !l.observacao &&
          l.complementos.map((c) => c.nome).sort().join('|') === assinatura,
      )
      if (existente) {
        return atual.map((l) => (l === existente ? { ...l, quantidade: Math.min(99, l.quantidade + 1) } : l))
      }
      return [
        ...atual,
        {
          chave: crypto.randomUUID(),
          itemId: item.id,
          nome: item.nome,
          preco: precoBase + complementos.reduce((s, c) => s + c.preco, 0),
          quantidade: 1,
          observacao: '',
          complementos,
        },
      ]
    })
  }

  async function enviarParaCozinha() {
    if (lancamento.length === 0 || enviando) return
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/admin/mesas/${params.id}/lancamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chaveIdempotencia: chaveLancamento,
          selecoesVistas,
          itens: lancamento.map((l) => ({
            itemId: l.itemId,
            quantidade: l.quantidade,
            observacao: l.observacao,
            complementos: l.complementos.map((c) => c.nome),
          })),
        }),
      })
      const corpo = await res.json()
      if (!res.ok) {
        // Item que saiu do cardápio entre o cliente marcar e o garçom lançar: o servidor
        // diz QUAIS linhas travaram. A tela marca essas e não mexe no resto do
        // lançamento — o garçom troca ou remove e reenvia, sem remontar tudo.
        const travados = Array.isArray(corpo.itensIndisponiveis)
          ? (corpo.itensIndisponiveis as { itemId: string; motivo: string }[])
          : []
        if (travados.length > 0) {
          const motivoPorItem = new Map(travados.map((t) => [t.itemId, t.motivo]))
          setLancamento((atual) => atual.map((l) => ({ ...l, indisponivel: motivoPorItem.get(l.itemId) ?? null })))
        }
        throw new Error(corpo.error ?? 'Não foi possível enviar.')
      }
      setLancamento([])
      // Só depois do sucesso a chave troca: o próximo lançamento é outro pedido.
      setChaveLancamento(crypto.randomUUID())
      setEnviado({ numero: corpo.numero })
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar.')
    } finally {
      setEnviando(false)
    }
  }

  async function transferirMesa(destinoMesaId: string, mesclar: boolean, motivo: string) {
    const r = await estadoConta.agir('transferir_mesa', { destinoMesaId, mesclar, motivo })
    const destino = mesasDaLoja.find((m) => m.id === destinoMesaId) ?? null
    if (!r.ok && r.codigo === 'destino_ocupado' && !mesclar) {
      setTransferindoMesa(false)
      setMotivoTroca(motivo)
      setConfirmarJuntar(destino)
      return
    }
    setTransferindoMesa(false)
    setConfirmarJuntar(null)
    if (!r.ok) {
      setAvisoPagina(r.error ?? 'Não foi possível transferir a mesa.')
      return
    }
    setAvisoPagina(`Conta ${mesclar ? 'juntada com' : 'transferida para'} a ${destino?.nome ?? 'outra mesa'}.`)
    router.push(`/admin/mesas/${destinoMesaId}`)
  }

  // Caixa não tem aba de lançar: abre direto na conta.
  useEffect(() => {
    if (!podeLancar && aba === 'lancar') setAba('conta')
  }, [podeLancar, aba])

  if (carregando) {
    return (
      <>
        <TopBar title="Mesa" breadcrumb="Mesas e Comandas" />
        <div className="p-5 text-[13px] text-text-subtle">Carregando…</div>
      </>
    )
  }

  if (!mesa) {
    return (
      <>
        <TopBar title="Mesa" breadcrumb="Mesas e Comandas" />
        <div className="p-5">
          <p className="rounded-menuzia border border-danger bg-danger-bg px-4 py-3 text-[13px] text-danger">
            {erro ?? 'Mesa não encontrada nesta loja.'}
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar
        title={mesa.nome}
        breadcrumb={`Mesas e Comandas · ${mesa.setor || 'Salão'}`}
        right={
          <>
            {permissoesConta.transferir_mesa && estadoConta.dados?.conta && (
              <Button variant="outline" onClick={() => setTransferindoMesa(true)}>
                <ArrowRightLeft className="mr-1.5 inline h-3.5 w-3.5" />
                Trocar de mesa
              </Button>
            )}
            <Button variant="outline" onClick={() => router.push('/admin/mesas')}>
              <ArrowLeft className="mr-1.5 inline h-3.5 w-3.5" />
              Voltar ao salão
            </Button>
          </>
        }
      />

      <div className="flex-1 overflow-y-auto p-5">
        {podeLancar && <PainelChamados chamados={chamados} agora={agora} onMudou={() => void carregar()} />}

        {avisoPagina && (
          <p className="mb-3 flex items-center justify-between gap-2 rounded-menuzia bg-alert-bg px-4 py-2.5 text-[13px] text-alert-text" role="status">
            {avisoPagina}
            <button aria-label="Dispensar aviso" onClick={() => setAvisoPagina(null)}>
              <X className="h-4 w-4" />
            </button>
          </p>
        )}

        <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
          {([
            ['lancar', 'Lançar pedido'],
            ['conta', estadoConta.dados?.conta ? `Conta · falta ${brl(estadoConta.dados.conta.totais.restante)}` : 'Conta'],
            ['historico', 'Histórico'],
          ] as const).filter(([id]) => id !== 'lancar' || podeLancar).map(([id, rotulo]) => (
            <button
              key={id}
              role="tab"
              aria-selected={aba === id}
              onClick={() => setAba(id)}
              className={[
                '-mb-px min-h-[40px] border-b-2 px-4 py-2 text-[12px] font-bold uppercase tracking-wide lg:min-h-0',
                aba === id ? 'border-primary text-primary' : 'border-transparent text-text-subtle hover:text-text-main',
              ].join(' ')}
            >
              {rotulo}
            </button>
          ))}
        </div>

        {aba === 'conta' && (
          <PainelConta
            mesaId={params.id}
            mesas={mesasDaLoja}
            estado={estadoConta}
            onContaFechada={() => {
              setAvisoPagina(`Conta da ${mesa.nome} fechada. A mesa está livre.`)
              setAba(podeLancar ? 'lancar' : 'conta')
              void carregar()
            }}
          />
        )}

        {aba === 'historico' && <Historico eventos={estadoConta.dados?.historico ?? []} />}

        <div className={`grid gap-4 xl:grid-cols-[1fr_380px] ${aba === 'lancar' && podeLancar ? '' : 'hidden'}`}>
          {/* ── Catálogo: o garçom escolhe à mão ─────────────────────────── */}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar item…"
                className="h-[44px] w-full rounded-menuzia lg:h-9 lg:w-52 border border-border bg-main px-3 text-[13px] outline-none focus:border-primary"
              />
              <div className="flex flex-wrap gap-1.5">
                {grupos.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => {
                      setCategoriaAtiva(g.id)
                      setBusca('')
                    }}
                    className={[
                      'min-h-[40px] rounded-menuzia border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors lg:min-h-0',
                      g.id === categoriaAtiva && !busca
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-main text-text-subtle hover:text-text-main',
                    ].join(' ')}
                  >
                    {g.nome}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5">
              {visiveis.map((item) => (
                <button
                  key={item.id}
                  onClick={() => tocarItem(item)}
                  className="flex items-center justify-between gap-2 rounded-menuzia border border-border bg-main p-3 text-left transition-colors hover:border-primary"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-text-main">{item.nome}</span>
                    <span className="text-[12px] font-bold text-price-text">
                      {brl(item.promocaoPreco ?? item.preco)}
                    </span>
                  </span>
                  <Plus className="h-4 w-4 flex-shrink-0 text-primary" />
                </button>
              ))}
              {visiveis.length === 0 && (
                <p className="col-span-full py-6 text-center text-[13px] text-text-subtle">Nenhum item aqui.</p>
              )}
            </div>

            {/* ── Seleção do cliente: referência, não lançamento ──────────── */}
            <div className="mt-5 rounded-menuzia border border-warn bg-warn-bg p-4">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone="pending">Não lançado</Badge>
                <h3 className="text-[13px] font-bold text-text-main">Seleção do cliente no celular</h3>
              </div>
              {selecaoCliente.length === 0 ? (
                <p className="text-[12px] text-text-subtle">
                  O cliente ainda não marcou nada no cardápio da mesa.
                </p>
              ) : (
                <>
                  <ul className="space-y-1.5">
                    {selecaoCliente.map((l, i) => (
                      <li key={i} className="text-[12px] text-text-main">
                        <span className="font-bold">{l.quantidade}×</span> {l.nome}
                        {l.opcoes.length > 0 && (
                          <span className="text-text-subtle"> · {l.opcoes.map((o) => o.escolha).join(', ')}</span>
                        )}
                        {l.observacao && <span className="text-text-subtle"> · “{l.observacao}”</span>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2.5 text-[11px] text-text-subtle">
                    Isto é só o que o cliente marcou para te mostrar. <strong>Não foi lançado nem enviado à
                    cozinha.</strong> Confirme com ele e monte o lançamento ao lado.
                  </p>
                </>
              )}
            </div>
          </section>

          {/* ── Lançamento + comanda ─────────────────────────────────────── */}
          <aside className="space-y-4">
            <div className="rounded-menuzia border border-border bg-main">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-[13px] font-bold text-text-main">Lançamento</h3>
                <p className="text-[11px] text-text-subtle">Confira antes de enviar. Depois vai direto pra cozinha.</p>
              </div>

              <div className="max-h-[38vh] overflow-y-auto">
                {lancamento.length === 0 && (
                  <p className="px-4 py-8 text-center text-[12px] text-text-subtle">
                    Toque nos itens ao lado para montar o pedido.
                  </p>
                )}
                {lancamento.map((l) => (
                  <div
                    key={l.chave}
                    className={`flex items-start gap-2 border-b px-4 py-2.5 ${
                      l.indisponivel ? 'border-danger bg-danger-bg' : 'border-border'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-text-main">{l.nome}</div>
                      {l.indisponivel && (
                        <div className="text-[11px] font-semibold text-danger">{l.indisponivel}</div>
                      )}
                      {l.complementos.length > 0 && (
                        <div className="text-[11px] text-text-subtle">{l.complementos.map((c) => c.nome).join(' · ')}</div>
                      )}
                      <div className="text-[12px] text-price-text">{brl(l.preco * l.quantidade)}</div>
                      <input
                        value={l.observacao}
                        onChange={(e) =>
                          setLancamento((atual) =>
                            atual.map((x) => (x.chave === l.chave ? { ...x, observacao: e.target.value.slice(0, 200) } : x)),
                          )
                        }
                        placeholder="Observação (ex.: sem cebola)"
                        className="mt-1 h-7 w-full rounded-menuzia border border-border px-2 text-[11px] outline-none focus:border-primary"
                      />
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1">
                      <div className="flex items-center gap-1.5 rounded-menuzia border border-border px-1.5">
                        <button
                          className="px-1 text-[15px] text-primary"
                          onClick={() =>
                            setLancamento((atual) =>
                              atual
                                .map((x) => (x.chave === l.chave ? { ...x, quantidade: x.quantidade - 1 } : x))
                                .filter((x) => x.quantidade > 0),
                            )
                          }
                        >
                          −
                        </button>
                        <span className="min-w-[14px] text-center text-[12px] font-bold">{l.quantidade}</span>
                        <button
                          className="px-1 text-[15px] text-primary"
                          onClick={() =>
                            setLancamento((atual) =>
                              atual.map((x) => (x.chave === l.chave ? { ...x, quantidade: Math.min(99, x.quantidade + 1) } : x)),
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                      <button
                        className="text-[10px] text-text-subtle underline"
                        onClick={() => setLancamento((atual) => atual.filter((x) => x.chave !== l.chave))}
                      >
                        <Trash2 className="mr-0.5 inline h-3 w-3" />
                        remover
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5 border-t border-border p-4">
                {erro && (
                  <p className="rounded-menuzia bg-danger-bg px-3 py-2 text-[12px] font-semibold text-danger">{erro}</p>
                )}
                <div className="flex items-center justify-between text-[14px]">
                  <span className="text-text-subtle">Total do lançamento</span>
                  <strong className="text-price-text">{brl(totalLancamento)}</strong>
                </div>
                <Button
                  variant="success"
                  className="w-full"
                  disabled={lancamento.length === 0 || enviando}
                  onClick={enviarParaCozinha}
                >
                  <Send className="mr-1.5 inline h-3.5 w-3.5" />
                  {enviando ? 'Enviando…' : 'Enviar para a cozinha'}
                </Button>
              </div>
            </div>

            <div className="rounded-menuzia border border-border bg-main">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h3 className="text-[13px] font-bold text-text-main">Já lançado</h3>
                <span className="text-[13px] font-bold text-price-text">{brl(totalComanda)}</span>
              </div>
              {pedidos.length === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-text-subtle">Nenhum pedido nesta mesa ainda.</p>
              ) : (
                <ul>
                  {pedidos.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
                      <span>
                        <span className="text-[13px] font-semibold text-text-main">#{p.numero}</span>
                        <span className="ml-2 text-[11px] uppercase tracking-wide text-text-subtle">{p.status}</span>
                        {p.criadoPorNome && (
                          <span className="block text-[11px] text-text-subtle">por {p.criadoPorNome}</span>
                        )}
                      </span>
                      <span className="text-[13px] font-bold text-price-text">{brl(p.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="px-4 py-2.5 text-[11px] text-text-subtle">
                O preparo é da cozinha: recebido → preparando → pronto. Você serve a mesa, sem registrar entrega.
              </p>
            </div>
          </aside>
        </div>
      </div>

      {configurando && (
        <ConfiguradorGarcom
          item={configurando}
          onCancelar={() => setConfigurando(null)}
          onConfirmar={(complementos) => {
            adicionar(configurando, complementos)
            setConfigurando(null)
          }}
        />
      )}

      {transferindoMesa && (
        <ModalDestino
          titulo={`Trocar a ${mesa.nome} para`}
          mesas={mesasDaLoja.filter((m) => m.id !== mesa.id)}
          onCancelar={() => setTransferindoMesa(false)}
          onConfirmar={(destino, motivo) => transferirMesa(destino, false, motivo)}
        />
      )}

      {confirmarJuntar && (
        <Confirmacao
          titulo={`A ${confirmarJuntar.nome} já tem conta aberta`}
          texto={`Juntar as contas? Os lançamentos e pagamentos da ${mesa.nome} passam para a ${confirmarJuntar.nome}. Nada é apagado e o histórico das duas fica guardado.`}
          botao="Juntar contas"
          onCancelar={() => setConfirmarJuntar(null)}
          onConfirmar={() => transferirMesa(confirmarJuntar.id, true, motivoTroca)}
        />
      )}

      {enviado && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={() => setEnviado(null)}>
          <div className="w-full max-w-sm rounded-menuzia bg-main p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border-2 border-status-ready text-status-ready">
              <Check className="h-6 w-6" />
            </div>
            <h2 className="text-[16px] font-bold text-text-main">Pedido #{enviado.numero} enviado</h2>
            <p className="mt-1 text-[13px] text-text-subtle">
              A cozinha recebeu e o pedido entrou na comanda da {mesa.nome}.
            </p>
            <Button className="mt-4 w-full" onClick={() => setEnviado(null)}>
              <X className="mr-1.5 inline h-3.5 w-3.5" />
              Fechar
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Configurador de opções do garçom ────────────────────────────────────────

/**
 * Escolha das opções de um item antes de entrar no lançamento.
 *
 * Mesma regra que o servidor aplica (`validarOpcoes`), para o garçom ver o erro na hora
 * em vez de descobrir no "Enviar para a cozinha". O servidor confere de novo — esta tela
 * só evita a viagem perdida.
 */
function ConfiguradorGarcom({
  item,
  onCancelar,
  onConfirmar,
}: {
  item: ItemCardapio
  onCancelar: () => void
  onConfirmar: (complementos: { nome: string; preco: number }[]) => void
}) {
  const grupos = useMemo(() => gruposComOpcao(item), [item])
  const [escolhidas, setEscolhidas] = useState<Record<string, string[]>>({})

  const regras: GrupoOpcoesRegra[] = grupos.map((g) => ({
    nome: g.nome,
    obrigatorio: g.obrigatorio,
    minEscolhas: g.minEscolhas,
    maxEscolhas: g.maxEscolhas,
    opcoes: g.complementos.map((c) => c.nome),
  }))
  const todas = Object.values(escolhidas).flat()
  const erros = validarOpcoes(regras, todas)

  function alternar(grupoId: string, nome: string, max: number) {
    setEscolhidas((atual) => {
      const doGrupo = atual[grupoId] ?? []
      if (max === 1) return { ...atual, [grupoId]: doGrupo[0] === nome ? [] : [nome] }
      if (doGrupo.includes(nome)) return { ...atual, [grupoId]: doGrupo.filter((n) => n !== nome) }
      if (doGrupo.length >= max) return atual
      return { ...atual, [grupoId]: [...doGrupo, nome] }
    })
  }

  const precoBase = item.promocaoPreco ?? item.preco
  const complementos = grupos.flatMap((g) =>
    g.complementos.filter((c) => (escolhidas[g.id] ?? []).includes(c.nome)).map((c) => ({ nome: c.nome, preco: c.preco })),
  )
  const total = precoBase + complementos.reduce((s, c) => s + c.preco, 0)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onCancelar}>
      <aside className="flex h-full w-full max-w-md flex-col bg-main shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-border px-5">
          <span className="text-[15px] font-semibold text-text-main">{item.nome}</span>
          <button onClick={onCancelar} className="-mr-2 grid h-[40px] w-[40px] place-items-center text-text-subtle hover:text-text-main" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {grupos.map((g) => {
            const max = maximoDoGrupo({ maxEscolhas: g.maxEscolhas, opcoes: g.complementos.map((c) => c.nome) })
            const min = minimoDoGrupo(g)
            const doGrupo = escolhidas[g.id] ?? []
            return (
              <div key={g.id}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-text-main">{g.nome}</span>
                  {min > 0 ? (
                    <Badge tone={doGrupo.length >= min ? 'ok' : 'danger'}>Obrigatório</Badge>
                  ) : (
                    <span className="text-[11px] text-text-subtle">até {max}</span>
                  )}
                </div>
                <div className="divide-y divide-border rounded-menuzia border border-border">
                  {g.complementos.map((c) => {
                    const marcada = doGrupo.includes(c.nome)
                    return (
                      <button
                        key={c.id}
                        onClick={() => alternar(g.id, c.nome, max)}
                        role={max === 1 ? 'radio' : 'checkbox'}
                        aria-checked={marcada}
                        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] ${marcada ? 'bg-alert-bg' : ''}`}
                      >
                        <span
                          className={`h-4 w-4 flex-shrink-0 border-2 ${max === 1 ? 'rounded-full' : 'rounded-menuzia'} ${
                            marcada ? 'border-primary bg-primary' : 'border-border'
                          }`}
                        />
                        <span className="flex-1 text-text-main">{c.nome}</span>
                        {c.preco > 0 && <span className="text-[12px] font-semibold text-text-subtle">+ {brl(c.preco)}</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>

        <div className="space-y-2 border-t border-border p-5">
          {erros.length > 0 && <p className="text-[12px] font-semibold text-danger">{erros[0]}</p>}
          <Button className="w-full" disabled={erros.length > 0} onClick={() => onConfirmar(complementos)}>
            <Plus className="mr-1.5 inline h-3.5 w-3.5" />
            Adicionar ao lançamento · {brl(total)}
          </Button>
        </div>
      </aside>
    </div>
  )
}
