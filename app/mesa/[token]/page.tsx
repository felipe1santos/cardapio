import { notFound } from 'next/navigation'
import type { Metadata, Viewport } from 'next'
import { getAdminSupabase } from '@/lib/supabase/admin'
import { resolverMesaPorToken } from '@/lib/queries/mesas'
import { abrirOuObterSessao } from '@/lib/queries/mesa-sessao'
import { listarGrupos, listarItens } from '@/lib/queries/cardapio'
import { buscarConfigLoja } from '@/lib/queries/ajustes'
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
  themeColor: '#E23744',
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

  const [loja, grupos, itens, sessao] = await Promise.all([
    buscarConfigLoja(admin, mesa.restauranteId),
    listarGrupos(admin, mesa.restauranteId),
    listarItens(admin, mesa.restauranteId),
    // Abrir sessão é registrar que tem gente sentada. NÃO abre conta, não cria comanda
    // e não conta como venda.
    abrirOuObterSessao(admin, mesa.restauranteId, mesa.mesaId),
  ])

  if (!loja) notFound()

  const disponiveis = itens.filter((i) => i.status === 'disponivel')
  const gruposComItem = grupos.filter((g) => disponiveis.some((i) => i.grupoId === g.id))

  return (
    <CardapioDaMesa
      token={token}
      mesaNome={mesa.mesaNome}
      sessaoId={sessao.id}
      loja={{ nome: loja.nome, logoUrl: loja.logoUrl, bannerUrl: loja.bannerPromocionalUrl ?? loja.bannerUrl }}
      grupos={gruposComItem.map((g) => ({ id: g.id, nome: g.nome, imagemUrl: g.imagemUrl }))}
      itens={disponiveis.map((i) => ({
        id: i.id,
        grupoId: i.grupoId,
        nome: i.nome,
        descricao: i.descricao,
        preco: i.promocaoPreco ?? i.preco,
        precoOriginal: i.promocaoPreco !== null ? i.preco : null,
        imagemUrl: i.imagemThumbUrl ?? i.imagemUrl,
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
        tamanhos: i.tamanhos.map((t) => ({ id: t.id, nome: t.nome, preco: t.preco })),
      }))}
    />
  )
}
