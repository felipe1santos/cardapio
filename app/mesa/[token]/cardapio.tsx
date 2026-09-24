'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MOTIVOS_CHAMADO, type MotivoChamado } from '@/lib/chamados'
import { descricaoEmTextoPuro, pedacosDaDescricao } from '@/lib/descricao-rica'
import { etiquetaDoItem } from '@/lib/etiqueta-item'
import { adicionarNaSelecao } from '@/lib/selecao-mesa'
import { precificarLinha, type ItemPrecificavel, type OpcaoDaLinha, type PizzaDaLoja, type TipoOpcao } from '@/lib/selecao-preco'
import { tamanhosVendidosDaPizza } from '@/lib/pizza-tamanhos'

/**
 * Cardápio presencial da mesa.
 *
 * O sistema visual vem das referências em `docs/referencias/autoatendimento/`: cabeçalho
 * coral, trilho de categorias à esquerda, banner com o título da seção, cards
 * horizontais com foto, e o configurador em etapas numeradas (etapa atual em coral,
 * concluídas em azul-marinho, futuras discretas; botão cinza enquanto a escolha
 * obrigatória não está válida, verde quando está).
 *
 * O que esta tela NÃO tem, de propósito: checkout, pagamento, entrega, retirada,
 * endereço, frete, cupom e fidelidade. O cliente monta uma lista para mostrar ao garçom.
 * Nenhum botão aqui envia pedido — quem lança é o garçom, manualmente, no painel dele.
 */

// ── tipos que a página de servidor entrega ──────────────────────────────────

export interface ComplementoDaMesa {
  id: string
  nome: string
  preco: number
  imagemUrl: string | null
}

export interface GrupoOpcoes {
  id: string
  nome: string
  obrigatorio: boolean
  minEscolhas: number
  maxEscolhas: number
  complementos: ComplementoDaMesa[]
}

export interface ItemDaMesa {
  id: string
  grupoId: string | null
  nome: string
  descricao: string
  preco: number
  precoOriginal: number | null
  imagemUrl: string | null
  grupos: GrupoOpcoes[]
  tamanhos: { id: string; nome: string; preco: number }[]
  /** 'pizza' = monta por tamanho padrão + sabor(es) + borda/massa. */
  tipoItem: string
  /** Sabores disponíveis. `precos` = id do tamanho padrão → preço da pizza inteira. */
  sabores: { nome: string; descricao: string; precos: Record<string, number> }[]
  /** Pizza: tamanhos da loja desligados neste item (0097). */
  pizzaTamanhosOcultos?: string[]
  /** Menor preço possível (tamanho/sabor mais barato) — o "a partir de" do cartão. */
  precoAPartirDe: number
  /** Etiqueta do cadastro ('mais_pedido', 'novo'…). Null = sem etiqueta marcada. */
  tag: string | null
  /** "Item em destaque" do cadastro, que vira a etiqueta de mais pedido. */
  maisVendido: boolean
}

export interface CategoriaDaMesa {
  id: string
  nome: string
  imagemUrl: string | null
}

interface Props {
  token: string
  mesaNome: string
  sessaoId: string
  loja: { nome: string; logoUrl: string | null; bannerUrl: string | null }
  grupos: CategoriaDaMesa[]
  itens: ItemDaMesa[]
  pizza: PizzaDaLoja
  /** Imagens do carrossel do topo (0073). Vazio = banner da loja. */
  carrossel: string[]
  /** Aviso da seleção — texto da loja ou o padrão. */
  mensagem: string
  /**
   * Modo "somente visualização" (0075): o cliente só vê o cardápio. Sem seleção, sem
   * sacola, sem tamanho/adicionais — tocar num item abre a foto inteira e a descrição
   * (e os sabores, na pizza).
   */
  somenteVisualizacao: boolean
}

type OpcaoEscolhida = OpcaoDaLinha

/** Texto da opção na lista: "Borda Catupiry", "Massa Integral", o resto como veio. */
function rotuloOpcao(o: OpcaoEscolhida): string {
  if (o.tipo === 'borda') return `Borda ${o.escolha}`
  if (o.tipo === 'massa') return `Massa ${o.escolha}`
  return o.escolha
}

/** Item marcado em outro celular da mesma mesa. Sem dono identificável. */
interface LinhaDeOutro {
  nome: string
  quantidade: number
  precoUnitario: number
  observacao: string
  opcoes: OpcaoEscolhida[]
}

interface LinhaSelecionada {
  chave: string
  itemId: string
  nome: string
  imagemUrl: string | null
  precoUnitario: number
  quantidade: number
  observacao: string
  opcoes: OpcaoEscolhida[]
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Identificador do aparelho. Não identifica pessoa — só separa as listas na mesma mesa. */
function idDoDispositivo(): string {
  const chave = 'menuzia:mesa:dispositivo'
  try {
    const salvo = localStorage.getItem(chave)
    if (salvo) return salvo
    const novo = crypto.randomUUID()
    localStorage.setItem(chave, novo)
    return novo
  } catch {
    return crypto.randomUUID()
  }
}

const totalDaLinha = (l: LinhaSelecionada) =>
  (l.precoUnitario + l.opcoes.reduce((s, o) => s + o.preco, 0)) * l.quantidade

export function CardapioDaMesa({ token, mesaNome, loja, grupos, itens, pizza, carrossel, mensagem, somenteVisualizacao }: Props) {
  const [categoriaAtiva, setCategoriaAtiva] = useState<string | null>(grupos[0]?.id ?? null)
  const [busca, setBusca] = useState('')
  const [fichaAberta, setFichaAberta] = useState<ItemDaMesa | null>(null)
  const [selecao, setSelecao] = useState<LinhaSelecionada[]>([])
  const [painelAberto, setPainelAberto] = useState(false)
  const [concluida, setConcluida] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  // O garçom enviou o pedido e encerrou este ciclo: a lista volta vazia e o cliente é
  // avisado, em vez de ver os itens sumirem sem explicação.
  const [cicloEncerrado, setCicloEncerrado] = useState(false)
  // A conta desta mesa foi levada para outra mesa pelo garçom. Guarda só o nome da nova.
  const [mesaMudouPara, setMesaMudouPara] = useState<string | null>(null)
  // O que os OUTROS celulares da mesa marcaram. Só leitura: cada aparelho edita a sua
  // lista, mas a mesa precisa ver o conjunto — senão duas pessoas pedem a mesma coisa.
  const [deOutros, setDeOutros] = useState<LinhaDeOutro[]>([])
  const sessaoConhecida = useRef<string | null>(null)
  const dispositivo = useRef<string>('')
  // Id do rascunho aberto no servidor. Tinha id e o servidor passou a responder `null` =
  // o ciclo encerrou.
  const idSelecao = useRef<string | null>(null)
  // Enquanto uma gravação está em voo, a leitura periódica não sobrescreve a tela — senão
  // o item que o cliente acabou de marcar sumiria e voltaria.
  const gravando = useRef(false)
  const qtdNaTela = useRef(0)

  const imagemDoItem = useMemo(() => new Map(itens.map((i) => [i.id, i.imagemUrl])), [itens])

  /** Traz a lista deste aparelho do servidor e aplica na tela. */
  const lerDoServidor = useCallback(async () => {
    if (!dispositivo.current || gravando.current) return
    try {
      const sessaoParam = sessaoConhecida.current ? `&sessao=${sessaoConhecida.current}` : ''
      const r = await fetch(`/api/mesa/${token}/selecao?dispositivo=${dispositivo.current}${sessaoParam}`, { cache: 'no-store' })
      if (!r.ok || gravando.current) return
      const corpo = (await r.json()) as {
        id: string | null
        sessao?: string
        mesaMudouPara?: string | null
        itens: { itemId: string | null; nome: string; precoUnitario: number; quantidade: number; observacao: string; opcoes: OpcaoEscolhida[] }[]
        deOutros?: LinhaDeOutro[]
      }
      setDeOutros(corpo.deOutros ?? [])

      if (corpo.mesaMudouPara) {
        setMesaMudouPara(corpo.mesaMudouPara)
      } else if (idSelecao.current && corpo.id === null && qtdNaTela.current > 0) {
        setCicloEncerrado(true)
      }
      if (corpo.sessao) sessaoConhecida.current = corpo.sessao
      idSelecao.current = corpo.id

      const linhas: LinhaSelecionada[] = corpo.itens
        .filter((i) => i.itemId)
        .map((i, idx) => ({
          // A posição entra na chave porque a lista pode chegar do servidor com linhas
          // repetidas (gravadas antes do agrupamento, ou por outra aba) — elas são
          // juntadas logo abaixo, mas não podem colidir como chave do React antes disso.
          chave: `${idx}-${i.itemId}-${i.quantidade}-${i.opcoes.map((o) => o.escolha).join('|')}`,
          itemId: i.itemId as string,
          nome: i.nome,
          imagemUrl: imagemDoItem.get(i.itemId as string) ?? null,
          precoUnitario: i.precoUnitario,
          quantidade: i.quantidade,
          observacao: i.observacao,
          opcoes: i.opcoes,
        }))
        // Lista gravada antes do agrupamento chega com o mesmo item em várias linhas;
        // juntar aqui também arruma o que já estava salvo na mesa.
        .reduce<LinhaSelecionada[]>((acc, l) => adicionarNaSelecao(acc, l), [])
      qtdNaTela.current = linhas.length
      setSelecao(linhas)
    } catch {
      // Sem rede: fica o que já está na tela.
    }
  }, [token, imagemDoItem])

  // Ao abrir a página (ou recarregar), a seleção volta do servidor — não se perde no F5.
  // Depois, releitura periódica e ao voltar para a aba: mantém várias abas do mesmo
  // aparelho iguais e mostra quando o garçom encerrou o ciclo.
  useEffect(() => {
    if (somenteVisualizacao) return
    dispositivo.current = idDoDispositivo()
    void lerDoServidor()
    const t = setInterval(() => void lerDoServidor(), 5000)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void lerDoServidor()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [lerDoServidor, somenteVisualizacao])

  /**
   * A loja liga e desliga "somente visualização" com celulares já na mesa. A tela
   * pergunta o modo de tempos em tempos (e ao voltar para a aba) e se recarrega quando
   * ele muda — senão o cliente ficaria montando uma seleção que a rota recusa, ou
   * preso no cardápio de consulta numa loja que voltou a atender pela mesa.
   *
   * Intervalo folgado de propósito: é uma troca rara, e cada mesa tem vários celulares.
   */
  useEffect(() => {
    let vivo = true
    const conferir = async () => {
      try {
        const r = await fetch(`/api/mesa/${token}/modo`, { cache: 'no-store' })
        if (!r.ok || !vivo) return
        const corpo = (await r.json()) as { somenteVisualizacao?: boolean }
        if (vivo && corpo.somenteVisualizacao !== undefined && corpo.somenteVisualizacao !== somenteVisualizacao) {
          window.location.reload()
        }
      } catch {
        // Sem rede: continua no modo em que está. A rota recusa o que não pode.
      }
    }
    const t = setInterval(() => void conferir(), 60000)
    const aoVoltar = () => {
      if (document.visibilityState === 'visible') void conferir()
    }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      vivo = false
      clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [token, somenteVisualizacao])

  /**
   * Guarda a lista no servidor para o garçom poder consultá-la de outro aparelho.
   * É rascunho: a rota só grava `selecao_itens` e nunca cria pedido.
   */
  const sincronizar = useCallback(
    async (itensAtuais: LinhaSelecionada[]) => {
      if (!dispositivo.current) return
      gravando.current = true
      setSincronizando(true)
      try {
        const r = await fetch(`/api/mesa/${token}/selecao`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dispositivo: dispositivo.current,
            itens: itensAtuais.map((l) => ({
              itemId: l.itemId,
              quantidade: l.quantidade,
              observacao: l.observacao,
              opcoes: l.opcoes,
            })),
          }),
        })
        if (r.ok) {
          const corpo = (await r.json()) as { id: string | null }
          idSelecao.current = corpo.id
        }
      } catch {
        // Sem rede a lista continua na tela — é o que o cliente mostra ao garçom.
      } finally {
        gravando.current = false
        setSincronizando(false)
      }
    },
    [token],
  )

  function atualizarSelecao(proxima: LinhaSelecionada[]) {
    qtdNaTela.current = proxima.length
    setSelecao(proxima)
    void sincronizar(proxima)
  }

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    if (termo) {
      return itens.filter(
        // Busca no texto sem as marcações: quem procura "copo" acha o item cuja
        // descrição é `[[roxo|b]]copo de brinde[[/]]`.
        (i) => i.nome.toLowerCase().includes(termo) || descricaoEmTextoPuro(i.descricao).toLowerCase().includes(termo),
      )
    }
    return itens.filter((i) => i.grupoId === categoriaAtiva)
  }, [itens, categoriaAtiva, busca])

  const categoriaAtual = grupos.find((g) => g.id === categoriaAtiva)
  const totalSelecao = selecao.reduce((s, l) => s + totalDaLinha(l), 0)
  const qtdSelecao = selecao.reduce((s, l) => s + l.quantidade, 0)

  return (
    <div className="mesa-raiz">
      <style>{TOKENS}</style>

      {/* ── Cabeçalho ───────────────────────────────────────────────────── */}
      <header className="mesa-cabecalho">
        <div className="mesa-marca">
          {loja.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={loja.logoUrl} alt={loja.nome} className="mesa-logo" />
          ) : (
            <div className="mesa-logo mesa-logo-vazia">{loja.nome.charAt(0)}</div>
          )}
          <span className="mesa-nome-loja">{loja.nome}</span>
        </div>

        <label className="mesa-busca">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 2a8 8 0 105.3 14l5.4 5.4 1.4-1.4-5.4-5.4A8 8 0 0010 2zm0 2a6 6 0 110 12 6 6 0 010-12z" />
          </svg>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar no cardápio"
            aria-label="Buscar no cardápio"
          />
        </label>

        <div className="mesa-acoes">
          <span className="mesa-etiqueta" title="Você está nesta mesa">
            {mesaNome}
          </span>
          {/* Só visualização = cardápio de consulta: nem seleção, nem chamar o garçom.
              O cliente chama pelo salão; o botão aqui só geraria chamado sem contexto. */}
          {!somenteVisualizacao && <ChamarGarcom token={token} />}
          {!somenteVisualizacao && (
          <button className="mesa-botao-selecao" onClick={() => setPainelAberto(true)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h10l1 3h3v2h-1.2l-1.3 11.1A2 2 0 0 1 16.5 22h-9a2 2 0 0 1-2-1.9L4.2 9H3V7h3l1-3zm2 3h6l-.4-1H9.4L9 7z" />
            </svg>
            <span className="mesa-botao-texto">Minha seleção</span>
            {qtdSelecao > 0 && <span className="mesa-contador">{qtdSelecao}</span>}
          </button>
          )}
        </div>
      </header>

      <div className="mesa-corpo">
        {/* ── Trilho de categorias ──────────────────────────────────────── */}
        <nav className="mesa-categorias" aria-label="Categorias">
          {grupos.map((g) => (
            <button
              key={g.id}
              onClick={() => {
                setCategoriaAtiva(g.id)
                setBusca('')
              }}
              className={`mesa-categoria ${g.id === categoriaAtiva && !busca ? 'ativa' : ''}`}
            >
              <span className="mesa-categoria-icone">
                {g.imagemUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={g.imagemUrl} alt="" />
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M8.1 2v8.2a2.9 2.9 0 0 1-2 2.8V22H4.5v-9A2.9 2.9 0 0 1 2.5 10.2V2H4v7.4h1.3V2h1.5v7.4H8V2h.1zm7.3 0c-1.9 0-3.4 2.7-3.4 6 0 2.4.8 4.4 2 5.3V22h1.6v-8.7c1.2-.9 2-2.9 2-5.3 0-3.3-1.5-6-2.2-6z" />
                  </svg>
                )}
              </span>
              <span className="mesa-categoria-nome">{g.nome}</span>
            </button>
          ))}
        </nav>

        {/* ── Conteúdo ──────────────────────────────────────────────────── */}
        <main className="mesa-conteudo">
          <div className="mesa-banner">
            {carrossel.length > 0 ? (
              <Carrossel imagens={carrossel} />
            ) : loja.bannerUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={loja.bannerUrl} alt="" className="mesa-banner-foto" />
            ) : (
              <div className="mesa-banner-foto mesa-banner-vazio" />
            )}
            <div className="mesa-banner-texto">
              <span className="mesa-banner-titulo">{busca ? 'Resultado da busca' : categoriaAtual?.nome ?? 'Cardápio'}</span>
              <span className="mesa-banner-sub">
                {somenteVisualizacao
                  ? 'Veja o cardápio e peça ao garçom'
                  : 'Escolha o que quiser e mostre a lista ao garçom'}
              </span>
            </div>
          </div>

          <div className="mesa-grade">
            {visiveis.map((item) => (
              // O cartão inteiro abre o item: um toque, sem botão separado.
              <button
                type="button"
                key={item.id}
                className="mesa-card"
                onClick={() => setFichaAberta(item)}
                aria-label={somenteVisualizacao ? `Ver ${item.nome}` : `Escolher ${item.nome}`}
              >
                <div className="mesa-card-texto">
                  {/* A mesma etiqueta do delivery, com a mesma cor: o cliente sentado
                      precisa ver promoção e destaque como quem pede pelo celular. */}
                  <Etiqueta item={item} />
                  <h3>{item.nome}</h3>
                  <DescricaoDoItem texto={item.descricao} />
                  <div className="mesa-card-rodape">
                    <div className="mesa-preco">
                      <span className="mesa-preco-rotulo">A partir de</span>
                      <span className="mesa-preco-valor">{brl(item.precoAPartirDe)}</span>
                    </div>
                  </div>
                </div>
                <div className="mesa-card-foto">
                  {item.imagemUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imagemUrl} alt={item.nome} loading="lazy" />
                  ) : (
                    <div className="mesa-card-foto-vazia" aria-hidden="true">
                      🍽️
                    </div>
                  )}
                  {!somenteVisualizacao && <span className="mesa-card-mais" aria-hidden="true">+</span>}
                </div>
              </button>
            ))}

            {visiveis.length === 0 && (
              <p className="mesa-vazio">
                {busca ? 'Nenhum item encontrado nessa busca.' : 'Nenhum item nesta categoria.'}
              </p>
            )}
          </div>

          {/* Rodapé do cardápio: fecha a lista depois do último item, nos dois modos.
              É onde a loja fala com quem está na mesa — em "só visualização" é o único
              lugar onde esse recado aparece, já que não há painel de seleção. */}
          <div className="mesa-aviso-rodape" role="note">
            <span className="mesa-aviso-icone" aria-hidden="true">i</span>
            <p>{mensagem}</p>
          </div>

          {/* Marca d'água da Menuzia: discreta, no fim do cardápio, sem roubar a cena da loja. */}
          <div className="mesa-marca-dagua" aria-label="Cardápio feito com Menuzia">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon-192.png" alt="" width={22} height={22} />
            <span>menuzia</span>
          </div>
        </main>
      </div>

      {/* ── Barra fixa (celular) ──────────────────────────────────────────── */}
      {!somenteVisualizacao && qtdSelecao > 0 && !painelAberto && !fichaAberta && (
        <button className="mesa-barra-flutuante" onClick={() => setPainelAberto(true)}>
          <span className="mesa-barra-qtd">{qtdSelecao}</span>
          Ver minha seleção
          <span className="mesa-barra-total">{brl(totalSelecao)}</span>
        </button>
      )}

      {fichaAberta && somenteVisualizacao && <FichaVisualizacao item={fichaAberta} onFechar={() => setFichaAberta(null)} />}

      {fichaAberta && !somenteVisualizacao && (
        <Configurador
          item={fichaAberta}
          pizza={pizza}
          onFechar={() => setFichaAberta(null)}
          onAdicionar={(linha) => {
            // Mesmo item, mesmas escolhas: soma na linha que já está na lista, em vez
            // de empilhar "1× Coca" três vezes (ver lib/selecao-mesa.ts).
            atualizarSelecao(adicionarNaSelecao(selecao, linha))
            setFichaAberta(null)
          }}
        />
      )}

      {painelAberto && !somenteVisualizacao && (
        <PainelSelecao
          mensagem={mensagem}
          linhas={selecao}
          deOutros={deOutros}
          total={totalSelecao}
          sincronizando={sincronizando}
          onFechar={() => setPainelAberto(false)}
          onAlterarQtd={(chave, delta) => {
            const proxima = selecao
              .map((l) => (l.chave === chave ? { ...l, quantidade: Math.max(0, l.quantidade + delta) } : l))
              .filter((l) => l.quantidade > 0)
            atualizarSelecao(proxima)
          }}
          onRemover={(chave) => atualizarSelecao(selecao.filter((l) => l.chave !== chave))}
          onLimpar={() => atualizarSelecao([])}
          onConcluir={() => {
            setPainelAberto(false)
            setConcluida(true)
          }}
        />
      )}

      {concluida && <SelecaoSalva onFechar={() => setConcluida(false)} />}

      {mesaMudouPara && (
        <div className="mesa-modal-fundo">
          <div className="mesa-confirmacao" role="alertdialog" aria-labelledby="mesa-mudou-titulo">
            <div className="mesa-confirmacao-icone" aria-hidden="true">⇄</div>
            <h2 id="mesa-mudou-titulo">Sua conta mudou para a {mesaMudouPara}</h2>
            <p>
              O garçom trocou vocês de mesa. <strong>Leia o QR Code da {mesaMudouPara}</strong> para continuar vendo o
              cardápio e montando sua lista por lá.
            </p>
            <button className="mesa-principal" onClick={() => setMesaMudouPara(null)}>
              Entendi
            </button>
          </div>
        </div>
      )}

      {cicloEncerrado && !mesaMudouPara && (
        <div className="mesa-modal-fundo" onClick={() => setCicloEncerrado(false)}>
          <div className="mesa-confirmacao" onClick={(e) => e.stopPropagation()} role="alertdialog" aria-labelledby="ciclo-titulo">
            <div className="mesa-confirmacao-icone" aria-hidden="true">✓</div>
            <h2 id="ciclo-titulo">O garçom já anotou seu pedido</h2>
            <p>
              Sua seleção anterior foi atendida e saiu da lista. <strong>Se quiser pedir mais alguma coisa, é só
              selecionar de novo.</strong>
            </p>
            <button className="mesa-principal" onClick={() => setCicloEncerrado(false)}>
              Começar nova seleção
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Descrição e etiqueta do item ────────────────────────────────────────────

/**
 * Descrição com o negrito e as cores que o lojista marcou no cadastro.
 *
 * O cardápio da mesa mostrava o texto CRU: quem escrevesse `**2 litros**` na
 * descrição via os asteriscos e o `[[roxo]]` na tela, sentado à mesa, enquanto
 * no delivery saía formatado. Mesmo parser da vitrine, e pelo mesmo motivo:
 * nada de `dangerouslySetInnerHTML` — cada pedaço vira um `<span>`, então o que
 * o lojista digita continua sendo texto mesmo que pareça HTML.
 */
function DescricaoDoItem({ texto }: { texto: string }) {
  const pedacos = useMemo(() => pedacosDaDescricao(texto), [texto])
  if (pedacos.length === 0) return null
  return (
    <p>
      {pedacos.map((pedaco, i) => (
        <span key={i} style={{ fontWeight: pedaco.negrito ? 700 : undefined, color: pedaco.cor ?? undefined }}>
          {pedaco.texto}
        </span>
      ))}
    </p>
  )
}

// ── Etiqueta do item ────────────────────────────────────────────────────────

/**
 * Pílula de etiqueta no cartão do item (mais pedido, novo, promoção…).
 *
 * As cores vêm em hex de `lib/etiqueta-item.ts`, e não em classe do Tailwind,
 * porque esta tela tem folha de estilo própria (`TOKENS`) — mas o rótulo e a
 * cor são exatamente os da vitrine.
 */
function Etiqueta({ item }: { item: ItemDaMesa }) {
  const estilo = etiquetaDoItem({
    tag: item.tag,
    promocaoPreco: item.precoOriginal !== null ? item.preco : null,
    maisVendido: item.maisVendido,
  })
  if (!estilo) return null
  return (
    <span className="mesa-item-etiqueta" style={{ background: estilo.fundo, color: estilo.texto }}>
      {estilo.label}
    </span>
  )
}

// ── Chamar garçom ───────────────────────────────────────────────────────────

/**
 * Botão de verdade, não decorativo: grava um chamado ligado à mesa e à sessão, que
 * aparece no painel do salão em tempo real.
 *
 * Nada de pedido aqui. O anti-spam mora no banco (0068) — um chamado aberto por
 * mesa+motivo, carência entre chamados, expiração do abandonado. Esta tela só mostra o
 * que aconteceu: "avisamos", "o garçom está vindo" ou "aguarde X segundos".
 */
function ChamarGarcom({ token }: { token: string }) {
  const [aberto, setAberto] = useState(false)
  const [enviando, setEnviando] = useState<MotivoChamado | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ativos, setAtivos] = useState<{ motivo: string; status: string }[]>([])

  const ler = useCallback(async () => {
    try {
      const r = await fetch(`/api/mesa/${token}/chamado`, { cache: 'no-store' })
      if (!r.ok) return
      const corpo = (await r.json()) as { chamados: { motivo: string; status: string }[] }
      setAtivos(corpo.chamados ?? [])
    } catch {
      // Sem rede: mantém o que já está na tela. O chamado já gravado não se perde.
    }
  }, [token])

  useEffect(() => {
    void ler()
    const t = setInterval(() => void ler(), 10000)
    return () => clearInterval(t)
  }, [ler])

  const assumido = ativos.some((c) => c.status === 'assumido')
  const emEspera = ativos.length > 0

  async function chamar(motivo: MotivoChamado) {
    if (enviando) return
    setEnviando(motivo)
    setAviso(null)
    try {
      const r = await fetch(`/api/mesa/${token}/chamado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      })
      const corpo = (await r.json()) as { ok?: boolean; jaExistia?: boolean; error?: string }
      if (!r.ok) {
        setAviso(corpo.error ?? 'Não foi possível chamar agora. Tente de novo em instantes.')
        return
      }
      setAviso(
        corpo.jaExistia
          ? 'Já avisamos — o garçom está vindo até a sua mesa.'
          : 'Avisamos o garçom. Ele vem até a sua mesa.',
      )
      await ler()
    } catch {
      setAviso('Sem conexão agora. Tente de novo em instantes.')
    } finally {
      setEnviando(null)
    }
  }

  return (
    <>
      <button
        className={`mesa-botao-chamar ${emEspera ? 'chamado' : ''}`}
        onClick={() => {
          setAviso(null)
          setAberto(true)
        }}
        aria-label={emEspera ? 'Garçom já chamado' : 'Chamar o garçom'}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 2a2 2 0 0 1 2 2v.3a7 7 0 0 1 5 6.7v4l1.7 2.3A1 1 0 0 1 19.9 19H4.1a1 1 0 0 1-.8-1.7L5 15v-4a7 7 0 0 1 5-6.7V4a2 2 0 0 1 2-2zm0 20a2.8 2.8 0 0 1-2.7-2h5.4A2.8 2.8 0 0 1 12 22z" />
        </svg>
        <span className="mesa-botao-texto">{emEspera ? (assumido ? 'Já vem' : 'Chamado') : 'Garçom'}</span>
      </button>

      {aberto && (
        <div className="mesa-modal-fundo" onClick={() => setAberto(false)}>
          <div
            className="mesa-chamar-folha"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="chamar-titulo"
          >
            <header>
              <h2 id="chamar-titulo">Chamar o garçom</h2>
              <p>Isso não envia pedido nenhum para a cozinha — só avisa a equipe.</p>
            </header>

            {emEspera && (
              <p className="mesa-chamar-estado">
                {assumido
                  ? 'Um garçom já assumiu o seu chamado e está vindo.'
                  : 'Seu chamado está na fila da equipe.'}
              </p>
            )}

            <div className="mesa-chamar-opcoes">
              {MOTIVOS_CHAMADO.map((m) => {
                const jaAberto = ativos.some((c) => c.motivo === m.id)
                return (
                  <button
                    key={m.id}
                    className={`mesa-chamar-opcao ${jaAberto ? 'aberta' : ''}`}
                    onClick={() => chamar(m.id)}
                    disabled={enviando !== null || jaAberto}
                  >
                    <span className="mesa-chamar-rotulo">{m.rotulo}</span>
                    <span className="mesa-chamar-descricao">
                      {jaAberto ? 'Já avisamos a equipe' : m.descricao}
                    </span>
                  </button>
                )
              })}
            </div>

            {aviso && (
              <p className="mesa-chamar-aviso" role="status">
                {aviso}
              </p>
            )}

            <button className="mesa-secundario" onClick={() => setAberto(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

// ── Carrossel do topo ───────────────────────────────────────────────────────

/** Tempo que cada imagem fica parada antes de deslizar para a próxima. */
const CARROSSEL_INTERVALO_MS = 4000

/**
 * Carrossel do topo: as imagens ficam lado a lado numa faixa que desliza sozinha para a
 * esquerda. Depois da última vem de novo a primeira, sem voltar rebobinando (a faixa tem
 * uma cópia da primeira no fim e salta para o início sem animação).
 *
 * Pausa com a aba escondida e enquanto o dedo está na imagem; deslizar com o dedo e os
 * pontos trocam na hora. Com "reduzir movimento" no aparelho a troca continua, só que
 * sem o deslize.
 */
export function Carrossel({ imagens }: { imagens: string[] }) {
  const total = imagens.length
  // 0..total — `total` é a cópia da primeira, para a volta sem rebobinar.
  const [pos, setPos] = useState(0)
  const [animar, setAnimar] = useState(true)
  const [reduzir, setReduzir] = useState(false)
  const toqueX = useRef<number | null>(null)
  const segurando = useRef(false)
  // Rearma a espera quando a troca foi adiada (aba escondida, dedo na imagem).
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setReduzir(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }, [])

  // Avança sozinho. O intervalo recomeça a cada troca, para o toque/ponto não encurtar a
  // próxima espera.
  useEffect(() => {
    if (total < 2) return
    const t = setTimeout(() => {
      if (document.visibilityState !== 'visible' || segurando.current) {
        setTick((n) => n + 1)
        return
      }
      setAnimar(true)
      setPos((p) => (p >= total ? 1 : p + 1))
    }, CARROSSEL_INTERVALO_MS)
    return () => clearTimeout(t)
  }, [pos, total, tick])

  // Chegou na cópia da primeira: salta para a primeira de verdade sem animação.
  useEffect(() => {
    if (pos !== total || total < 2) return
    if (reduzir) {
      setAnimar(false)
      setPos(0)
      return
    }
    const t = setTimeout(() => {
      setAnimar(false)
      setPos(0)
    }, 820)
    return () => clearTimeout(t)
  }, [pos, total, reduzir])

  // Religa a animação depois do salto (dois quadros: o salto precisa ser pintado antes).
  useEffect(() => {
    if (animar) return
    let b = 0
    const a = requestAnimationFrame(() => {
      b = requestAnimationFrame(() => setAnimar(true))
    })
    return () => {
      cancelAnimationFrame(a)
      cancelAnimationFrame(b)
    }
  }, [animar])

  const atual = total > 0 ? pos % total : 0
  const faixa = total > 1 ? [...imagens, imagens[0]!] : imagens
  const irPara = (i: number) => {
    setAnimar(true)
    setPos(i)
  }

  return (
    <div
      className="mesa-carrossel"
      onTouchStart={(e) => {
        toqueX.current = e.touches[0]?.clientX ?? null
        segurando.current = true
      }}
      onTouchEnd={(e) => {
        segurando.current = false
        const inicio = toqueX.current
        const fim = e.changedTouches[0]?.clientX
        toqueX.current = null
        if (inicio === null || fim === undefined || Math.abs(fim - inicio) < 40 || total < 2) return
        irPara(fim < inicio ? (atual + 1) % total : (atual - 1 + total) % total)
      }}
      aria-roledescription="carrossel"
      data-carrossel-pos={atual}
    >
      <div
        className="mesa-carrossel-trilho"
        style={{
          transform: `translate3d(-${pos * 100}%, 0, 0)`,
          transition: animar && !reduzir ? 'transform .8s cubic-bezier(.4, 0, .2, 1)' : 'none',
        }}
      >
        {faixa.map((url, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${url}-${i}`} src={url} alt="" className="mesa-carrossel-slide" loading="eager" aria-hidden={i !== pos} draggable={false} />
        ))}
      </div>
      {total > 1 && (
        <div className="mesa-carrossel-pontos">
          {imagens.map((url, i) => (
            <button
              key={url}
              type="button"
              className={i === atual ? 'ativo' : ''}
              onClick={() => irPara(i)}
              aria-label={`Imagem ${i + 1} de ${total}`}
              aria-current={i === atual}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Ficha do modo "somente visualização" ─────────────────────────────────────

/**
 * Item em destaque, sem nenhuma ação: foto inteira (sem corte), nome e descrição. Na
 * pizza, também a lista de sabores com os ingredientes. Fecha no X, no fundo ou no Esc.
 */
function FichaVisualizacao({ item, onFechar }: { item: ItemDaMesa; onFechar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onFechar])
  const ehPizza = item.tipoItem === 'pizza'
  return (
    <div className="mesa-modal-fundo mesa-ver-fundo" onClick={onFechar}>
      <div className="mesa-ver" role="dialog" aria-modal="true" aria-label={item.nome} onClick={(e) => e.stopPropagation()} data-ficha-visualizacao>
        <button className="mesa-fechar" onClick={onFechar} aria-label="Fechar">
          ✕
        </button>
        <div className="mesa-ver-foto">
          {item.imagemUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imagemUrl} alt={item.nome} />
          ) : (
            <div className="mesa-card-foto-vazia" aria-hidden="true">
              🍽️
            </div>
          )}
        </div>
        <div className="mesa-ver-texto">
          <Etiqueta item={item} />
          <h2>{item.nome}</h2>
          <DescricaoDoItem texto={item.descricao} />
          {ehPizza && item.sabores.length > 0 && (
            <div className="mesa-ver-sabores">
              <h3>Sabores</h3>
              <ul>
                {item.sabores.map((sb) => (
                  <li key={sb.nome}>
                    <strong>{sb.nome}</strong>
                    {sb.descricao && <span>{sb.descricao}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Configurador em etapas ──────────────────────────────────────────────────

interface Etapa {
  id: string
  /** O que a escolha desta etapa é — decide o preço (ver lib/selecao-preco). */
  tipo: TipoOpcao
  titulo: string
  instrucao: string
  obrigatorio: boolean
  min: number
  max: number
  opcoes: { id: string; nome: string; preco: number; imagemUrl: string | null; detalhe?: string; descricao?: string }[]
}

const GRUPO_DO_TIPO: Record<Exclude<TipoOpcao, 'opcao'>, string> = {
  tamanho: 'Tamanho',
  sabor: 'Sabor',
  borda: 'Borda',
  massa: 'Massa',
}

function Configurador({
  item,
  pizza,
  onFechar,
  onAdicionar,
}: {
  item: ItemDaMesa
  pizza: PizzaDaLoja
  onFechar: () => void
  onAdicionar: (linha: LinhaSelecionada) => void
}) {
  const ehPizza = item.tipoItem === 'pizza'
  const [escolhas, setEscolhas] = useState<Record<string, string[]>>({})
  // Tamanho de pizza só aparece se algum sabor tem preço nele.
  const tamanhosPizza = useMemo(
    () => {
      if (!ehPizza) return []
      // Mesma regra do PDV e da vitrine (lib/pizza-tamanhos).
      return tamanhosVendidosDaPizza(pizza.tamanhos, item.sabores, item.pizzaTamanhosOcultos)
    },
    [ehPizza, pizza.tamanhos, item.sabores, item.pizzaTamanhosOcultos],
  )
  const tamanhoPizza = tamanhosPizza.find((t) => (escolhas.tamanho ?? [])[0] === t.id)
  const precificavel = useMemo<ItemPrecificavel>(
    () => ({
      preco: item.preco,
      tipoItem: item.tipoItem,
      tamanhos: item.tamanhos,
      sabores: item.sabores,
      tamanhosOcultos: item.pizzaTamanhosOcultos,
      grupos: item.grupos.map((g) => ({ nome: g.nome, complementos: g.complementos })),
    }),
    [item],
  )

  /**
   * As etapas saem do catálogo, nunca de uma lista fixa: tamanho (quando houver), os
   * grupos de opções do item na ordem cadastrada, e por último quantidade + observação.
   */
  const etapas = useMemo<Etapa[]>(() => {
    const lista: Etapa[] = []
    if (ehPizza) {
      // Pizza: tamanho → sabor(es) → borda → massa, e depois os adicionais do item.
      lista.push({
        id: 'tamanho',
        tipo: 'tamanho',
        titulo: 'Escolha o tamanho',
        instrucao: 'Você deve escolher 1 tamanho.',
        obrigatorio: true,
        min: 1,
        max: 1,
        opcoes: tamanhosPizza.map((t) => {
          const precos = item.sabores.map((s) => s.precos[t.id] ?? 0).filter((x) => x > 0)
          return {
            id: t.id,
            nome: t.nome,
            preco: 0,
            imagemUrl: null,
            detalhe: precos.length ? `a partir de ${brl(Math.min(...precos))}` : undefined,
            descricao: t.maxSabores > 1 ? `Até ${t.maxSabores} sabores` : undefined,
          }
        }),
      })
      const max = Math.max(1, tamanhoPizza?.maxSabores ?? 1)
      lista.push({
        id: 'sabor',
        tipo: 'sabor',
        titulo: max > 1 ? 'Escolha os sabores' : 'Escolha o sabor',
        instrucao: !tamanhoPizza
          ? 'Escolha o tamanho primeiro.'
          : max > 1
            ? `Escolha de 1 a ${max} sabores. Com mais de um, o preço é ${pizza.regra === 'maior' ? 'o do sabor mais caro' : 'a média dos sabores'}.`
            : 'Você deve escolher 1 sabor.',
        obrigatorio: true,
        min: 1,
        max,
        opcoes: tamanhoPizza
          ? item.sabores
              .filter((sb) => (sb.precos[tamanhoPizza.id] ?? 0) > 0)
              .map((sb) => ({
                id: `sabor:${sb.nome}`,
                nome: sb.nome,
                preco: 0,
                imagemUrl: null,
                detalhe: brl(sb.precos[tamanhoPizza.id]!),
                descricao: sb.descricao || undefined,
              }))
          : [],
      })
      if (pizza.bordas.length > 0) {
        lista.push({
          id: 'borda',
          tipo: 'borda',
          titulo: 'Borda',
          instrucao: 'Opcional. Escolha até 1.',
          obrigatorio: false,
          min: 0,
          max: 1,
          opcoes: pizza.bordas.map((b) => ({ id: `borda:${b.nome}`, nome: b.nome, preco: b.preco, imagemUrl: null })),
        })
      }
      if (pizza.massas.length > 0) {
        lista.push({
          id: 'massa',
          tipo: 'massa',
          titulo: 'Massa',
          instrucao: 'Opcional. Escolha até 1.',
          obrigatorio: false,
          min: 0,
          max: 1,
          opcoes: pizza.massas.map((m) => ({ id: `massa:${m.nome}`, nome: m.nome, preco: m.preco, imagemUrl: null })),
        })
      }
    } else if (item.tamanhos.length > 0) {
      // O tamanho SUBSTITUI o preço do item — mostra o preço cheio, não "+ R$".
      lista.push({
        id: 'tamanho',
        tipo: 'tamanho',
        titulo: 'Escolha o tamanho',
        instrucao: 'Você deve escolher 1 tamanho.',
        obrigatorio: true,
        min: 1,
        max: 1,
        opcoes: item.tamanhos.map((t) => ({ id: t.id, nome: t.nome, preco: 0, imagemUrl: null, detalhe: brl(t.preco) })),
      })
    }
    for (const g of item.grupos) {
      if (g.complementos.length === 0) continue
      lista.push({
        id: g.id,
        tipo: 'opcao',
        titulo: g.nome,
        instrucao: g.obrigatorio
          ? `Você deve escolher ${g.minEscolhas > 1 ? `${g.minEscolhas} itens` : '1 item'}.`
          : `Opcional. Escolha até ${g.maxEscolhas > 1 ? `${g.maxEscolhas} itens` : '1 item'}.`,
        obrigatorio: g.obrigatorio,
        min: g.obrigatorio ? Math.max(1, g.minEscolhas) : 0,
        // Máximo 0 = "quantos quiser", como no PDV e na vitrine.
        max: g.maxEscolhas > 0 ? g.maxEscolhas : Math.max(1, g.complementos.length),
        opcoes: g.complementos,
      })
    }
    return lista
  }, [item, ehPizza, tamanhosPizza, tamanhoPizza, pizza])

  const [passo, setPasso] = useState(0)
  const [quantidade, setQuantidade] = useState(1)
  const [observacao, setObservacao] = useState('')

  const ehUltima = passo >= etapas.length
  const etapa = etapas[passo]

  function alternar(etapa: Etapa, opcaoId: string) {
    setEscolhas((atual) => {
      const atuais = atual[etapa.id] ?? []
      if (ehPizza && etapa.tipo === 'tamanho') {
        // Troca de tamanho: sai o sabor sem preço nele e o que passa do limite de sabores.
        const t = tamanhosPizza.find((x) => x.id === opcaoId)
        const sabores = (atual.sabor ?? [])
          .filter((id) => (item.sabores.find((sb) => `sabor:${sb.nome}` === id)?.precos[t?.id ?? ''] ?? 0) > 0)
          .slice(0, Math.max(1, t?.maxSabores ?? 1))
        return { ...atual, tamanho: [opcaoId], sabor: sabores }
      }
      if (etapa.max === 1) return { ...atual, [etapa.id]: atuais[0] === opcaoId && !etapa.obrigatorio ? [] : [opcaoId] }
      if (atuais.includes(opcaoId)) return { ...atual, [etapa.id]: atuais.filter((x) => x !== opcaoId) }
      if (atuais.length >= etapa.max) return atual
      return { ...atual, [etapa.id]: [...atuais, opcaoId] }
    })
  }

  const opcoesEscolhidas: OpcaoEscolhida[] = useMemo(() => {
    const saida: OpcaoEscolhida[] = []
    for (const e of etapas) {
      for (const id of escolhas[e.id] ?? []) {
        const o = e.opcoes.find((x) => x.id === id)
        if (o) saida.push({ grupo: e.tipo === 'opcao' ? e.titulo : GRUPO_DO_TIPO[e.tipo], escolha: o.nome, preco: o.preco, tipo: e.tipo })
      }
    }
    return saida
  }, [etapas, escolhas])

  // Mesmo cálculo do servidor: pizza pelo sabor no tamanho, tamanho substitui o preço,
  // borda/massa/adicionais somam.
  const precificado = useMemo(() => precificarLinha(precificavel, opcoesEscolhidas, pizza), [precificavel, opcoesEscolhidas, pizza])
  const subtotal = (precificado.precoUnitario + precificado.opcoes.reduce((s, o) => s + o.preco, 0)) * quantidade
  const etapaValida = !etapa || (escolhas[etapa.id] ?? []).length >= etapa.min

  function avancar() {
    if (!etapaValida) return
    if (passo < etapas.length) setPasso(passo + 1)
  }

  function concluir() {
    onAdicionar({
      chave: crypto.randomUUID(),
      itemId: item.id,
      nome: item.nome,
      imagemUrl: item.imagemUrl,
      precoUnitario: precificado.precoUnitario,
      quantidade,
      observacao,
      opcoes: precificado.opcoes,
    })
  }

  return (
    <div className="mesa-modal-fundo" onClick={onFechar}>
      <div className="mesa-modal" onClick={(e) => e.stopPropagation()}>
        <button className="mesa-fechar" onClick={onFechar} aria-label="Fechar">
          ✕
        </button>

        {/* Coluna da esquerda: produto e trilha de etapas */}
        <aside className="mesa-modal-lado">
          <div className="mesa-modal-foto">
            {item.imagemUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.imagemUrl} alt={item.nome} />
            ) : (
              <div className="mesa-card-foto-vazia">🍽️</div>
            )}
          </div>
          <div className="mesa-modal-resumo">
            <h2>{item.nome}</h2>
            <DescricaoDoItem texto={item.descricao} />
          </div>

          <ol className="mesa-trilha">
            {etapas.map((e, i) => {
              const escolhido = (escolhas[e.id] ?? [])
                .map((id) => e.opcoes.find((o) => o.id === id)?.nome)
                .filter(Boolean)
                .join(', ')
              return (
                <li key={e.id} className={i === passo ? 'atual' : i < passo ? 'concluida' : ''}>
                  <span className="mesa-trilha-num">{i + 1}</span>
                  <span className="mesa-trilha-texto">
                    <strong>{e.titulo}</strong>
                    <small>{escolhido || (i < passo ? 'Nenhuma' : 'Selecione')}</small>
                  </span>
                </li>
              )
            })}
            <li className={ehUltima ? 'atual' : ''}>
              <span className="mesa-trilha-num">{etapas.length + 1}</span>
              <span className="mesa-trilha-texto">
                <strong>Quantidade</strong>
                <small>{quantidade}</small>
              </span>
            </li>
          </ol>

          <div className="mesa-subtotal">
            <span>Subtotal</span>
            <strong>{brl(subtotal)}</strong>
          </div>
        </aside>

        {/* Coluna da direita: etapa atual */}
        <section className="mesa-modal-etapa">
          {/* No celular a trilha lateral não cabe (ela só aparece a partir de 700px), e
              sem ela o cliente não sabia em que passo estava nem quantos faltavam. Esta
              é a mesma informação em faixa: passo atual, concluídos, e quais dos que
              faltam são obrigatórios. Pular para uma etapa já vista é permitido; pular
              para a frente, não — a obrigatória seria burlada. */}
          <nav className="mesa-progresso" aria-label="Etapas da escolha">
            <p className="mesa-progresso-texto">
              Etapa {Math.min(passo + 1, etapas.length + 1)} de {etapas.length + 1}
              {!ehUltima && etapa?.obrigatorio && !etapaValida && (
                <span className="mesa-progresso-pendente"> · escolha obrigatória</span>
              )}
            </p>
            <ol className="mesa-progresso-passos">
              {[...etapas.map((e) => ({ id: e.id, titulo: e.titulo, obrigatorio: e.obrigatorio })),
                { id: '__qtd', titulo: 'Quantidade', obrigatorio: false }].map((e, i) => {
                const estado = i === passo ? 'atual' : i < passo ? 'concluida' : 'futura'
                return (
                  <li key={e.id} className={estado}>
                    <button
                      type="button"
                      onClick={() => i < passo && setPasso(i)}
                      disabled={i >= passo}
                      aria-current={estado === 'atual' ? 'step' : undefined}
                      aria-label={`Etapa ${i + 1}: ${e.titulo}${
                        estado === 'concluida' ? ' (concluída)' : estado === 'atual' ? ' (atual)' : ''
                      }${e.obrigatorio && estado === 'futura' ? ' — obrigatória' : ''}`}
                    >
                      {estado === 'concluida' ? '✓' : i + 1}
                      {e.obrigatorio && estado === 'futura' && <em aria-hidden="true">*</em>}
                    </button>
                  </li>
                )
              })}
            </ol>
          </nav>

          {!ehUltima && etapa ? (
            <>
              <header>
                <h3>{etapa.titulo}</h3>
                <p>{etapa.instrucao}</p>
              </header>
              <div className="mesa-opcoes">
                {etapa.opcoes.map((o) => {
                  const marcada = (escolhas[etapa.id] ?? []).includes(o.id)
                  return (
                    <button
                      key={o.id}
                      className={`mesa-opcao ${marcada ? 'marcada' : ''}`}
                      onClick={() => alternar(etapa, o.id)}
                      role={etapa.max === 1 ? 'radio' : 'checkbox'}
                      aria-checked={marcada}
                    >
                      <span className={`mesa-marcador ${etapa.max === 1 ? 'redondo' : ''}`} aria-hidden="true" />
                      {o.imagemUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={o.imagemUrl} alt="" className="mesa-opcao-foto" />
                      )}
                      <span className="mesa-opcao-nome">
                        {o.nome}
                        {o.descricao && <small className="mesa-opcao-descricao">{o.descricao}</small>}
                      </span>
                      {o.detalhe ? (
                        <span className="mesa-opcao-preco">{o.detalhe}</span>
                      ) : (
                        o.preco > 0 && <span className="mesa-opcao-preco">+ {brl(o.preco)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <header>
                <h3>Quantidade</h3>
                <p>Quantos deste item você quer pedir ao garçom?</p>
              </header>
              <div className="mesa-qtd">
                <button onClick={() => setQuantidade((q) => Math.max(1, q - 1))} aria-label="Diminuir">
                  −
                </button>
                <span>{quantidade}</span>
                <button onClick={() => setQuantidade((q) => Math.min(99, q + 1))} aria-label="Aumentar">
                  +
                </button>
              </div>
              <label className="mesa-observacao">
                <span>Observação</span>
                <textarea
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value.slice(0, 280))}
                  placeholder="Você pode escrever uma observação"
                  rows={4}
                />
              </label>
            </>
          )}

          <footer className="mesa-modal-rodape">
            <div className="mesa-rodape-subtotal">
              <span>Subtotal</span>
              <strong>{brl(subtotal)}</strong>
            </div>
            {!ehUltima ? (
              <button className={`mesa-avancar ${etapaValida ? 'ativo' : ''}`} onClick={avancar} disabled={!etapaValida}>
                Avançar
              </button>
            ) : (
              <button className="mesa-avancar ativo" onClick={concluir}>
                Adicionar à seleção
              </button>
            )}
          </footer>
        </section>
      </div>
    </div>
  )
}

// ── Painel "Minha seleção" ──────────────────────────────────────────────────

function PainelSelecao({
  mensagem,
  linhas,
  deOutros,
  total,
  sincronizando,
  onFechar,
  onAlterarQtd,
  onRemover,
  onLimpar,
  onConcluir,
}: {
  mensagem: string
  linhas: LinhaSelecionada[]
  deOutros: LinhaDeOutro[]
  total: number
  sincronizando: boolean
  onFechar: () => void
  onAlterarQtd: (chave: string, delta: number) => void
  onRemover: (chave: string) => void
  onLimpar: () => void
  onConcluir: () => void
}) {
  return (
    <div className="mesa-modal-fundo" onClick={onFechar}>
      <div className="mesa-painel" onClick={(e) => e.stopPropagation()}>
        <header className="mesa-painel-topo">
          <h2>Minha seleção</h2>
          <button onClick={onFechar} aria-label="Fechar">
            ✕
          </button>
        </header>

        <p className="mesa-painel-aviso">{mensagem}</p>

        <div className="mesa-painel-lista">
          {linhas.length === 0 && <p className="mesa-vazio">Você ainda não marcou nenhum item.</p>}
          {linhas.map((l) => (
            <div key={l.chave} className="mesa-linha">
              <div className="mesa-linha-foto">
                {l.imagemUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.imagemUrl} alt="" />
                ) : (
                  <span aria-hidden="true">🍽️</span>
                )}
              </div>
              <div className="mesa-linha-texto">
                <strong>{l.nome}</strong>
                {l.opcoes.length > 0 && <small>{l.opcoes.map(rotuloOpcao).join(' · ')}</small>}
                {l.observacao && <small className="mesa-linha-obs">“{l.observacao}”</small>}
                <span className="mesa-linha-preco">{brl(totalDaLinha(l))}</span>
              </div>
              <div className="mesa-linha-acoes">
                <div className="mesa-stepper">
                  <button onClick={() => onAlterarQtd(l.chave, -1)} aria-label="Diminuir">
                    −
                  </button>
                  <span>{l.quantidade}</span>
                  <button onClick={() => onAlterarQtd(l.chave, 1)} aria-label="Aumentar">
                    +
                  </button>
                </div>
                <button className="mesa-remover" onClick={() => onRemover(l.chave)}>
                  Remover
                </button>
              </div>
            </div>
          ))}

          {/* O que os outros celulares da mesa marcaram. Só leitura: quem tira ou muda
              cada linha é o aparelho que a marcou — uma lista só, editada por três
              pessoas ao mesmo tempo, faz item sumir da tela alheia. */}
          {deOutros.length > 0 && (
            <div className="mesa-de-outros">
              <h3>Também nesta mesa</h3>
              <p>Marcado em outro celular. Mostrem tudo junto ao garçom.</p>
              <ul>
                {deOutros.map((l, i) => (
                  <li key={`${i}-${l.nome}`}>
                    <span className="mesa-de-outros-qtd">{l.quantidade}×</span>
                    <span className="mesa-de-outros-nome">
                      {l.nome}
                      {l.opcoes.length > 0 && <small>{l.opcoes.map(rotuloOpcao).join(' · ')}</small>}
                      {l.observacao && <small>“{l.observacao}”</small>}
                    </span>
                    <span className="mesa-de-outros-preco">
                      {brl((l.precoUnitario + l.opcoes.reduce((s, o) => s + o.preco, 0)) * l.quantidade)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="mesa-painel-rodape">
          <div className="mesa-painel-total">
            <span>Total estimado</span>
            <strong>{brl(total)}</strong>
          </div>
          <div className="mesa-painel-botoes">
            <button className="mesa-secundario" onClick={onFechar}>
              Continuar escolhendo
            </button>
            <button className="mesa-principal" onClick={onConcluir} disabled={linhas.length === 0}>
              Concluir seleção
            </button>
          </div>
          {linhas.length > 0 && (
            <button className="mesa-limpar" onClick={onLimpar}>
              Limpar seleção
            </button>
          )}
          {sincronizando && <span className="mesa-sincronizando">salvando…</span>}
        </footer>
      </div>
    </div>
  )
}

function SelecaoSalva({ onFechar }: { onFechar: () => void }) {
  return (
    <div className="mesa-modal-fundo" onClick={onFechar}>
      <div className="mesa-confirmacao" onClick={(e) => e.stopPropagation()}>
        <div className="mesa-confirmacao-icone" aria-hidden="true">
          ✓
        </div>
        <h2>Seleção salva</h2>
        <p>
          Mostre ou confirme estes itens com o garçom. <strong>Nada foi enviado à cozinha.</strong>
        </p>
        <button className="mesa-principal" onClick={onFechar}>
          OK, voltar ao cardápio
        </button>
      </div>
    </div>
  )
}

// ── Tokens visuais ──────────────────────────────────────────────────────────
// Extraídos dos papéis de cor das referências (coral no cabeçalho e na etapa atual,
// verde na ação positiva, azul-marinho nas etapas concluídas, cinza-azulado nas
// desabilitadas e divisórias, fundo quase branco). Ficam num lugar só, escopados a esta
// rota — nada disto vaza para o delivery nem para o painel.

const TOKENS = `
.mesa-raiz {
  --coral: #CB000F;
  --coral-escuro: #A3000C;
  --verde: #2FA84F;
  --verde-escuro: #268C42;
  --marinho: #1F2D3D;
  --fundo: #F2F5F8;
  --superficie: #FFFFFF;
  --borda: #E3E8EF;
  --texto: #1F2937;
  --suave: #6B7280;
  --desabilitado: #C2CBD6;
  --raio: 8px;

  min-height: 100dvh;
  background: var(--fundo);
  color: var(--texto);
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.mesa-raiz * { box-sizing: border-box; }
.mesa-raiz button { font: inherit; cursor: pointer; }

/* Cabeçalho — no celular vira duas linhas: marca + mesa em cima, busca embaixo.
   Espremer tudo numa linha só trunca o nome da loja e some com a busca. */
.mesa-cabecalho {
  position: sticky; top: 0; z-index: 30;
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas: "marca acoes" "busca busca";
  align-items: center; gap: 8px 10px;
  padding: 10px 12px; padding-top: calc(10px + env(safe-area-inset-top, 0px));
  background: var(--coral); color: #fff;
}
.mesa-marca { grid-area: marca; }
.mesa-busca { grid-area: busca; }
.mesa-acoes { grid-area: acoes; }
.mesa-marca { display: flex; align-items: center; gap: 8px; min-width: 0; }
.mesa-logo { width: 34px; height: 34px; border-radius: 6px; object-fit: cover; flex-shrink: 0; background: #fff; }
.mesa-logo-vazia { display: grid; place-items: center; color: var(--coral); font-weight: 800; }
.mesa-nome-loja { font-weight: 800; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mesa-busca { flex: 1; display: flex; align-items: center; gap: 6px; background: rgba(255,255,255,.16); border-radius: var(--raio); padding: 0 10px; height: 44px; min-width: 0; }
.mesa-busca svg { width: 16px; height: 16px; fill: rgba(255,255,255,.85); flex-shrink: 0; }
/* O input ocupa a altura toda da etiqueta: o alvo de toque é a caixa inteira, não a
   linha de texto de 20px que o navegador dá por padrão. */
.mesa-busca input { flex: 1; min-width: 0; height: 100%; background: none; border: 0; outline: none; color: #fff; font-size: 13px; }
.mesa-busca input::placeholder { color: rgba(255,255,255,.75); }
.mesa-acoes { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.mesa-etiqueta { background: rgba(0,0,0,.18); border-radius: var(--raio); padding: 6px 10px; font-size: 12px; font-weight: 700; white-space: nowrap; }
.mesa-botao-selecao { display: flex; align-items: center; gap: 6px; min-height: 44px; background: #fff; color: var(--coral); border: 0; border-radius: var(--raio); padding: 8px 12px; font-size: 12px; font-weight: 800; position: relative; }
.mesa-botao-selecao svg { width: 16px; height: 16px; fill: currentColor; }
.mesa-contador { background: var(--coral); color: #fff; border-radius: 999px; min-width: 18px; height: 18px; display: grid; place-items: center; font-size: 11px; padding: 0 4px; }

/* Chamar garçom — 44px de alvo de toque, como os outros botões do cabeçalho. */
.mesa-botao-chamar {
  display: flex; align-items: center; gap: 6px; min-height: 44px;
  background: rgba(255,255,255,.18); color: #fff; border: 1px solid rgba(255,255,255,.4);
  border-radius: var(--raio); padding: 8px 10px; font-size: 12px; font-weight: 800; white-space: nowrap;
}
.mesa-botao-chamar svg { width: 16px; height: 16px; fill: currentColor; }
.mesa-botao-chamar.chamado { background: #fff; color: var(--coral); border-color: #fff; }
.mesa-chamar-folha {
  background: var(--superficie); border-radius: var(--raio); padding: 22px 20px; margin: 16px;
  width: 100%; max-width: 380px; display: flex; flex-direction: column; gap: 14px;
}
.mesa-chamar-folha header h2 { margin: 0 0 4px; font-size: 17px; font-weight: 800; }
.mesa-chamar-folha header p { margin: 0; font-size: 12px; color: var(--suave); line-height: 1.45; }
.mesa-chamar-estado { margin: 0; background: #E4EFF3; color: var(--marinho); border-radius: var(--raio); padding: 10px 12px; font-size: 12px; font-weight: 700; }
.mesa-chamar-opcoes { display: flex; flex-direction: column; gap: 8px; }
.mesa-chamar-opcao {
  text-align: left; background: var(--fundo); border: 1px solid var(--borda); color: var(--texto);
  border-radius: var(--raio); padding: 12px 14px; min-height: 48px;
}
.mesa-chamar-opcao:disabled { opacity: .6; cursor: default; }
.mesa-chamar-opcao.aberta { border-color: var(--verde); background: #F0FDF4; }
.mesa-chamar-rotulo { display: block; font-size: 13px; font-weight: 800; }
.mesa-chamar-descricao { display: block; font-size: 11px; color: var(--suave); margin-top: 1px; }
.mesa-chamar-aviso { margin: 0; font-size: 12px; font-weight: 700; color: var(--marinho); }

/* Corpo — no celular empilha: faixa de categorias em cima, conteúdo embaixo. */
.mesa-corpo { flex: 1; display: flex; flex-direction: column; min-height: 0; }

/* Categorias: faixa horizontal rolável no celular. Um trilho vertical aqui comeria
   quase um terço da largura de um aparelho de 390px. */
.mesa-categorias {
  display: flex; gap: 6px; flex-shrink: 0;
  background: var(--superficie); border-bottom: 1px solid var(--borda);
  padding: 8px 12px; overflow-x: auto; scrollbar-width: none;
  position: sticky; top: 0; z-index: 20;
}
.mesa-categorias::-webkit-scrollbar { display: none; }
.mesa-categoria {
  display: flex; align-items: center; gap: 7px; flex-shrink: 0;
  padding: 7px 12px 7px 7px; background: var(--fundo); border: 1px solid var(--borda);
  border-radius: 999px; color: var(--suave);
}
.mesa-categoria.ativa { color: #fff; background: var(--coral); border-color: var(--coral); }
.mesa-categoria.ativa .mesa-categoria-icone { background: rgba(255,255,255,.22); }
.mesa-categoria-icone { width: 28px; height: 28px; border-radius: 50%; background: var(--superficie); display: grid; place-items: center; overflow: hidden; flex-shrink: 0; }
.mesa-categoria-icone img { width: 100%; height: 100%; object-fit: cover; }
.mesa-categoria-icone svg { width: 15px; height: 15px; fill: currentColor; }
.mesa-categoria-nome { font-size: 12px; font-weight: 700; white-space: nowrap; }

/* Conteúdo */
.mesa-conteudo { flex: 1; min-width: 0; padding: 12px; overflow-y: auto; }
.mesa-banner { position: relative; border-radius: var(--raio); overflow: hidden; height: 176px; margin-bottom: 12px; background: var(--marinho); }
/* Carrossel: faixa com as imagens lado a lado, deslizando (ver Carrossel). */
.mesa-carrossel { position: absolute; inset: 0; overflow: hidden; touch-action: pan-y; }
.mesa-carrossel-trilho { display: flex; width: 100%; height: 100%; will-change: transform; }
.mesa-carrossel .mesa-carrossel-slide { flex: 0 0 100%; width: 100%; height: 100%; object-fit: cover; opacity: .92; user-select: none; -webkit-user-drag: none; }
.mesa-carrossel-pontos { position: absolute; top: 10px; right: 10px; display: flex; gap: 6px; z-index: 2; }
.mesa-carrossel-pontos button { width: 7px; height: 7px; padding: 0; border: 0; border-radius: 50%; background: rgba(255,255,255,.55); cursor: pointer; transition: width .3s ease, background-color .3s ease; }
.mesa-carrossel-pontos button.ativo { width: 18px; border-radius: 4px; background: #fff; }
.mesa-banner-texto { z-index: 1; }
.mesa-banner-foto { width: 100%; height: 100%; object-fit: cover; opacity: .82; }
.mesa-banner-vazio { background: linear-gradient(120deg, var(--marinho), #3A4B5F); }
.mesa-banner-texto { position: absolute; inset: auto 0 0 0; padding: 14px 16px; background: linear-gradient(transparent, rgba(0,0,0,.72)); color: #fff; display: flex; flex-direction: column; gap: 2px; }
.mesa-banner-titulo { font-size: 20px; font-weight: 800; }
.mesa-banner-sub { font-size: 12px; opacity: .92; }

.mesa-grade { display: grid; grid-template-columns: 1fr; gap: 10px; }
/* Card: texto à esquerda, foto à direita. A foto vem depois no HTML de propósito —
   leitor de tela ouve nome e preço antes de chegar na imagem. */
.mesa-card { display: grid; grid-template-columns: 1fr 88px; gap: 10px; width: 100%; background: var(--superficie); border: 1px solid var(--borda); border-radius: var(--raio); padding: 12px; font: inherit; color: inherit; text-align: left; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.mesa-card:hover { border-color: var(--coral); }
.mesa-card:active { transform: scale(.99); }
.mesa-card:focus-visible { outline: 2px solid var(--coral); outline-offset: 2px; }
.mesa-card-mais { position: absolute; right: 6px; bottom: 6px; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; background: var(--coral); color: #fff; font-size: 18px; font-weight: 700; line-height: 1; box-shadow: 0 2px 6px rgba(0,0,0,.2); }
.mesa-card-texto { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.mesa-item-etiqueta { align-self: start; display: inline-flex; align-items: center; border-radius: 999px; padding: 3px 8px; font-size: 10px; font-weight: 700; line-height: 14px; white-space: nowrap; }
.mesa-card-texto h3 { margin: 0; font-size: 14px; font-weight: 800; line-height: 1.25; }
.mesa-card-texto p { margin: 0; font-size: 12px; color: var(--suave); line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.mesa-card-rodape { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-top: 10px; }
.mesa-preco { display: flex; flex-direction: column; min-width: 0; }
.mesa-preco-rotulo { font-size: 10px; color: var(--suave); text-transform: uppercase; letter-spacing: .04em; }
.mesa-preco-valor { font-size: 16px; font-weight: 800; color: var(--coral); white-space: nowrap; }
.mesa-card-foto { position: relative; width: 88px; height: 88px; align-self: start; border-radius: var(--raio); overflow: hidden; background: var(--fundo); }
.mesa-card-foto img { width: 100%; height: 100%; object-fit: cover; }
.mesa-card-foto-vazia { width: 100%; height: 100%; display: grid; place-items: center; font-size: 28px; }
.mesa-vazio { grid-column: 1/-1; text-align: center; color: var(--suave); font-size: 13px; padding: 28px 0; }
.mesa-marca-dagua { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin: 4px 0 96px; opacity: .45; user-select: none; pointer-events: none; }
.mesa-marca-dagua img { width: 22px; height: 22px; filter: grayscale(1); opacity: .7; }
.mesa-marca-dagua span { font-size: 13px; font-weight: 800; letter-spacing: .04em; color: var(--desabilitado); text-transform: lowercase; }
.mesa-ver-fundo { padding: 12px; }
/* Ficha do modo visualização: foto à esquerda (inteira, sem corte) e, à direita, nome,
   descrição e sabores — a coluna da direita rola sozinha quando a lista é longa. */
.mesa-ver { position: relative; display: flex; flex-direction: row; align-items: stretch; width: 100%; max-width: 960px; max-height: min(88dvh, 720px); background: var(--superficie); border-radius: var(--raio); overflow: hidden; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
.mesa-ver-foto { flex: 0 0 46%; min-width: 0; background: #F2F5F8; display: flex; align-items: center; justify-content: center; }
.mesa-ver-foto img { display: block; width: 100%; height: 100%; max-height: min(88dvh, 720px); object-fit: contain; }
.mesa-ver-foto .mesa-card-foto-vazia { height: 100%; min-height: 180px; font-size: 48px; }
.mesa-ver-texto { flex: 1 1 auto; min-width: 0; min-height: 0; padding: 16px 16px 20px; overflow-y: auto; }
.mesa-ver-texto h2 { margin: 0 44px 6px 0; font-size: 20px; font-weight: 800; line-height: 1.25; }
.mesa-ver-texto > p { margin: 0; font-size: 14px; line-height: 1.55; color: var(--suave); white-space: pre-line; }
.mesa-ver-sabores { margin-top: 16px; }
.mesa-ver-sabores h3 { margin: 0 0 8px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--coral); }
.mesa-ver-sabores ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mesa-ver-sabores li { padding: 9px 0; border-top: 1px solid var(--borda); display: flex; flex-direction: column; gap: 2px; }
.mesa-ver-sabores li strong { font-size: 14px; font-weight: 700; }
.mesa-ver-sabores li span { font-size: 12px; color: var(--suave); line-height: 1.4; }
@media (max-width: 480px) {
  .mesa-ver-foto { flex-basis: 42%; }
  .mesa-ver-texto { padding: 12px 12px 16px; }
  .mesa-ver-texto h2 { font-size: 17px; }
}
.mesa-aviso-rodape { display: flex; align-items: flex-start; gap: 10px; margin: 18px 0 12px; padding: 12px 14px; background: var(--superficie); border: 1px solid var(--borda); border-left: 4px solid var(--coral); border-radius: var(--raio); box-shadow: 0 1px 2px rgba(15,23,42,.04); }
.mesa-aviso-rodape p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--texto); }
.mesa-aviso-icone { flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--coral); color: #fff; font-size: 13px; font-weight: 800; font-style: italic; font-family: Georgia, serif; }

/* Barra fixa */
.mesa-barra-flutuante {
  position: fixed; left: 12px; right: 12px; bottom: calc(12px + env(safe-area-inset-bottom, 0px)); z-index: 35;
  display: flex; align-items: center; justify-content: center; gap: 10px;
  background: var(--verde); color: #fff; border: 0; border-radius: var(--raio);
  padding: 14px 16px; font-size: 14px; font-weight: 800; box-shadow: 0 8px 24px rgba(0,0,0,.18);
}
.mesa-barra-qtd { background: rgba(255,255,255,.22); border-radius: 999px; min-width: 22px; height: 22px; display: grid; place-items: center; font-size: 12px; }
.mesa-barra-total { margin-left: auto; }

/* Modal */
.mesa-modal-fundo { position: fixed; inset: 0; z-index: 50; background: rgba(15,23,42,.55); display: flex; align-items: center; justify-content: center; padding: 0; }
.mesa-modal { position: relative; background: var(--superficie); width: 100%; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; }
.mesa-fechar { position: absolute; top: 10px; right: 10px; z-index: 5; width: 44px; height: 44px; border-radius: 50%; border: 0; background: var(--coral); color: #fff; font-size: 15px; font-weight: 700; }
.mesa-modal-lado { background: var(--superficie); border-bottom: 1px solid var(--borda); flex-shrink: 0; }
.mesa-modal-foto { height: 150px; background: var(--fundo); }
.mesa-modal-foto img { width: 100%; height: 100%; object-fit: cover; }
.mesa-modal-resumo { padding: 12px 16px 8px; }
.mesa-modal-resumo h2 { margin: 0 0 4px; font-size: 16px; font-weight: 800; }
.mesa-modal-resumo p { margin: 0; font-size: 12px; color: var(--suave); line-height: 1.4; }
.mesa-trilha { display: none; }
.mesa-subtotal { display: none; }

.mesa-modal-etapa { flex: 1; display: flex; flex-direction: column; min-height: 0; }
.mesa-modal-etapa > header { padding: 14px 16px 8px; }
.mesa-modal-etapa h3 { margin: 0 0 2px; font-size: 15px; font-weight: 800; }
.mesa-modal-etapa header p { margin: 0; font-size: 12px; color: var(--suave); }
.mesa-opcoes { flex: 1; overflow-y: auto; padding: 4px 16px 12px; display: flex; flex-direction: column; }
.mesa-opcao { display: flex; align-items: center; gap: 10px; width: 100%; padding: 13px 4px; background: none; border: 0; border-bottom: 1px solid var(--borda); text-align: left; color: var(--texto); font-size: 13px; }
.mesa-marcador { width: 18px; height: 18px; border: 2px solid var(--desabilitado); border-radius: 4px; flex-shrink: 0; }
.mesa-marcador.redondo { border-radius: 50%; }
.mesa-opcao.marcada .mesa-marcador { border-color: var(--coral); background: var(--coral); box-shadow: inset 0 0 0 3px #fff; }
.mesa-opcao-foto { width: 32px; height: 32px; object-fit: contain; }
.mesa-opcao-nome { flex: 1; min-width: 0; }
.mesa-opcao-descricao { display: block; margin-top: 2px; color: var(--suave); font-size: 12px; font-weight: 400; line-height: 1.35; }
.mesa-opcao-preco { color: var(--suave); font-size: 12px; font-weight: 700; white-space: nowrap; }

.mesa-qtd { display: flex; align-items: center; gap: 18px; padding: 16px; }
.mesa-qtd button { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--borda); background: var(--superficie); font-size: 20px; color: var(--texto); }
.mesa-qtd span { min-width: 40px; height: 40px; border-radius: 50%; background: var(--coral); color: #fff; display: grid; place-items: center; font-size: 16px; font-weight: 800; }
.mesa-observacao { display: block; padding: 0 16px 16px; }
.mesa-observacao span { display: block; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--suave); margin-bottom: 6px; }
.mesa-observacao textarea { width: 100%; border: 1px solid var(--borda); border-radius: var(--raio); padding: 10px; font-size: 13px; resize: vertical; outline: none; }
.mesa-observacao textarea:focus { border-color: var(--coral); }

.mesa-modal-rodape { flex-shrink: 0; border-top: 1px solid var(--borda); padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); display: flex; align-items: center; gap: 12px; background: var(--superficie); }
.mesa-rodape-subtotal { display: flex; flex-direction: column; }
.mesa-rodape-subtotal span { font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: var(--suave); }
.mesa-rodape-subtotal strong { font-size: 16px; }
.mesa-avancar { flex: 1; background: var(--desabilitado); color: #fff; border: 0; border-radius: var(--raio); padding: 14px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.mesa-avancar.ativo { background: var(--verde); }
.mesa-avancar.ativo:active { background: var(--verde-escuro); }

/* Painel da seleção */
.mesa-painel { background: var(--superficie); width: 100%; height: 100dvh; display: flex; flex-direction: column; }
.mesa-painel-topo { display: flex; align-items: center; justify-content: space-between; background: var(--coral); color: #fff; padding: 14px 16px; padding-top: calc(14px + env(safe-area-inset-top, 0px)); }
.mesa-painel-topo h2 { margin: 0; font-size: 15px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
.mesa-painel-topo button { background: none; border: 0; color: #fff; font-size: 18px; }
.mesa-painel-aviso { margin: 0; padding: 12px 16px; background: #FFF7E6; color: #8A5A00; font-size: 12px; line-height: 1.45; border-bottom: 1px solid var(--borda); }
.mesa-painel-lista { flex: 1; overflow-y: auto; padding: 8px 16px; }

/* "Também nesta mesa": o que os outros celulares marcaram, em bloco separado e sem
   controles — a distinção entre "minha lista" e "a da mesa" tem de ser visível. */
.mesa-de-outros { margin: 10px 0 4px; border-top: 1px dashed var(--borda); padding-top: 12px; }
.mesa-de-outros h3 { margin: 0; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--marinho); }
.mesa-de-outros > p { margin: 2px 0 8px; font-size: 11px; color: var(--suave); }
.mesa-de-outros ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mesa-de-outros li { display: flex; align-items: flex-start; gap: 8px; background: var(--fundo); border-radius: var(--raio); padding: 8px 10px; }
.mesa-de-outros-qtd { font-size: 12px; font-weight: 800; color: var(--marinho); flex-shrink: 0; }
.mesa-de-outros-nome { flex: 1; min-width: 0; font-size: 13px; display: flex; flex-direction: column; }
.mesa-de-outros-nome small { font-size: 11px; color: var(--suave); }
.mesa-de-outros-preco { font-size: 12px; font-weight: 700; color: var(--suave); flex-shrink: 0; }
.mesa-linha { display: flex; gap: 10px; padding: 12px 0; border-bottom: 1px solid var(--borda); }
.mesa-linha-foto { width: 56px; height: 56px; border-radius: var(--raio); overflow: hidden; background: var(--fundo); display: grid; place-items: center; font-size: 22px; flex-shrink: 0; }
.mesa-linha-foto img { width: 100%; height: 100%; object-fit: cover; }
.mesa-linha-texto { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mesa-linha-texto strong { font-size: 13px; }
.mesa-linha-texto small { font-size: 11px; color: var(--suave); }
.mesa-linha-obs { font-style: italic; }
.mesa-linha-preco { font-size: 13px; font-weight: 800; color: var(--coral); margin-top: 2px; }
.mesa-linha-acoes { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.mesa-stepper { display: flex; align-items: center; gap: 8px; border: 1px solid var(--borda); border-radius: var(--raio); padding: 2px 6px; }
.mesa-stepper button { background: none; border: 0; font-size: 16px; color: var(--coral); width: 22px; }
.mesa-stepper span { font-size: 13px; font-weight: 700; min-width: 16px; text-align: center; }
.mesa-remover { background: none; border: 0; color: var(--suave); font-size: 11px; text-decoration: underline; }
.mesa-painel-rodape { flex-shrink: 0; border-top: 1px solid var(--borda); padding: 12px 16px calc(12px + env(safe-area-inset-bottom, 0px)); display: flex; flex-direction: column; gap: 10px; }
.mesa-painel-total { display: flex; align-items: center; justify-content: space-between; }
.mesa-painel-total span { font-size: 12px; color: var(--suave); }
.mesa-painel-total strong { font-size: 20px; color: var(--texto); }
.mesa-painel-botoes { display: flex; gap: 8px; }
.mesa-secundario { flex: 1; background: var(--superficie); border: 1px solid var(--borda); color: var(--texto); border-radius: var(--raio); padding: 13px; font-size: 12px; font-weight: 800; }
.mesa-principal { flex: 1; background: var(--verde); border: 0; color: #fff; border-radius: var(--raio); padding: 13px; font-size: 12px; font-weight: 800; }
.mesa-principal:disabled { background: var(--desabilitado); }
.mesa-limpar { background: none; border: 0; color: var(--suave); font-size: 11px; text-decoration: underline; align-self: center; }
.mesa-sincronizando { text-align: center; font-size: 11px; color: var(--suave); }

/* Progresso das etapas no celular. A trilha lateral só existe a partir de 700px; sem
   isto o cliente não sabia em que passo estava nem quantos faltavam. */
.mesa-progresso { border-bottom: 1px solid var(--borda); padding: 10px 16px 8px; flex-shrink: 0; }
.mesa-progresso-texto { margin: 0 0 7px; font-size: 11px; font-weight: 800; color: var(--suave); text-transform: uppercase; letter-spacing: .04em; }
.mesa-progresso-pendente { color: var(--coral); }
.mesa-progresso-passos { display: flex; align-items: center; gap: 2px; list-style: none; margin: 0; padding: 0; overflow-x: auto; }
.mesa-progresso-passos li { flex-shrink: 0; }
.mesa-progresso-passos button {
  /* 40px de alvo de toque com 26px de desenho: o círculo vem do background-clip, e não
     de encolher o botão — dedo não acerta bolinha de 26px. */
  width: 40px; height: 40px; border-radius: 50%; border: 7px solid transparent;
  background: var(--fundo); background-clip: padding-box;
  box-shadow: inset 0 0 0 1px var(--borda);
  color: var(--suave); font-size: 11px; font-weight: 800;
  display: grid; place-items: center; position: relative; padding: 0;
}
.mesa-progresso-passos li.atual button { background: var(--coral); box-shadow: inset 0 0 0 1px var(--coral); color: #fff; }
.mesa-progresso-passos li.concluida button { background: var(--marinho); box-shadow: inset 0 0 0 1px var(--marinho); color: #fff; }
.mesa-progresso-passos em { position: absolute; top: 1px; right: 3px; font-size: 12px; color: var(--coral); font-style: normal; }

/* Confirmação */
.mesa-confirmacao { background: var(--superficie); border-radius: var(--raio); padding: 28px 24px; margin: 16px; max-width: 360px; text-align: center; }
.mesa-confirmacao-icone { width: 56px; height: 56px; margin: 0 auto 14px; border-radius: 50%; border: 3px solid var(--verde); color: var(--verde); display: grid; place-items: center; font-size: 28px; }
.mesa-confirmacao h2 { margin: 0 0 8px; font-size: 18px; font-weight: 800; }
.mesa-confirmacao p { margin: 0 0 18px; font-size: 13px; color: var(--suave); line-height: 1.5; }

/* ── Tablet e desktop ──────────────────────────────────────────────────── */
@media (min-width: 700px) {
  /* Tablet e desktop: volta o cabeçalho de uma linha e o trilho vertical de
     categorias, como nas referências. */
  .mesa-cabecalho { display: flex; align-items: center; gap: 12px; padding: 10px 16px; }
  .mesa-busca { flex: 1; }
  .mesa-corpo { flex-direction: row; }
  .mesa-categorias {
    flex-direction: column; width: 132px; gap: 0; padding: 8px 0;
    border-bottom: 0; border-right: 1px solid var(--borda);
    overflow-x: visible; overflow-y: auto; position: static;
  }
  .mesa-categoria {
    flex-direction: column; width: 100%; gap: 5px; padding: 12px 6px;
    background: none; border: 0; border-left: 3px solid transparent; border-radius: 0;
  }
  .mesa-categoria.ativa { color: var(--coral); background: #FDF2F3; border-left-color: var(--coral); }
  .mesa-categoria-icone { width: 38px; height: 38px; background: var(--fundo); }
  .mesa-categoria.ativa .mesa-categoria-icone { background: #FBE2E4; }
  .mesa-categoria-icone svg { width: 19px; height: 19px; }
  .mesa-categoria-nome { font-size: 11px; text-align: center; white-space: normal; line-height: 1.2; }
  .mesa-conteudo { padding: 16px; }
  .mesa-banner { height: 240px; }
  .mesa-banner-titulo { font-size: 26px; }
  .mesa-grade { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .mesa-card { grid-template-columns: 1fr 116px; }
  .mesa-card-foto { width: 116px; height: 116px; }

  .mesa-modal-fundo { padding: 24px; }
  .mesa-modal { height: auto; max-height: 88dvh; max-width: 940px; border-radius: var(--raio); flex-direction: row; }
  .mesa-modal-lado { width: 300px; flex-shrink: 0; border-bottom: 0; border-right: 1px solid var(--borda); display: flex; flex-direction: column; overflow-y: auto; }
  .mesa-modal-foto { height: 190px; }
  /* Com a trilha lateral na tela, a faixa de progresso seria a mesma informação duas
     vezes — e roubaria altura da lista de opções. */
  .mesa-progresso { display: none; }
  .mesa-trilha { display: block; list-style: none; margin: 0; padding: 0 12px 12px; }
  .mesa-trilha li { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: var(--raio); color: var(--suave); }
  .mesa-trilha li.atual { background: var(--coral); color: #fff; }
  .mesa-trilha li.concluida { background: var(--marinho); color: #fff; }
  .mesa-trilha-num { width: 22px; height: 22px; border-radius: 50%; background: rgba(0,0,0,.12); display: grid; place-items: center; font-size: 11px; font-weight: 800; flex-shrink: 0; }
  .mesa-trilha li.atual .mesa-trilha-num, .mesa-trilha li.concluida .mesa-trilha-num { background: rgba(255,255,255,.22); }
  .mesa-trilha-texto { display: flex; flex-direction: column; min-width: 0; }
  .mesa-trilha-texto strong { font-size: 12px; }
  .mesa-trilha-texto small { font-size: 11px; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mesa-subtotal { display: flex; align-items: center; justify-content: space-between; margin-top: auto; padding: 12px 16px; border-top: 1px solid var(--borda); }
  .mesa-subtotal strong { font-size: 18px; color: var(--coral); }

  .mesa-painel { max-width: 560px; height: auto; max-height: 88dvh; border-radius: var(--raio); overflow: hidden; }
  .mesa-painel-topo { padding-top: 14px; }
  .mesa-barra-flutuante { left: auto; right: 24px; width: 320px; }
}

@media (min-width: 1100px) {
  .mesa-grade { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mesa-conteudo { padding: 20px 24px; }
  .mesa-banner { height: 280px; }
}

@media (prefers-reduced-motion: no-preference) {
  .mesa-card, .mesa-opcao { transition: transform .1s ease, background-color .15s ease, border-color .15s ease; }
}
`
