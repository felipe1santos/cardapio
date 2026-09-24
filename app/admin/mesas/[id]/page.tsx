'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRightLeft, Check, Eye, History, Receipt, Search, ShoppingBag, Utensils, X } from 'lucide-react'
import { esperaTexto } from '@/lib/chamados'
import { TopBar } from '@/components/layout/topbar'
import { Button } from '@/components/ui/button'
import { getBrowserSupabase } from '@/lib/supabase/client'
import { buscarRestauranteIdDoUsuario, listarGrupos, listarItens, type ItemCardapio, type GrupoCardapio } from '@/lib/queries/cardapio'
import { estadoDaMesa, listarMesas, ROTULO_ESTADO, type Mesa } from '@/lib/queries/mesas'
import { buscarComandaAberta, listarPedidosDaComanda, calcularTotalComanda } from '@/lib/queries/comandas'
import type { Pedido } from '@/lib/queries/pedidos'
import { listarSelecoesAbertas, type SelecaoVista } from '@/lib/queries/mesa-sessao'
import { buscarRegraPrecoPizza, listarBordasPizza, listarMassasPizza, listarTamanhosPadraoPizza } from '@/lib/queries/pizza'
import { grupoEstaAtivoAgora, itemDisponivelHoje } from '@/lib/timezone'
import {
  TEXTO_MOTIVO,
  adicionarAoLancamento,
  bloqueioDoEnvio,
  buscarItens,
  categoriaAtivaValida,
  categoriasComItens,
  itemSimples,
  itensLancaveis,
  motivoIndisponivel,
  precoEstimado,
  resolverDaSelecao,
  resumoIndisponibilidade,
  totalDoLancamento,
  type EscolhaItem,
  type LinhaLancamento,
  type LinhaSelecao,
  type Relogio,
} from '@/lib/garcom-catalogo'
import { listarChamadosAbertos, type Chamado } from '@/lib/queries/chamados'
import { useRealtimeComFallback } from '@/lib/realtime-fallback'
import { PainelChamados, useRelogio } from '../chamados'
import { Confirmacao, Historico, ModalDestino, PainelConta, useConta, type MesaOpcao } from './conta'
import { CardProduto, ConfiguradorGarcom, PainelLancamento, SelecaoDoCliente, SemItens, brl, type DadosPizza } from './lancar'
import { AbrirMesaModal, IdentificarModal, LimpezaModal } from '@/components/pdv/atendimento'
import { BotaoTelaCheia } from '@/components/ui/tela-cheia'

/**
 * Painel do garçom para uma mesa.
 *
 * Três blocos que não se misturam, de propósito:
 *
 * 1. **Seleção do cliente** — o que ele marcou no celular pelo QR. Fica em bloco
 *    separado, marcado como NÃO lançado. Nada entra sozinho: o garçom toca em
 *    "Adicionar" item a item (ou na seleção toda), e mesmo assim o item passa pela
 *    disponibilidade e pelo preço de agora.
 * 2. **Lançamento** — o que vai para a cozinha no próximo envio, montado à mão.
 * 3. **Já lançado** — os pedidos oficiais que a cozinha recebeu.
 *
 * O catálogo é o mesmo do delivery (`itens_cardapio`); `lib/garcom-catalogo.ts` decide o
 * que pode ser lançado agora e quais categorias aparecem. A tela abre na primeira
 * categoria que TEM item — antes abria na primeira cadastrada, mesmo fora do horário, e
 * mostrava "Nenhum item aqui" com Bebidas disponível ao lado.
 *
 * O garçom lança e envia. Ele não avança o preparo (isso é da cozinha) e não confirma
 * entrega — ele serve a mesa e pronto.
 */

const RELOGIO: Relogio = { disponivelHoje: itemDisponivelHoje, categoriaAtiva: grupoEstaAtivoAgora }

interface Configurando {
  item: ItemCardapio
  inicial?: Partial<EscolhaItem>
  aviso?: string | null
  /** Chave da linha em edição. Sem ela, o configurador adiciona uma linha nova. */
  editar?: string
  origemSelecao?: string
}

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
  // O caixa vê e cobra a conta, mas não lança nem atende chamado. Falha FECHADA: enquanto
  // as permissões não chegam, nenhuma aba aparece (a área mostra "Carregando…"). Antes a
  // aba de lançar vinha por padrão e o caixa via o catálogo inteiro por um instante.
  const permissoesCarregadas = !!estadoConta.dados
  const podeLancar = permissoesCarregadas && permissoesConta.lancar === true
  // Atender chamado é `mesas.operar`, não "lançar": são permissões diferentes e um dia
  // podem divergir. `assumir` é a que a rota calcula com `mesas.operar`.
  const podeAtenderChamado = permissoesCarregadas && permissoesConta.assumir === true
  /**
   * Cardápio da mesa em "somente visualização" (0075): o QR é só leitura. O cliente não
   * monta seleção e não chama ninguém — não existe a figura do garçom nesse modo. A tela
   * diz isso em vez de ficar mostrando "o cliente ainda não marcou nada", que faria o
   * garçom esperar por algo que nunca vem.
   */
  const somenteVisualizacao = estadoConta.dados?.somenteVisualizacao === true
  // Motivo digitado na troca de mesa, guardado para a confirmação de "juntar contas".
  const [motivoTroca, setMotivoTroca] = useState('')
  const [grupos, setGrupos] = useState<GrupoCardapio[]>([])
  // O cardápio INTEIRO da loja; o que pode ser lançado agora é derivado (e recalculado
  // a cada minuto, para uma categoria que abre ou fecha com a tela aberta).
  const [todos, setTodos] = useState<ItemCardapio[]>([])
  const [pizza, setPizza] = useState<DadosPizza>({ tamanhos: [], bordas: [], massas: [], regra: 'media' })
  const [selecaoCliente, setSelecaoCliente] = useState<LinhaSelecao[]>([])
  const [selecaoAberta, setSelecaoAberta] = useState(false)
  const [avisoSelecao, setAvisoSelecao] = useState<string | null>(null)
  const [pedidos, setPedidos] = useState<Pedido[]>([])
  const [lancamento, setLancamento] = useState<LinhaLancamento[]>([])
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(null)
  const [busca, setBusca] = useState('')
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviado, setEnviado] = useState<{ numero: number } | null>(null)
  const [configurando, setConfigurando] = useState<Configurando | null>(null)
  // Celular/tablet: o lançamento abre numa folha por cima do cardápio.
  const [folhaAberta, setFolhaAberta] = useState(false)
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
  // PDV v2 (0094/0095): mesa livre abre com o nome do cliente; conta antiga sem nome pede
  // o nome; mesa em limpeza mostra quem estava e o botão de liberar.
  const [abrindoMesa, setAbrindoMesa] = useState(false)
  const [identificandoComanda, setIdentificandoComanda] = useState<string | null>(null)
  const [vendoLimpeza, setVendoLimpeza] = useState(false)

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
    setTodos(itensDb)

    // Pedidos já lançados nesta mesa.
    const comanda = await buscarComandaAberta(supabase, restauranteId, params.id).catch(() => null)
    setPedidos(comanda ? await listarPedidosDaComanda(supabase, restauranteId, comanda.id).catch(() => []) : [])

    await recarregarSelecao()
    setCarregando(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, params.id])

  /** Seleção do cliente: referência. Só entra no lançamento por ação do garçom. */
  const recarregarSelecao = useCallback(async () => {
    const abertas = await listarSelecoesAbertas(supabase, params.id).catch(() => [])
    setSelecoesVistas(abertas.map((a) => ({ id: a.id, versao: a.versao })))
    setSelecaoCliente(
      abertas.flatMap((a) =>
        a.itens.map((i, n) => ({
          // Versão na chave: se o cliente mexe na lista, o "adicionado" da versão
          // anterior não gruda numa linha que agora é outra.
          chave: `${a.id}:${a.versao}:${n}`,
          itemId: i.itemId,
          nome: i.nome,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
          observacao: i.observacao,
          opcoes: i.opcoes,
        })),
      ),
    )
  }, [supabase, params.id])

  // Tamanhos, bordas e massas de pizza: mudam pouco, carregam uma vez. Loja sem pizza
  // devolve listas vazias; erro de leitura só deixa o configurador sem essas opções.
  useEffect(() => {
    if (!restauranteId) return
    void (async () => {
      const [tamanhos, bordas, massas, regra] = await Promise.all([
        listarTamanhosPadraoPizza(supabase, restauranteId).catch(() => []),
        listarBordasPizza(supabase, restauranteId).catch(() => []),
        listarMassasPizza(supabase, restauranteId).catch(() => []),
        buscarRegraPrecoPizza(supabase, restauranteId).catch(() => 'media' as const),
      ])
      setPizza({ tamanhos, bordas, massas, regra })
    })()
  }, [supabase, restauranteId])

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
  // se atualiza sozinha, sem ele precisar recarregar a página. No modo só-visualização
  // não existe seleção — o polling seria uma consulta a cada 5s para nunca achar nada.
  useEffect(() => {
    if (somenteVisualizacao) return
    const t = setInterval(() => void recarregarSelecao(), 5000)
    return () => clearInterval(t)
  }, [recarregarSelecao, somenteVisualizacao])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // ── catálogo derivado ─────────────────────────────────────────────────────
  // `agora` entra nas dependências para recalcular quando uma categoria abre ou fecha.
  /* eslint-disable react-hooks/exhaustive-deps */
  const lancaveis = useMemo(() => itensLancaveis(todos, grupos, RELOGIO), [todos, grupos, agora])
  const resumo = useMemo(() => resumoIndisponibilidade(todos, grupos, RELOGIO), [todos, grupos, agora])
  const foraDoHorario = useMemo(
    () => grupos.filter((g) => !grupoEstaAtivoAgora(g) && todos.some((i) => i.grupoId === g.id && i.status === 'disponivel')),
    [grupos, todos, agora],
  )
  /* eslint-enable react-hooks/exhaustive-deps */
  const categorias = useMemo(() => categoriasComItens(grupos, lancaveis), [grupos, lancaveis])
  // A categoria aberta é sempre uma que tem item: a escolhida, se ainda vale; senão a
  // primeira disponível. Cobre a abertura da tela e a categoria que fecha com ela aberta.
  const categoriaAberta = categoriaAtivaValida(categoriaAtiva, categorias)
  const nomeCategoria = useMemo(() => new Map(grupos.map((g) => [g.id, g.nome])), [grupos])
  const buscando = busca.trim().length > 0
  const visiveis = useMemo(
    () => (buscando ? buscarItens(lancaveis, busca) : lancaveis.filter((i) => i.grupoId === categoriaAberta)),
    [lancaveis, busca, buscando, categoriaAberta],
  )

  // Linha cujo item saiu do ar depois de entrar no lançamento: marcada, e o envio trava.
  const linhas = useMemo(
    () =>
      lancamento.map((l) => {
        if (l.indisponivel) return l
        const m = motivoIndisponivel(todos.find((i) => i.id === l.itemId), grupos, RELOGIO)
        return m ? { ...l, indisponivel: `Indisponível agora: ${TEXTO_MOTIVO[m]}.` } : l
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lancamento, todos, grupos, agora],
  )
  const bloqueio = bloqueioDoEnvio(linhas, enviando)
  const resumoLancamento = totalDoLancamento(linhas)
  const totalComanda = calcularTotalComanda(pedidos)
  const qtdNoLancamento = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of lancamento) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.quantidade)
    return m
  }, [lancamento])

  // ── seleção do cliente → lançamento ───────────────────────────────────────
  /* eslint-disable react-hooks/exhaustive-deps */
  const resolucoes = useMemo(
    () => new Map(selecaoCliente.map((s) => [s.chave, resolverDaSelecao(s, todos, grupos, RELOGIO)])),
    [selecaoCliente, todos, grupos, agora],
  )
  /* eslint-enable react-hooks/exhaustive-deps */
  const adicionadas = useMemo(
    () => new Set(lancamento.map((l) => l.origemSelecao).filter((x): x is string => !!x)),
    [lancamento],
  )

  // Desktop abre a seleção quando o cliente marca algo; no celular ela fica recolhida numa
  // faixa de uma linha (com a contagem) para não empurrar o cardápio para baixo.
  const qtdSelecao = selecaoCliente.length
  useEffect(() => {
    const largo = typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
    if (largo && qtdSelecao > 0) setSelecaoAberta(true)
  }, [qtdSelecao])

  /** Adiciona uma linha da seleção. Devolve o que aconteceu, para o aviso agrupado. */
  function adicionarDaSelecao(chave: string, abrirConfigurador: boolean): 'ok' | 'preco' | 'configurar' | 'indisponivel' {
    const sel = selecaoCliente.find((s) => s.chave === chave)
    if (!sel || adicionadas.has(chave)) return 'indisponivel'
    const r = resolverDaSelecao(sel, todos, grupos, RELOGIO)
    if (r.tipo === 'indisponivel') return 'indisponivel'
    if (r.tipo === 'configurar') {
      if (abrirConfigurador) setConfigurando({ item: r.item, inicial: r.preescolha, aviso: r.motivo, origemSelecao: chave })
      return 'configurar'
    }
    setLancamento((atual) => adicionarAoLancamento(atual, r.linha))
    return r.precoMudou ? 'preco' : 'ok'
  }

  function adicionarUmaDaSelecao(chave: string) {
    const r = adicionarDaSelecao(chave, true)
    const sel = selecaoCliente.find((s) => s.chave === chave)
    const res = resolucoes.get(chave)
    if (r === 'preco' && sel && res?.tipo === 'pronto') {
      setAvisoSelecao(`"${sel.nome}" entrou com o preço atual: ${brl(res.linha.preco)} cada.`)
    } else if (r === 'ok') {
      setAvisoSelecao(null)
    }
  }

  function adicionarSelecaoToda() {
    let ok = 0
    let preco = 0
    const configurar: string[] = []
    for (const s of selecaoCliente) {
      if (adicionadas.has(s.chave)) continue
      const r = adicionarDaSelecao(s.chave, false)
      if (r === 'ok') ok++
      else if (r === 'preco') { ok++; preco++ }
      else if (r === 'configurar') configurar.push(s.chave)
    }
    const partes = [`${ok} ${ok === 1 ? 'item adicionado' : 'itens adicionados'}.`]
    if (preco > 0) partes.push(`${preco} com preço atualizado.`)
    if (configurar.length > 0) partes.push(`${configurar.length} ${configurar.length === 1 ? 'precisa' : 'precisam'} de escolha: toque em "Configurar".`)
    setAvisoSelecao(partes.join(' '))
    // Um item só a configurar: já abre, é o próximo passo óbvio.
    if (configurar.length === 1) adicionarDaSelecao(configurar[0]!, true)
  }

  // ── lançamento ────────────────────────────────────────────────────────────

  /** Toque no item: simples entra direto com 1; com escolha, abre o configurador. */
  function tocarItem(item: ItemCardapio) {
    if (!itemSimples(item)) {
      setConfigurando({ item })
      return
    }
    setLancamento((atual) =>
      adicionarAoLancamento(atual, {
        chave: crypto.randomUUID(),
        itemId: item.id,
        nome: item.nome,
        preco: precoEstimado(item, { complementos: [] }),
        quantidade: 1,
        observacao: '',
        complementos: [],
      }),
    )
  }

  function confirmarConfigurador(escolha: EscolhaItem, preco: number) {
    if (!configurando) return
    const { item, editar, origemSelecao } = configurando
    if (editar) {
      setLancamento((atual) =>
        atual.map((l) => (l.chave === editar ? { ...l, ...escolha, preco, indisponivel: null } : l)),
      )
    } else {
      setLancamento((atual) =>
        adicionarAoLancamento(atual, { chave: crypto.randomUUID(), itemId: item.id, nome: item.nome, preco, origemSelecao, ...escolha }),
      )
    }
    setConfigurando(null)
  }

  function editarLinha(chave: string) {
    const l = lancamento.find((x) => x.chave === chave)
    const item = l ? todos.find((i) => i.id === l.itemId) : undefined
    if (!l || !item) return
    setConfigurando({ item, inicial: l, editar: chave })
  }

  function mudarQuantidade(chave: string, delta: number) {
    setLancamento((atual) =>
      atual
        .map((x) => (x.chave === chave ? { ...x, quantidade: Math.min(99, x.quantidade + delta) } : x))
        .filter((x) => x.quantidade > 0),
    )
  }

  function removerLinha(chave: string) {
    setLancamento((atual) => atual.filter((x) => x.chave !== chave))
  }

  async function enviarParaCozinha() {
    if (bloqueioDoEnvio(linhas, enviando)) return
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/admin/mesas/${params.id}/lancamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chaveIdempotencia: chaveLancamento,
          selecoesVistas,
          // Só o bloco Lançamento. A seleção do cliente nunca vai junto.
          itens: linhas.map((l) => ({
            itemId: l.itemId,
            quantidade: l.quantidade,
            observacao: l.observacao,
            complementos: l.complementos.map((c) => c.nome),
            ...(l.tamanhoNome ? { tamanhoNome: l.tamanhoNome } : {}),
            ...(l.saborNome ? { saborNome: l.saborNome } : {}),
            ...(l.bordaNome ? { bordaNome: l.bordaNome } : {}),
            ...(l.massaNome ? { massaNome: l.massaNome } : {}),
          })),
        }),
      })
      const corpo = await res.json()
      if (!res.ok && corpo.codigo === 'mesa_sem_atendimento') {
        setAbrindoMesa(true)
        return
      }
      if (!res.ok && corpo.codigo === 'comanda_sem_nome' && corpo.comandaId) {
        setIdentificandoComanda(corpo.comandaId as string)
        return
      }
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
      setAvisoSelecao(null)
      setFolhaAberta(false)
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

  // Caixa não tem aba de lançar: abre direto na conta. Só decide DEPOIS de saber as
  // permissões — antes, `podeLancar` é false por falha fechada, e sem esta guarda o
  // garçom (o caso comum) cairia na Conta e teria de voltar para Lançar na mão.
  useEffect(() => {
    if (permissoesCarregadas && !podeLancar && aba === 'lancar') setAba('conta')
  }, [permissoesCarregadas, podeLancar, aba])

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

  const naAbaLancar = aba === 'lancar' && podeLancar
  const painel = (classeLista: string) => (
    <PainelLancamento
      linhas={linhas}
      erro={erro}
      bloqueio={bloqueio}
      enviando={enviando}
      classeLista={classeLista}
      onQuantidade={mudarQuantidade}
      onEditar={editarLinha}
      onRemover={removerLinha}
      onEnviar={enviarParaCozinha}
    />
  )

  return (
    <>
      <TopBar
        title={mesa.nome}
        breadcrumb={`Mesas e Comandas · ${mesa.setor || 'Salão'}`}
        voltar={{ rotulo: 'Salão', onClick: () => router.push('/admin/mesas') }}
        right={
          <div className="flex items-center gap-2">
            {permissoesConta.transferir_mesa && estadoConta.dados?.conta ? (
              <Button variant="outline" onClick={() => setTransferindoMesa(true)} aria-label="Trocar de mesa" title="Trocar de mesa">
                <ArrowRightLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Trocar de mesa</span>
              </Button>
            ) : null}
            <BotaoTelaCheia />
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-3 sm:p-5">
        {podeAtenderChamado && <PainelChamados chamados={chamados} agora={agora} onMudou={() => void carregar()} />}

        {somenteVisualizacao && (
          <div
            className="mb-3 flex items-start gap-2.5 rounded-menuzia border border-warn bg-warn-bg px-4 py-3 sm:mb-4"
            role="status"
            data-aviso-somente-visualizacao
          >
            <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-warn" aria-hidden />
            <span>
              <span className="block text-[13px] font-bold text-text-main">
                Cardápio da mesa em somente visualização
              </span>
              <span className="block text-[12px] leading-relaxed text-text-subtle">
                O QR desta loja é só para o cliente ver o cardápio. Ele não monta seleção, não chama o garçom e não
                pede a conta pela tela — não há pedido para tirar aqui. Para voltar a atender pela mesa, desligue o
                modo em <strong className="text-text-main">Ajustes › Mesas</strong>.
              </span>
            </span>
          </div>
        )}

        {avisoPagina && (
          <p className="mb-3 flex items-center justify-between gap-2 rounded-menuzia bg-alert-bg px-4 py-2.5 text-[13px] text-alert-text" role="status">
            {avisoPagina}
            <button aria-label="Dispensar aviso" onClick={() => setAvisoPagina(null)}>
              <X className="h-4 w-4" />
            </button>
          </p>
        )}

        {abrindoMesa && (
          <AbrirMesaModal
            mesa={mesa}
            onFechar={() => setAbrindoMesa(false)}
            onAberta={() => {
              setAbrindoMesa(false)
              void estadoConta.recarregar().then(() => enviarParaCozinha())
            }}
            onOcupada={() => {
              setAbrindoMesa(false)
              void estadoConta.recarregar()
              setErro('Outro atendente acabou de abrir esta mesa. Confira a conta e envie de novo.')
            }}
          />
        )}
        {identificandoComanda && (
          <IdentificarModal
            comandaId={identificandoComanda}
            titulo="Nome do cliente"
            aviso="Esta conta foi aberta sem o nome do cliente. Informe o nome para lançar."
            nomeAtual={null}
            telefoneAtual={null}
            onFechar={() => setIdentificandoComanda(null)}
            onSalvo={() => {
              setIdentificandoComanda(null)
              void enviarParaCozinha()
            }}
          />
        )}
        {vendoLimpeza && mesa.limpeza && (
          <LimpezaModal
            mesa={mesa}
            podeLiberar
            onFechar={() => setVendoLimpeza(false)}
            onLiberada={() => {
              setVendoLimpeza(false)
              void carregar()
            }}
          />
        )}
        {mesa.limpeza && !estadoConta.dados?.conta && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-menuzia border border-status-pending/40 bg-white px-4 py-3 text-[13px] text-text-main" data-mesa-limpeza>
            <span className="flex-1">
              Conta fechada{mesa.limpeza.clienteNome ? ` (${mesa.limpeza.clienteNome})` : ''}. Mesa em limpeza: não abre atendimento até ser liberada.
            </span>
            <Button variant="success" onClick={() => setVendoLimpeza(true)} data-testid="mesa-ver-limpeza">
              Tornar mesa disponível
            </Button>
          </div>
        )}

        {/* ── Resumo da mesa: o estado de relance, na cor do salão ─────────── */}
        {(() => {
          const conta = estadoConta.dados?.conta ?? null
          // Mesmo vocabulário do salão e do PDV: conta aberta sem lançamento é
          // "Aguardando", não "Ocupada" (ver lib/queries/mesas.ts).
          const estado = estadoDaMesa(mesa, {
            aberta: !!conta,
            qtdPedidos: conta?.lancamentos?.length ?? 0,
          })
          const cor = { livre: 'bg-status-ready', aguardando: 'bg-status-preparing', ocupada: 'bg-primary', limpeza: 'bg-status-pending', bloqueada: 'bg-sidebar-bg', inativa: 'bg-border' }[estado]
          const estadoTexto = ROTULO_ESTADO[estado]
          return (
            <div className={`mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-menuzia px-4 py-3 text-white shadow-sm sm:mb-4 ${cor}`} data-resumo-mesa>
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full bg-white/20">
                  <Utensils className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">{estadoTexto}</div>
                  <div className="truncate text-[18px] font-extrabold leading-tight">
                    {mesa.nome}
                    {conta?.numero ? <span className="ml-2 text-[13px] font-semibold opacity-85">Comanda #{conta.numero}</span> : null}
                  </div>
                  {conta && <div className="text-[11px] opacity-85">Aberta {esperaTexto(conta.abertaEm, agora)}</div>}
                </div>
              </div>
              {conta && (
                <div className="ml-auto flex items-center gap-2">
                  <div className="rounded-menuzia bg-white/15 px-3 py-1.5 text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wide opacity-80">Total</div>
                    <div className="text-[15px] font-extrabold">{brl(conta.totais.total)}</div>
                  </div>
                  <div className={`rounded-menuzia px-3 py-1.5 text-right ${conta.totais.restante > 0 ? 'bg-white text-text-main' : 'bg-white/15'}`}>
                    <div className="text-[10px] font-bold uppercase tracking-wide opacity-70">Falta pagar</div>
                    <div className={`text-[15px] font-extrabold ${conta.totais.restante > 0 ? 'text-danger' : ''}`}>{brl(conta.totais.restante)}</div>
                  </div>
                </div>
              )}
            </div>
          )
        })()}

        {/* Falha fechada: as abas só aparecem quando se sabe o que este papel pode. O
            espaço fica reservado para a barra não empurrar o conteúdo ao chegar. */}
        {!permissoesCarregadas && (
          <div className="mb-3 flex min-h-[52px] items-center rounded-menuzia bg-main px-4 text-[12px] text-text-subtle shadow-sm sm:mb-4" role="status">
            Carregando…
          </div>
        )}

        {permissoesCarregadas && (
        <div className="mb-3 grid grid-flow-col auto-cols-fr gap-1.5 rounded-menuzia bg-main p-1 shadow-sm sm:mb-4 sm:inline-grid" role="tablist">
          {([
            ['lancar', 'Lançar', ShoppingBag, 'bg-primary'],
            ['conta', 'Conta', Receipt, 'bg-status-ready'],
            ['historico', 'Histórico', History, 'bg-purple'],
          ] as const).filter(([id]) => id !== 'lancar' || podeLancar).map(([id, rotulo, Icone, cor]) => (
            <button
              key={id}
              role="tab"
              aria-selected={aba === id}
              onClick={() => setAba(id)}
              className={[
                'flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap rounded-menuzia px-3 text-[12px] font-bold uppercase tracking-wide transition-colors sm:px-5 lg:min-h-[40px]',
                aba === id ? `${cor} text-white shadow-sm` : 'text-text-subtle hover:bg-page hover:text-text-main',
              ].join(' ')}
            >
              <Icone className="h-4 w-4" />
              {rotulo}
            </button>
          ))}
        </div>
        )}

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

        {aba === 'historico' && <Historico eventos={estadoConta.dados?.historico ?? []} lancamentos={estadoConta.dados?.conta?.lancamentos ?? []} />}

        <div className={`grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start ${naAbaLancar ? '' : 'hidden'}`}>
          {/* ── Catálogo: o garçom escolhe à mão ─────────────────────────── */}
          <section className="min-w-0 space-y-3">
            {/* No modo só-visualização o cliente nunca marca nada: a faixa "ainda não
                marcou" viraria ruído permanente. O aviso do topo já explica a tela. */}
            {!somenteVisualizacao && (
              <SelecaoDoCliente
                linhas={selecaoCliente}
                resolucoes={resolucoes}
                adicionadas={adicionadas}
                aberto={selecaoAberta}
                aviso={avisoSelecao}
                onAlternar={() => setSelecaoAberta((a) => !a)}
                onAdicionar={adicionarUmaDaSelecao}
                onAdicionarTodas={adicionarSelecaoToda}
              />
            )}

            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar em todo o cardápio…"
                aria-label="Buscar item"
                type="search"
                className="h-[44px] w-full rounded-menuzia border border-border bg-main pl-9 pr-3 text-[13px] outline-none focus:border-primary lg:h-[38px]"
              />
            </label>

            {categorias.length > 0 && !buscando && (
              // Único ponto com rolagem lateral da tela: os chips das categorias.
              <div className="-mx-3 overflow-x-auto px-3 [scrollbar-width:none] sm:-mx-5 sm:px-5 xl:mx-0 xl:px-0 [&::-webkit-scrollbar]:hidden" role="tablist" aria-label="Categorias">
                <div className="flex w-max gap-1.5 pb-0.5 xl:w-auto xl:flex-wrap">
                  {categorias.map((g) => (
                    <button
                      key={g.id}
                      role="tab"
                      aria-selected={g.id === categoriaAberta}
                      onClick={() => setCategoriaAtiva(g.id)}
                      className={[
                        'min-h-[40px] whitespace-nowrap rounded-menuzia border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-colors lg:min-h-[34px]',
                        g.id === categoriaAberta
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-main text-text-subtle hover:text-text-main',
                      ].join(' ')}
                    >
                      {g.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {lancaveis.length === 0 ? (
              <SemItens resumo={resumo} foraDoHorario={foraDoHorario} />
            ) : (
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4">
                {visiveis.map((item) => (
                  <CardProduto
                    key={item.id}
                    item={item}
                    categoria={buscando ? nomeCategoria.get(item.grupoId ?? '') : undefined}
                    noLancamento={qtdNoLancamento.get(item.id) ?? 0}
                    onTocar={() => tocarItem(item)}
                  />
                ))}
                {visiveis.length === 0 && (
                  <p className="col-span-full py-6 text-center text-[13px] text-text-subtle">
                    {buscando ? `Nenhum item disponível com “${busca.trim()}”.` : 'Nenhum item nesta categoria agora.'}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── Lançamento (desktop) + já lançado ────────────────────────── */}
          <aside className="space-y-4 xl:sticky xl:top-0">
            <div className="hidden rounded-menuzia border border-border bg-main xl:block">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-[13px] font-bold text-text-main">Lançamento</h3>
                <p className="text-[11px] text-text-subtle">Confira antes de enviar. Depois vai direto pra cozinha.</p>
              </div>
              {painel('max-h-[46vh]')}
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

      {/* ── Barra do lançamento (celular/tablet) ───────────────────────────── */}
      {naAbaLancar && (
        <div
          data-barra-lancamento
          className="flex flex-shrink-0 items-center gap-2 border-t border-border bg-main px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)] shadow-[0_-2px_8px_rgba(0,0,0,0.06)] sm:gap-3 xl:hidden"
        >
          <button
            onClick={() => router.push('/admin/mesas')}
            aria-label="Voltar para as mesas"
            data-voltar-mesas
            className="flex h-[44px] flex-shrink-0 items-center gap-1 rounded-menuzia border border-border px-2.5 text-[13px] font-semibold text-text-main hover:border-primary hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Mesas</span>
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] text-text-subtle">
              {resumoLancamento.itens === 0
                ? 'Lançamento vazio'
                : `${resumoLancamento.itens} ${resumoLancamento.itens === 1 ? 'item' : 'itens'} no lançamento`}
            </div>
            <div className="text-[16px] font-bold text-price-text">{brl(resumoLancamento.total)}</div>
          </div>
          <Button className="min-h-[44px]" onClick={() => setFolhaAberta(true)}>
            <ShoppingBag className="h-4 w-4" />
            <span className="hidden min-[400px]:inline">Ver lançamento</span>
            <span className="min-[400px]:hidden">Ver</span>
            {resumoLancamento.itens > 0 && (
              <span className="grid h-[20px] min-w-[20px] place-items-center rounded-full bg-white px-1 text-[11px] font-bold text-primary">{resumoLancamento.itens}</span>
            )}
          </Button>
        </div>
      )}

      {/* Conferência antes de enviar: janela grande no centro da tela, não folha no rodapé. */}
      {folhaAberta && naAbaLancar && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 pt-[max(env(safe-area-inset-top),0.75rem)] pb-[max(env(safe-area-inset-bottom),0.75rem)] xl:hidden"
          onClick={() => setFolhaAberta(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Lançamento"
            className="flex max-h-full min-h-[min(60dvh,100%)] w-full max-w-lg flex-col overflow-hidden rounded-menuzia bg-main shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex min-h-[56px] flex-shrink-0 items-center justify-between gap-2 border-b border-border py-2 pl-4 pr-2">
              <div className="min-w-0">
                <h3 className="truncate text-[15px] font-bold text-text-main">Lançamento · {mesa.nome}</h3>
                <p className="truncate text-[11px] text-text-subtle">Confira antes de enviar para a cozinha.</p>
              </div>
              <button onClick={() => setFolhaAberta(false)} className="grid h-[44px] w-[44px] flex-shrink-0 place-items-center text-text-subtle" aria-label="Fechar o lançamento">
                <X className="h-5 w-5" />
              </button>
            </div>
            {painel('flex-1')}
          </div>
        </div>
      )}

      {configurando && (
        <ConfiguradorGarcom
          key={configurando.editar ?? configurando.item.id}
          item={configurando.item}
          pizza={pizza}
          inicial={configurando.inicial}
          aviso={configurando.aviso}
          modo={configurando.editar ? 'editar' : 'adicionar'}
          onCancelar={() => setConfigurando(null)}
          onConfirmar={confirmarConfigurador}
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
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <Button className="min-h-[44px] w-full" onClick={() => router.push('/admin/mesas')} data-enviado-voltar-mesas>
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar às mesas
              </Button>
              <Button variant="outline" className="min-h-[44px] w-full" onClick={() => setEnviado(null)}>
                Continuar nesta mesa
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
