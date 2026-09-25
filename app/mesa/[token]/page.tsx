import { notFound } from 'next/navigation'
import type { Metadata, Viewport } from 'next'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverMesaPorToken } from '@/lib/queries/mesas'
import { abrirOuObterSessao } from '@/lib/queries/mesa-sessao'
import { listarGrupos, listarItens } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
import { categoriaNoHorario, itemDisponivelNoCanal } from '@/lib/canais-item'
import { grupoEstaAtivoAgora, itemDisponivelHoje } from '@/lib/timezone'
import { carregarPizzaDaLoja, itemPrecificavel } from '@/lib/queries/mesa-catalogo'
import { precoAPartirDe } from '@/lib/selecao-preco'
import { mensagemPadraoDaMesa } from '@/lib/mesa-vitrine'
import { cardapioOrdenado, ordenar } from '@/lib/ordem-cardapio'
import { CardapioDaMesa } from './cardapio'

/**
 * Cardápio presencial da mesa, aberto pelo QR.
 *
 * Nasce separado do delivery de propósito: esta rota não conhece checkout, entrega,
 * retirada, endereço, frete, cupom nem fidelidade. O cliente monta uma lista para
 * mostrar ao garçom — e só.
 *
 * Toda leitura roda com `service_role` no servidor: a chave anônima não tem grant em
 * `mesas`, `sessoes_mesa` nem `selecoes_mesa`. O token é o único segredo que circula, e
 * ele é opaco e revogável.
 */

export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Mesa é celular na mão do cliente: a barra do navegador acompanha o cabeçalho.
  themeColor: '#CB000F',
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const mesa = await resolverMesaPorToken(getAdminSupabase(), token)
  if (!mesa) return { title: 'Mesa não encontrada' }
  return {
    title: `${mesa.mesaNome} · Cardápio`,
    // Cardápio de mesa não é página para buscador indexar: o link é do estabelecimento.
    robots: { index: false, follow: false },
  }
}

export default async function PaginaDaMesa({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = getAdminSupabase()

  // Um `null` cobre todos os casos de recusa — token fora do formato, inexistente,
  // revogado, mesa inativa, mesa bloqueada e loja com o módulo desligado. Responder
  // igual para todos evita virar oráculo de enumeração.
  const mesa = await resolverMesaPorToken(admin, token)
  if (!mesa) notFound()

  // Conta fechada, mesa em limpeza (0095): o QR é o mesmo, mas ainda não há atendimento.
  // Nada de sessão, seleção ou chamado até a equipe liberar a mesa.
  if (mesa.emLimpeza) {
    const loja = await buscarConfigLoja(admin, mesa.restauranteId)
    return <MesaEmLimpeza mesaNome={mesa.mesaNome} lojaNome={loja?.nome ?? ''} logoUrl={loja?.logoUrl ?? null} />
  }

  const [loja, grupos, itens, sessao, pizza] = await Promise.all([
    buscarConfigLoja(admin, mesa.restauranteId),
    listarGrupos(admin, mesa.restauranteId),
    listarItens(admin, mesa.restauranteId),
    // Abrir sessão é registrar que tem gente sentada. NÃO abre conta, não cria comanda
    // e não conta como venda.
    abrirOuObterSessao(admin, mesa.restauranteId, mesa.mesaId),
    carregarPizzaDaLoja(admin, mesa.restauranteId),
  ])

  if (!loja) notFound()

  // Personalização da mesa (0073): carrossel e aviso. Lidos à parte do select do cardápio;
  // se a leitura falhar, fica o comportamento de sempre (banner e texto padrão).
  const { data: vitrine } = await admin.from('restaurantes').select('mesa_carrossel_urls, mesa_mensagem_selecao, mesa_somente_visualizacao').eq('id', mesa.restauranteId).maybeSingle()
  const carrossel = ((vitrine?.mesa_carrossel_urls as string[] | null) ?? []).filter(Boolean)
  const somenteVisualizacao = (vitrine as { mesa_somente_visualizacao?: boolean } | null)?.mesa_somente_visualizacao === true
  const mensagem =
    ((vitrine?.mesa_mensagem_selecao as string | null) ?? '').trim() || mensagemPadraoDaMesa(somenteVisualizacao)

  // Catálogo é um só: as mesmas linhas que a vitrine lê, com os MESMOS filtros — status,
  // dia da semana, horário da categoria — mais o canal do salão (0069). Nada de cadastro
  // paralelo para mesa.
  //
  // Ordem: a mesma regra da vitrine (lib/ordem-cardapio) — categorias e itens na ordem do
  // Gestor. A antiga ordem própria da mesa (posicao_mesa, 0074) não é mais lida.
  const visivelNaMesa = (i: (typeof itens)[number]) =>
    i.status === 'disponivel' &&
    itemDisponivelNoCanal(i, 'mesa') &&
    itemDisponivelHoje(i.diasDisponiveis) &&
    categoriaNoHorario(i, grupos, grupoEstaAtivoAgora)
  const cardapio = cardapioOrdenado(grupos, itens, { itemVisivel: visivelNaMesa })
  const gruposComItem = cardapio.map((c) => c.grupo)
  // A busca da mesa lista itens de várias categorias: nesta mesma ordem (categoria, item).
  // Item sem categoria só aparecia na busca, como antes: continua lá, no fim.
  const disponiveis = [
    ...cardapio.flatMap((c) => c.itens),
    ...ordenar(itens.filter((i) => !i.grupoId && visivelNaMesa(i))),
  ]

  return (
    <CardapioDaMesa
      token={token}
      mesaNome={mesa.mesaNome}
      sessaoId={sessao.id}
      loja={{ nome: loja.nome, logoUrl: loja.logoUrl, bannerUrl: loja.bannerPromocionalUrl ?? loja.bannerUrl }}
      grupos={gruposComItem.map((g) => ({ id: g.id, nome: g.nome, imagemUrl: g.imagemUrl }))}
      pizza={pizza}
      carrossel={carrossel}
      mensagem={mensagem}
      somenteVisualizacao={somenteVisualizacao}
      itens={disponiveis.map((i) => ({
        id: i.id,
        grupoId: i.grupoId,
        nome: i.nome,
        descricao: i.descricao,
        preco: i.promocaoPreco ?? i.preco,
        precoOriginal: i.promocaoPreco !== null ? i.preco : null,
        imagemUrl: i.imagemThumbUrl ?? i.imagemUrl,
        // A ficha aberta ocupa a largura do celular: foto cheia, não a miniatura.
        imagemGrandeUrl: i.imagemUrl,
        grupos: i.grupos.map((g) => ({
          id: g.id,
          nome: g.nome,
          obrigatorio: g.obrigatorio,
          minEscolhas: g.minEscolhas,
          maxEscolhas: g.maxEscolhas,
          complementos: g.complementos
            .filter((c) => !c.pausado)
            .map((c) => ({ id: c.id, nome: c.nome, preco: c.preco, imagemUrl: c.imagemUrl })),
        })),
        tamanhos: [...i.tamanhos].sort((a, b) => a.posicao - b.posicao).map((t) => ({ id: t.id, nome: t.nome, preco: t.preco })),
        // Pizza: sabores disponíveis com o preço em cada tamanho padrão da loja.
        tipoItem: i.tipoItem,
        sabores: i.sabores
          .filter((s) => s.status === 'disponivel')
          .sort((a, b) => a.posicao - b.posicao)
          .map((s) => ({
            nome: s.nome,
            descricao: s.descricao,
            precos: Object.fromEntries(s.precos.map((x) => [x.tamanhoPadraoId, x.preco])),
          })),
        pizzaTamanhosOcultos: i.pizzaTamanhosOcultos ?? [],
        precoAPartirDe: precoAPartirDe(itemPrecificavel(i), pizza),
        // Etiqueta do cadastro (mais pedido, novo, promoção…): o mesmo cardápio na
        // mesa mostrava o item sem nenhum destaque (lib/etiqueta-item.ts).
        tag: i.tag,
        maisVendido: i.maisVendido,
      }))}
    />
  )
}

function MesaEmLimpeza({ mesaNome, lojaNome, logoUrl }: { mesaNome: string; lojaNome: string; logoUrl: string | null }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-bg-page px-4" data-mesa-em-limpeza>
      <div className="w-full max-w-[380px] rounded-menuzia border border-border bg-white p-6 text-center shadow-sm">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="mx-auto mb-4 h-14 w-14 rounded-full object-cover" />
        ) : null}
        <p className="text-[12px] font-semibold uppercase tracking-wide text-text-subtle">{lojaNome}</p>
        <h1 className="mt-1 text-[18px] font-bold text-text-main">{mesaNome}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-text-main">Esta mesa está em limpeza e ficará disponível em breve.</p>
      </div>
    </main>
  )
}
